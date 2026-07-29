import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, SlotType } from '@prisma/client';
import { ConfigService } from '@nestjs/config';
import { allocateAnchors, anchorLoad } from './anchors';
import { planPasses, describePlan } from './passes';

@Injectable()
export class SchedulingService {
  private schedulerUrl: string;

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private config: ConfigService,
  ) {
    this.schedulerUrl = this.config.get('SCHEDULER_URL', 'http://localhost:8000');
  }

  async generateSchedule(
    eventId: string,
    minJudges: number,
    maxJudges: number,
    userId: string,
    guided = false,
  ) {
    // Gather all data for the solver
    const [teams, judges, slots, rooms, conflicts, existingSessions] = await Promise.all([
      this.prisma.team.findMany({
        where: { eventId, deletedAt: null, status: { in: ['ELIGIBLE', 'DRAFT', 'SUBMITTED'] } },
      }),
      this.prisma.judge.findMany({
        where: { eventId, deletedAt: null, status: 'ACTIVE' },
        include: { availability: true, expertise: true, conflicts: { where: { status: 'ACTIVE' } } },
      }),
      this.prisma.timeSlot.findMany({
        where: { eventId, slotType: SlotType.JUDGING },
        orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
      }),
      this.prisma.room.findMany({
        where: { eventId, deletedAt: null, status: 'ACTIVE' },
      }),
      this.prisma.conflictDeclaration.findMany({
        where: { eventId, status: 'ACTIVE' },
      }),
      // Sessions that already exist — manually placed, or left from an earlier
      // partial generation. These are kept as-is and worked around.
      this.prisma.judgingSession.findMany({
        where: { eventId },
        include: { judges: true },
      }),
    ]);

    // Teams that already have a session are not re-solved. Everything else is
    // handed to the solver.
    const scheduledTeamIds = new Set(existingSessions.map(s => s.teamId));
    const teamsToSchedule = teams.filter(t => !scheduledTeamIds.has(t.id));

    // The solver still needs to know what those sessions consume: their
    // room-slot is taken, their judges are busy in that slot, and those judges
    // have already used part of their session budget.
    const lockedSessions = existingSessions.map(s => ({
      team_id: s.teamId,
      room_id: s.roomId,
      slot_id: s.timeSlotId,
      judge_ids: s.judges.map(sj => sj.judgeId),
    }));

    if (teamsToSchedule.length === 0) {
      return {
        success: true,
        sessions: [],
        unscheduledTeams: [],
        warnings: [
          existingSessions.length > 0
            ? `All ${existingSessions.length} team(s) are already scheduled. Reset the schedule to regenerate.`
            : 'No teams to schedule.',
        ],
        qualityScore: 0,
        solveTimeSeconds: 0,
      };
    }

    // A judge with no availability recorded cannot be scheduled.
    //
    // The solver treats an empty slot list as "no restriction", which was right
    // when availability was optional. Now that the matrix is the source of
    // truth, that default would book someone for three days on the strength of
    // nobody having asked them.
    const unavailable = judges.filter(j => j.availability.length === 0);
    const schedulable = judges.filter(j => j.availability.length > 0);

    // Map judge availability to slot IDs
    const judgeInputs = schedulable.map(j => {
      const availSlotIds = slots
        .filter(s => {
          return j.availability.some(a => {
            const slotDate = new Date(s.date).toISOString().split('T')[0];
            const availDate = new Date(a.date).toISOString().split('T')[0];
            return slotDate === availDate && s.startTime >= a.startTime && s.endTime <= a.endTime;
          });
        })
        .map(s => s.id);

      const conflictTeamIds = j.conflicts.map(c => c.teamId);

      return {
        id: j.id,
        name: j.name,
        judge_type: j.judgeType,
        max_sessions: j.maxSessions,
        available_slot_ids: availSlotIds,
        conflict_team_ids: conflictTeamIds,
        expertise_track_ids: j.expertise.map(e => e.trackId),
        tier: (j as any).judgeTier ?? 'L3',
        is_standby: (j as any).isStandby ?? false,
      };
    });

    // Anchors are decided here rather than by the solver. With two MDs and two
    // rooms there is nothing to optimise, and deciding it up front means a
    // coordinator can read "MD Priya, room 2, Tuesday" off the plan instead of
    // inferring it from the result.
    const slotsByDate = new Map<string, Array<{ id: string }>>();
    for (const s of slots) {
      const key = new Date(s.date).toISOString().split('T')[0];
      const list = slotsByDate.get(key) ?? [];
      list.push({ id: s.id });
      slotsByDate.set(key, list);
    }

    const anchorPlan = guided
      ? allocateAnchors(
          schedulable.map(j => ({
            id: j.id,
            name: j.name,
            judgeTier: (j as any).judgeTier ?? 'L3',
            maxSessions: j.maxSessions,
            isStandby: (j as any).isStandby ?? false,
          })),
          rooms.map(r => ({ id: r.id, name: r.name })),
          slotsByDate,
        )
      : { assignments: [], reservedJudgeIds: [], warnings: [], coverSlotIds: {} };

    // Guided mode runs a sequence of smaller solves rather than one large one,
    // so the rules are honoured in priority order and a failure names the rule
    // that caused it.
    const passPlan = guided
      ? planPasses(
          teamsToSchedule.map(t => ({
            id: t.id,
            name: t.name,
            country: (t as any).country ?? null,
            platform: (t as any).platform ?? null,
            trackId: t.trackId,
          })),
          rooms.map(r => ({
            id: r.id,
            name: r.name,
            hasVideoConferencing: (r as any).hasVideoConferencing ?? false,
          })),
          Math.max(Math.floor(slots.length / Math.max(rooms.length, 1)), 1),
        )
      : { passes: [], warnings: [] };

    const payload = {
      event_id: eventId,
      teams: teamsToSchedule.map(t => ({ id: t.id, name: t.name, track_id: t.trackId })),
      judges: judgeInputs,
      slots: slots.map(s => ({
        id: s.id,
        date: new Date(s.date).toISOString().split('T')[0],
        start_time: s.startTime.toISOString(),
        end_time: s.endTime.toISOString(),
      })),
      rooms: rooms.map(r => ({ id: r.id, name: r.name })),
      min_judges_per_team: minJudges,
      max_judges_per_team: maxJudges,
      locked_sessions: lockedSessions,
      anchors: anchorPlan.assignments.map(a => ({
        room_id: a.roomId,
        date: a.date,
        anchor_judge_id: a.anchorJudgeId,
        ps_judge_id: a.psJudgeId,
        anchor_break_slot_ids: a.anchorBreakSlotIds,
      })),
      reserved_judge_ids: anchorPlan.reservedJudgeIds,
    };

    // Call the Python solver
    try {
      let result: any;

      if (guided && passPlan.passes.length > 0) {
        // Each pass solves its own teams with everything placed so far locked,
        // so a later pass works around earlier ones rather than competing with
        // them. This is the same mechanism that handles manual placements.
        const allSessions: any[] = [];
        const allWarnings: string[] = [...passPlan.warnings];
        const allUnscheduled: string[] = [];
        const locked = [...lockedSessions];
        let totalSolveTime = 0;
        let worstQuality = 100;

        for (const pass of passPlan.passes) {
          const passPayload = {
            ...payload,
            teams: pass.teams.map(t => ({ id: t.id, name: t.name, track_id: t.trackId })),
            locked_sessions: locked,
            restrict_to_room_ids: pass.restrictToRoomIds,
            cluster: pass.cluster,
          };

          const res = await fetch(`${this.schedulerUrl}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(passPayload),
          });

          if (!res.ok) {
            const err = await res.text();
            throw new InternalServerErrorException(`Scheduler error on ${pass.label}: ${err}`);
          }

          const passResult = await res.json();
          totalSolveTime += passResult.solve_time_seconds || 0;

          if (!passResult.success) {
            // One rule failing should not lose the work of the passes that
            // succeeded, so the run continues and the coordinator is told which
            // pass could not be placed.
            allWarnings.push(`${pass.label} could not be placed.`);
            allUnscheduled.push(...pass.teams.map(t => t.name));
            continue;
          }

          worstQuality = Math.min(worstQuality, passResult.quality_score ?? 100);
          allSessions.push(...(passResult.sessions || []));
          allUnscheduled.push(...(passResult.unscheduled_teams || []));

          // Lock what this pass placed so the next works around it.
          for (const s of passResult.sessions || []) {
            locked.push({
              team_id: s.team_id,
              room_id: s.room_id,
              slot_id: s.slot_id,
              judge_ids: s.judge_ids || [],
            });
          }
        }

        result = {
          success: allSessions.length > 0,
          sessions: allSessions,
          unscheduled_teams: allUnscheduled,
          warnings: [describePlan(passPlan), ...allWarnings],
          quality_score: worstQuality,
          solve_time_seconds: Math.round(totalSolveTime * 100) / 100,
        };
      } else {
        const response = await fetch(`${this.schedulerUrl}/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          const err = await response.text();
          throw new InternalServerErrorException(`Scheduler error: ${err}`);
        }

        result = await response.json();
      }

      await this.audit.log({
        userId, eventId,
        action: AuditAction.CREATE, entityType: 'Schedule',
        entityId: eventId,
        newValues: {
          sessions: result.sessions?.length || 0,
          locked: lockedSessions.length,
          unscheduled: result.unscheduled_teams?.length || 0,
          quality: result.quality_score,
          solveTime: result.solve_time_seconds,
        },
      });

      return {
        success: result.success,
        sessions: result.sessions?.map((s: any) => ({
          teamId: s.team_id,
          teamName: s.team_name,
          roomId: s.room_id,
          roomName: s.room_name,
          slotId: s.slot_id,
          slotDate: s.slot_date,
          slotStart: s.slot_start,
          slotEnd: s.slot_end,
          judgeIds: s.judge_ids,
          judgeNames: s.judge_names,
        })) || [],
        unscheduledTeams: result.unscheduled_teams || [],
        // Anchor warnings come first — a room with no MD is a bigger problem
        // than a room change, and a coordinator should see it before the
        // optimisation notes.
        warnings: [
          ...(unavailable.length > 0
            ? [`${unavailable.length} judge(s) have no availability recorded and were not scheduled: ` +
               unavailable.slice(0, 5).map(j => j.name).join(', ') +
               (unavailable.length > 5 ? `, and ${unavailable.length - 5} more` : '')]
            : []),
          ...anchorPlan.warnings,
          ...(result.warnings || []),
        ],
        qualityScore: result.quality_score || 0,
        solveTimeSeconds: result.solve_time_seconds || 0,
      };
    } catch (err: any) {
      if (err instanceof InternalServerErrorException) throw err;
      throw new InternalServerErrorException(`Cannot reach scheduler: ${err.message}`);
    }
  }
}
