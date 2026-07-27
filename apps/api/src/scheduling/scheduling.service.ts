import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, SlotType } from '@prisma/client';
import { ConfigService } from '@nestjs/config';

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

  async generateSchedule(eventId: string, minJudges: number, maxJudges: number, userId: string) {
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

    // Map judge availability to slot IDs
    const judgeInputs = judges.map(j => {
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
      };
    });

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
    };

    // Call the Python solver
    try {
      const response = await fetch(`${this.schedulerUrl}/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const err = await response.text();
        throw new InternalServerErrorException(`Scheduler error: ${err}`);
      }

      const result = await response.json();

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
        warnings: result.warnings || [],
        qualityScore: result.quality_score || 0,
        solveTimeSeconds: result.solve_time_seconds || 0,
      };
    } catch (err: any) {
      if (err instanceof InternalServerErrorException) throw err;
      throw new InternalServerErrorException(`Cannot reach scheduler: ${err.message}`);
    }
  }
}
