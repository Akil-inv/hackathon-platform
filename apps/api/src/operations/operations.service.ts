import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@prisma/client';
import {
  SwapJudgeInput, ChangeRoomInput, RescheduleInput, MarkAbsentInput,
  AddJudgeInput, CancelSessionInput, UpdateStageInput, SwapRoomsInput,
} from './operations.types';

@Injectable()
export class OperationsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private async getSessionFull(sessionId: string) {
    const session = await this.prisma.judgingSession.findUnique({
      where: { id: sessionId },
      include: {
        team: true, room: true, timeSlot: true,
        judges: { include: { judge: true } },
        scorecards: true,
      },
    });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  private assertEditable(session: any) {
    if (['COMPLETED', 'CANCELLED'].includes(session.stage)) {
      throw new BadRequestException(`Cannot modify a ${session.stage} session`);
    }
  }

  private async isJudgeBusyInSlot(judgeId: string, slotId: string, excludeSessionId?: string) {
    const found = await this.prisma.sessionJudge.findFirst({
      where: {
        judgeId,
        session: {
          timeSlotId: slotId,
          stage: { notIn: ['CANCELLED', 'RESCHEDULED'] },
          ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}),
        },
      },
    });
    return !!found;
  }

  private async hasConflict(judgeId: string, teamId: string) {
    const found = await this.prisma.conflictDeclaration.findFirst({
      where: { judgeId, teamId, status: 'ACTIVE' },
    });
    return !!found;
  }

  // Check if a judge would need to change rooms between adjacent sessions in the same half-day
  private async checkJudgeRoomMovements(judgeId: string, eventId: string, newSlotId: string, newRoomId: string, excludeSessionId?: string): Promise<string[]> {
    const warnings: string[] = [];
    
    // Get the new slot's time
    const newSlot = await this.prisma.timeSlot.findUnique({ where: { id: newSlotId } });
    if (!newSlot) return warnings;
    
    // Get all sessions this judge is assigned to in this event
    const judgeSessions = await this.prisma.sessionJudge.findMany({
      where: {
        judgeId,
        session: {
          eventId,
          stage: { notIn: ['CANCELLED', 'RESCHEDULED'] },
          ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}),
        },
      },
      include: {
        session: { include: { timeSlot: true, room: true, team: true } },
      },
    });
    
    const judge = await this.prisma.judge.findUnique({ where: { id: judgeId } });
    const judgeName = judge?.name || 'Judge';
    
    // Find sessions in adjacent time slots (same date, within 30 mins)
    const newStart = newSlot.startTime ? new Date(newSlot.startTime).getTime() : 0;
    const newEnd = newSlot.endTime ? new Date(newSlot.endTime).getTime() : 0;
    
    for (const sj of judgeSessions) {
      const sjSlot = sj.session.timeSlot;
      if (!sjSlot?.startTime || !sjSlot?.endTime) continue;
      
      const sjStart = new Date(sjSlot.startTime).getTime();
      const sjEnd = new Date(sjSlot.endTime).getTime();
      const sjRoom = sj.session.room;
      
      // Check if this session is immediately before or after
      const gapAfter = newStart - sjEnd; // new session starts after existing ends
      const gapBefore = sjStart - newEnd; // existing starts after new ends
      
      const isAdjacent = (gapAfter >= 0 && gapAfter <= 30 * 60 * 1000) || (gapBefore >= 0 && gapBefore <= 30 * 60 * 1000);
      
      if (isAdjacent && sjRoom && sjRoom.id !== newRoomId) {
        const direction = gapAfter >= 0 ? 'previous' : 'next';
        warnings.push(
          `${judgeName} would need to move from ${direction === 'previous' ? sjRoom.name : newRoomId} to ${direction === 'previous' ? newRoomId : sjRoom.name} between adjacent sessions (${sj.session.team.name})`
        );
      }
    }
    
    return warnings;
  }

  // Check room movements for all judges in a session after a potential change
  private async checkAllJudgeMovements(sessionId: string, newSlotId: string, newRoomId: string): Promise<string[]> {
    const session = await this.prisma.judgingSession.findUnique({
      where: { id: sessionId },
      include: { judges: { include: { judge: true } } },
    });
    if (!session) return [];
    
    const allWarnings: string[] = [];
    for (const sj of session.judges) {
      const w = await this.checkJudgeRoomMovements(sj.judgeId, session.eventId, newSlotId, newRoomId, sessionId);
      allWarnings.push(...w);
    }
    return allWarnings;
  }

  private async isRoomBusyInSlot(roomId: string, slotId: string, excludeSessionId?: string) {
    const found = await this.prisma.judgingSession.findFirst({
      where: {
        roomId, timeSlotId: slotId,
        stage: { notIn: ['CANCELLED', 'RESCHEDULED'] },
        ...(excludeSessionId ? { id: { not: excludeSessionId } } : {}),
      },
    });
    return !!found;
  }

  private async getJudgeLoad(judgeId: string, eventId: string) {
    return this.prisma.sessionJudge.count({
      where: { judgeId, session: { eventId, stage: { notIn: ['CANCELLED', 'RESCHEDULED'] } } },
    });
  }

  // ─── UPDATE SESSION STAGE ───
  async updateStage(input: UpdateStageInput, userId: string) {
    const session = await this.getSessionFull(input.sessionId);
    const validTransitions: Record<string, string[]> = {
      'SCHEDULED': ['IN_PROGRESS', 'DELAYED', 'CANCELLED', 'NO_SHOW'],
      'IN_PROGRESS': ['COMPLETED', 'DELAYED'],
      'DELAYED': ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
      'RESCHEDULED': ['SCHEDULED'],
    };

    const allowed = validTransitions[session.stage] || [];
    if (!allowed.includes(input.stage)) {
      throw new BadRequestException(`Cannot move from ${session.stage} to ${input.stage}. Allowed: ${allowed.join(', ')}`);
    }

    // GUARD: Only one active session per room at a time
    if (input.stage === 'IN_PROGRESS') {
      const activeInRoom = await this.prisma.judgingSession.findFirst({
        where: {
          roomId: session.roomId,
          id: { not: session.id },
          stage: { in: ['IN_PROGRESS', 'QA', 'SCORING'] },
        },
        include: { team: true },
      });
      if (activeInRoom) {
        throw new BadRequestException(
          `Room ${session.room.name} already has an active session (${activeInRoom.team.name}). Complete it first.`
        );
      }
    }

    const timeUpdates: any = {};
    if (input.stage === 'IN_PROGRESS' && !session.actualStart) timeUpdates.actualStart = new Date();
    if (input.stage === 'COMPLETED') timeUpdates.actualEnd = new Date();
    if (input.stage === 'DELAYED') {
      const delayMins = session.scheduledStart ? Math.round((Date.now() - new Date(session.scheduledStart).getTime()) / 60000) : 0;
      timeUpdates.delayMinutes = Math.max(delayMins, 0);
      timeUpdates.delayReason = input.notes || 'Delayed';
    }

    await this.prisma.judgingSession.update({
      where: { id: session.id },
      data: { stage: input.stage as any, notes: input.notes || session.notes, ...timeUpdates },
    });

    // Auto-create scorecards when session starts
    if (input.stage === "IN_PROGRESS") {
      for (const sj of session.judges) {
        const existing = await this.prisma.scorecard.findFirst({
          where: { eventId: session.eventId, judgeId: sj.judgeId, teamId: session.teamId },
        });
        if (!existing) {
          await this.prisma.scorecard.create({
            data: { sessionId: session.id, judgeId: sj.judgeId, teamId: session.teamId, eventId: session.eventId },
          });
        }
      }
    }

    await this.audit.log({
      userId, eventId: session.eventId,
      action: AuditAction.UPDATE, entityType: 'JudgingSession', entityId: session.id,
      oldValues: { stage: session.stage }, newValues: { stage: input.stage },
    });

    return { success: true, message: `${session.team.name}: ${session.stage} → ${input.stage}`, warnings: [] };
  }

  // ─── SWAP JUDGE ───
  async swapJudge(input: SwapJudgeInput, userId: string) {
    const session = await this.getSessionFull(input.sessionId);
    this.assertEditable(session);

    const oldSJ = session.judges.find((sj: any) => sj.judgeId === input.oldJudgeId);
    if (!oldSJ) throw new BadRequestException('Old judge not assigned to this session');

    const oldSC = session.scorecards.find((sc: any) => sc.judgeId === input.oldJudgeId);
    if (oldSC && ['SUBMITTED', 'RESUBMITTED', 'LOCKED'].includes(oldSC.status)) {
      throw new BadRequestException('Old judge has submitted scores. Reopen the scorecard first.');
    }

    if (input.newJudgeId === input.oldJudgeId) throw new BadRequestException('Same judge');
    if (session.judges.some((sj: any) => sj.judgeId === input.newJudgeId)) throw new BadRequestException('New judge already on this session');
    if (await this.hasConflict(input.newJudgeId, session.teamId)) throw new BadRequestException('New judge has conflict of interest');
    if (await this.isJudgeBusyInSlot(input.newJudgeId, session.timeSlotId, session.id)) throw new BadRequestException('New judge busy in this slot');

    const newJudge = await this.prisma.judge.findUnique({ where: { id: input.newJudgeId } });
    if (!newJudge) throw new NotFoundException('New judge not found');

    const warnings: string[] = [];
    const load = await this.getJudgeLoad(input.newJudgeId, session.eventId);
    if (load >= newJudge.maxSessions) warnings.push(`${newJudge.name} exceeds max sessions`);

    await this.prisma.$transaction(async (tx) => {
      await tx.sessionJudge.delete({ where: { id: oldSJ.id } });
      await tx.sessionJudge.create({ data: { sessionId: session.id, judgeId: input.newJudgeId } });
      if (oldSC && oldSC.status === 'NOT_STARTED') {
        await tx.scorecard.delete({ where: { id: oldSC.id } });
      }
      await tx.scorecard.create({
        data: { sessionId: session.id, judgeId: input.newJudgeId, teamId: session.teamId, eventId: session.eventId },
      });
    });

    await this.audit.log({
      userId, eventId: session.eventId,
      action: AuditAction.UPDATE, entityType: 'JudgingSession', entityId: session.id,
      oldValues: { judge: oldSJ.judge.name }, newValues: { judge: newJudge.name }, reason: input.reason,
    });

    return { success: true, message: `Swapped ${oldSJ.judge.name} → ${newJudge.name}`, warnings };
  }

  // ─── ADD JUDGE ───
  async addJudge(input: AddJudgeInput, userId: string) {
    const session = await this.getSessionFull(input.sessionId);
    this.assertEditable(session);

    const event = await this.prisma.event.findUnique({ where: { id: session.eventId } });
    if (session.judges.length >= (event?.maxJudgesPerTeam || 5)) throw new BadRequestException('Maximum judges reached');
    if (session.judges.some((sj: any) => sj.judgeId === input.judgeId)) throw new BadRequestException('Judge already assigned');
    if (await this.hasConflict(input.judgeId, session.teamId)) throw new BadRequestException('Judge has conflict');
    if (await this.isJudgeBusyInSlot(input.judgeId, session.timeSlotId, session.id)) throw new BadRequestException('Judge busy in this slot');

    const judge = await this.prisma.judge.findUnique({ where: { id: input.judgeId } });
    if (!judge) throw new NotFoundException('Judge not found');

    await this.prisma.$transaction(async (tx) => {
      await tx.sessionJudge.create({ data: { sessionId: session.id, judgeId: input.judgeId } });
      await tx.scorecard.create({
        data: { sessionId: session.id, judgeId: input.judgeId, teamId: session.teamId, eventId: session.eventId },
      });
    });

    return { success: true, message: `Added ${judge.name} to ${session.team.name}`, warnings: [] };
  }

  // ─── CANCEL SESSION ───
  async cancelSession(input: CancelSessionInput, userId: string) {
    const session = await this.getSessionFull(input.sessionId);
    if (session.stage === 'CANCELLED') throw new BadRequestException('Already cancelled');

    await this.prisma.judgingSession.update({
      where: { id: session.id },
      data: { stage: 'CANCELLED', notes: input.reason },
    });

    const warnings: string[] = [];
    const hasSubmitted = session.scorecards.some((sc: any) => ['SUBMITTED', 'RESUBMITTED', 'LOCKED'].includes(sc.status));
    if (hasSubmitted) warnings.push('Session has submitted scorecards — preserved for audit');

    return { success: true, message: `${session.team.name} cancelled`, warnings };
  }

  // ─── CHANGE ROOM ───
  async changeRoom(input: ChangeRoomInput, userId: string) {
    const session = await this.getSessionFull(input.sessionId);
    this.assertEditable(session);

    const newRoom = await this.prisma.room.findUnique({ where: { id: input.newRoomId } });
    if (!newRoom) throw new NotFoundException('Room not found');
    if (await this.isRoomBusyInSlot(input.newRoomId, session.timeSlotId, session.id)) {
      throw new BadRequestException(`${newRoom.name} is booked for this slot`);
    }

    await this.prisma.judgingSession.update({ where: { id: session.id }, data: { roomId: input.newRoomId } });

    const moveWarnings = await this.checkAllJudgeMovements(session.id, session.timeSlotId, input.newRoomId);
    return { success: true, message: `Moved ${session.team.name} to ${newRoom.name}`, warnings: moveWarnings };
  }

  // ─── RESCHEDULE ───
  async reschedule(input: RescheduleInput, userId: string) {
    const session = await this.getSessionFull(input.sessionId);
    this.assertEditable(session);

    const newSlot = await this.prisma.timeSlot.findUnique({ where: { id: input.newTimeSlotId } });
    if (!newSlot) throw new NotFoundException('Slot not found');
    const roomId = input.newRoomId || session.roomId;

    if (await this.isRoomBusyInSlot(roomId, input.newTimeSlotId, session.id)) throw new BadRequestException('Room booked');

    for (const sj of session.judges) {
      if (await this.isJudgeBusyInSlot(sj.judgeId, input.newTimeSlotId, session.id)) {
        throw new BadRequestException(`Judge ${sj.judge.name} busy in new slot`);
      }
    }

    await this.prisma.judgingSession.update({
      where: { id: session.id },
      data: { timeSlotId: input.newTimeSlotId, roomId, scheduledStart: newSlot.startTime, scheduledEnd: newSlot.endTime, stage: 'SCHEDULED' },
    });

    const moveWarnings = await this.checkAllJudgeMovements(session.id, input.newTimeSlotId, roomId);
    return { success: true, message: `${session.team.name} rescheduled`, warnings: moveWarnings };
  }

  // ─── MARK JUDGE ABSENT ───
  async markJudgeAbsent(input: MarkAbsentInput, userId: string) {
    const judge = await this.prisma.judge.findUnique({ where: { id: input.judgeId } });
    if (!judge) throw new NotFoundException('Judge not found');

    const affected = await this.prisma.sessionJudge.findMany({
      where: { judgeId: input.judgeId, session: { eventId: input.eventId, stage: { in: ['SCHEDULED', 'TEAM_CHECKED_IN', 'JUDGES_PRESENT', 'READY'] } } },
      include: { session: { include: { team: true, judges: true } } },
    });

    await this.prisma.judge.update({ where: { id: input.judgeId }, data: { status: 'UNAVAILABLE' } });

    const warnings = affected.map((sj: any) => `${sj.session.team.name}: ${sj.session.judges.length - 1} judges remaining`);
    return { success: true, message: `${judge.name} marked absent. ${affected.length} sessions affected.`, warnings };
  }

  // ─── SWAP ROOMS ───
  async swapRooms(input: SwapRoomsInput, userId: string) {
    const sessionA = await this.getSessionFull(input.sessionIdA);
    const sessionB = await this.getSessionFull(input.sessionIdB);
    this.assertEditable(sessionA);
    this.assertEditable(sessionB);

    if (sessionA.timeSlotId !== sessionB.timeSlotId) throw new BadRequestException('Must be same time slot');

    await this.prisma.$transaction(async (tx) => {
      const roomA = sessionA.roomId;
      const roomB = sessionB.roomId;
      await tx.judgingSession.update({ where: { id: sessionA.id }, data: { roomId: roomB } });
      await tx.judgingSession.update({ where: { id: sessionB.id }, data: { roomId: roomA } });
    });

    return { success: true, message: `Swapped rooms: ${sessionA.team.name} ↔ ${sessionB.team.name}`, warnings: [] };
  }

  // ─── SWAP TEAMS ONLY (judges stay in their rooms) ───
  async swapTeams(sessionIdA: string, sessionIdB: string, userId: string) {
    const a = await this.getSessionFull(sessionIdA);
    const b = await this.getSessionFull(sessionIdB);

    // Cannot swap started, completed, or cancelled sessions
    const blocked = ['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'SCORING', 'QA'];
    if (blocked.includes(a.stage)) throw new BadRequestException(`${a.team.name} is ${a.stage} — cannot swap`);
    if (blocked.includes(b.stage)) throw new BadRequestException(`${b.team.name} is ${b.stage} — cannot swap`);

    if (a.eventId !== b.eventId) throw new BadRequestException('Sessions must be in the same event');

    // Everything below runs in one transaction. The team swap used to happen
    // outside it, so a failure here left teams swapped but scorecards stale.
    await this.prisma.$transaction(async (tx) => {
      // Raw SQL swaps both team IDs in a single statement, avoiding the
      // unique constraint on (team_id, time_slot_id) that a two-step update
      // would trip.
      await tx.$executeRawUnsafe(
        `UPDATE judging_sessions SET team_id = CASE id WHEN $1::uuid THEN $3::uuid WHEN $2::uuid THEN $4::uuid END WHERE id IN ($1::uuid, $2::uuid)`,
        a.id, b.id, b.teamId, a.teamId
      );

      // Clear child criterion_scores before deleting the scorecards that own
      // them. Without this, criterion_scores_scorecard_id_fkey rejects the
      // delete and the whole swap fails — which it does as soon as a judge
      // has typed anything into a draft.
      const staleScorecards = await tx.scorecard.findMany({
        where: {
          sessionId: { in: [a.id, b.id] },
          status: { in: ['NOT_STARTED', 'DRAFT'] },
        },
        select: { id: true },
      });
      const staleIds = staleScorecards.map((sc) => sc.id);

      if (staleIds.length > 0) {
        await tx.criterionScore.deleteMany({ where: { scorecardId: { in: staleIds } } });
        await tx.scorecard.deleteMany({ where: { id: { in: staleIds } } });
      }

      // Create new scorecards for session A judges -> team B
      for (const sj of a.judges) {
        const exists = await tx.scorecard.findFirst({
          where: { sessionId: a.id, judgeId: sj.judgeId },
        });
        if (!exists) {
          await tx.scorecard.create({
            data: { sessionId: a.id, judgeId: sj.judgeId, teamId: b.teamId, eventId: a.eventId },
          });
        }
      }
      // Create new scorecards for session B judges -> team A
      for (const sj of b.judges) {
        const exists = await tx.scorecard.findFirst({
          where: { sessionId: b.id, judgeId: sj.judgeId },
        });
        if (!exists) {
          await tx.scorecard.create({
            data: { sessionId: b.id, judgeId: sj.judgeId, teamId: a.teamId, eventId: b.eventId },
          });
        }
      }
    });

    await this.audit.log({
      userId, eventId: a.eventId,
      action: AuditAction.UPDATE, entityType: 'JudgingSession', entityId: a.id,
      oldValues: { team: a.team.name }, newValues: { team: b.team.name },
      reason: `Teams swapped: ${a.team.name} <-> ${b.team.name}`,
    });

    // Check if any judges have conflicts with the swapped teams
    const swapWarnings: string[] = [];
    for (const sj of a.judges) {
      if (await this.hasConflict(sj.judgeId, b.teamId)) {
        swapWarnings.push(`${sj.judge.name} has a conflict of interest with ${b.team.name} (now assigned to them)`);
      }
    }
    for (const sj of b.judges) {
      if (await this.hasConflict(sj.judgeId, a.teamId)) {
        swapWarnings.push(`${sj.judge.name} has a conflict of interest with ${a.team.name} (now assigned to them)`);
      }
    }
    return { success: true, message: `Teams swapped: ${a.team.name} and ${b.team.name}`, warnings: swapWarnings };
  }

  // ─── SWAP SESSIONS (swap time slots and rooms) ───
  async swapSessions(sessionIdA: string, sessionIdB: string, userId: string) {
    const a = await this.getSessionFull(sessionIdA);
    const b = await this.getSessionFull(sessionIdB);

    const blocked = ['IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'SCORING', 'QA'];
    if (blocked.includes(a.stage)) throw new BadRequestException(`${a.team.name} is ${a.stage} — cannot swap`);
    if (blocked.includes(b.stage)) throw new BadRequestException(`${b.team.name} is ${b.stage} — cannot swap`);

    if (a.eventId !== b.eventId) throw new BadRequestException('Sessions must be in the same event');

    // Check all judges from A are available in B's slot and vice versa
    // Must exclude BOTH sessions being swapped from the busy check
    for (const sj of a.judges) {
      const busy = await this.prisma.sessionJudge.findFirst({
        where: {
          judgeId: sj.judgeId,
          session: {
            timeSlotId: b.timeSlotId,
            id: { notIn: [a.id, b.id] },
            stage: { notIn: ['CANCELLED', 'RESCHEDULED'] },
          },
        },
      });
      if (busy) {
        throw new BadRequestException(`Judge ${sj.judge.name} is busy in the target slot`);
      }
    }
    for (const sj of b.judges) {
      const busy = await this.prisma.sessionJudge.findFirst({
        where: {
          judgeId: sj.judgeId,
          session: {
            timeSlotId: a.timeSlotId,
            id: { notIn: [a.id, b.id] },
            stage: { notIn: ['CANCELLED', 'RESCHEDULED'] },
          },
        },
      });
      if (busy) {
        throw new BadRequestException(`Judge ${sj.judge.name} is busy in the target slot`);
      }
    }

    const aSlot = a.timeSlotId;
    const aRoom = a.roomId;
    const aStart = a.scheduledStart;
    const aEnd = a.scheduledEnd;

    // Use raw SQL to swap atomically - avoids unique constraint on (room_id, time_slot_id)
    await this.prisma.$executeRaw`
      UPDATE judging_sessions SET
        time_slot_id = CASE
          WHEN id = ${a.id}::uuid THEN ${b.timeSlotId}::uuid
          WHEN id = ${b.id}::uuid THEN ${aSlot}::uuid
        END,
        room_id = CASE
          WHEN id = ${a.id}::uuid THEN ${b.roomId}::uuid
          WHEN id = ${b.id}::uuid THEN ${aRoom}::uuid
        END,
        scheduled_start = CASE
          WHEN id = ${a.id}::uuid THEN ${b.scheduledStart}
          WHEN id = ${b.id}::uuid THEN ${aStart}
        END,
        scheduled_end = CASE
          WHEN id = ${a.id}::uuid THEN ${b.scheduledEnd}
          WHEN id = ${b.id}::uuid THEN ${aEnd}
        END
      WHERE id IN (${a.id}::uuid, ${b.id}::uuid)
    `;

    await this.audit.log({
      userId, eventId: a.eventId,
      action: AuditAction.UPDATE, entityType: 'JudgingSession', entityId: a.id,
      oldValues: { slot: aSlot, room: aRoom }, newValues: { slot: b.timeSlotId, room: b.roomId },
      reason: `Swapped with ${b.team.name}`,
    });

    // Check room movement impact for all judges
    const sessionSwapWarnings: string[] = [];
    for (const sj of a.judges) {
      const w = await this.checkJudgeRoomMovements(sj.judgeId, a.eventId, b.timeSlotId, b.roomId, a.id);
      sessionSwapWarnings.push(...w);
    }
    for (const sj of b.judges) {
      const w = await this.checkJudgeRoomMovements(sj.judgeId, b.eventId, a.timeSlotId, a.roomId, b.id);
      sessionSwapWarnings.push(...w);
    }
    return { success: true, message: `Swapped ${a.team.name} and ${b.team.name}`, warnings: sessionSwapWarnings };
  }

  // ─── FIND REPLACEMENT JUDGES ───
  async findReplacementJudges(sessionId: string) {
    const session = await this.getSessionFull(sessionId);
    const allJudges = await this.prisma.judge.findMany({ where: { eventId: session.eventId, deletedAt: null } });
    const currentIds = new Set(session.judges.map((sj: any) => sj.judgeId));

    const candidates = await Promise.all(
      allJudges.filter(j => !currentIds.has(j.id)).map(async (j) => {
        const load = await this.getJudgeLoad(j.id, session.eventId);
        const conflict = await this.hasConflict(j.id, session.teamId);
        const busy = await this.isJudgeBusyInSlot(j.id, session.timeSlotId);
        let score = 100;
        if (j.status !== 'ACTIVE') score -= 80;
        if (conflict) score -= 90;
        if (busy) score -= 70;
        if (load >= j.maxSessions) score -= 50;
        score -= load * 5;
        return { judgeId: j.id, judgeName: j.name, judgeType: j.judgeType, currentLoad: load, maxSessions: j.maxSessions, isAvailable: j.status === 'ACTIVE', hasConflict: conflict, isBusyInSlot: busy, score };
      })
    );
    return candidates.sort((a, b) => b.score - a.score);
  }

  // ─── OUTSTANDING SCORING ───
  /**
   * Sessions that have finished but whose scorecards are not in, grouped by
   * the judge who owes them.
   *
   * Grouped by judge rather than by session on purpose: one judge with six
   * outstanding scorecards is one conversation, not six problems. Sorted by
   * the oldest outstanding session so anything left over from yesterday
   * surfaces above this morning's.
   *
   * There is no hard stop anywhere — a judge who does not finish on day one
   * can finish on day two. This exists so a coordinator knows who to chase.
   * The platform never contacts judges itself.
   */
  async outstandingScoring(eventId: string) {
    const sessions = await this.prisma.judgingSession.findMany({
      where: { eventId, stage: 'COMPLETED' },
      include: {
        team: true,
        room: true,
        timeSlot: true,
        scorecards: { include: { judge: true } },
      },
    });

    type Row = {
      judgeId: string;
      judgeName: string;
      judgeEmail: string;
      judgePhone: string | null;
      notStarted: number;
      inProgress: number;
      oldestSessionAt: Date | null;
      teams: string[];
    };

    const byJudge = new Map<string, Row>();

    for (const s of sessions) {
      for (const sc of s.scorecards) {
        if (!['NOT_STARTED', 'DRAFT', 'REOPENED'].includes(sc.status)) continue;
        if (!sc.judge) continue;

        const row = byJudge.get(sc.judgeId) ?? {
          judgeId: sc.judgeId,
          judgeName: sc.judge.name,
          judgeEmail: sc.judge.email,
          judgePhone: sc.judge.phone ?? null,
          notStarted: 0,
          inProgress: 0,
          oldestSessionAt: null,
          teams: [],
        };

        // A judge who has saved a draft is mid-thought. One who has not opened
        // the scorecard may not know they are expected to score at all — a
        // different conversation.
        if (sc.status === 'NOT_STARTED') row.notStarted += 1;
        else row.inProgress += 1;

        const startedAt = s.timeSlot?.startTime ?? s.scheduledStart ?? null;
        if (startedAt && (!row.oldestSessionAt || startedAt < row.oldestSessionAt)) {
          row.oldestSessionAt = startedAt;
        }

        row.teams.push(`${s.team.name} (${s.room?.name ?? 'room tbc'})`);
        byJudge.set(sc.judgeId, row);
      }
    }

    return [...byJudge.values()]
      .sort((a, b) => {
        const at = a.oldestSessionAt?.getTime() ?? 0;
        const bt = b.oldestSessionAt?.getTime() ?? 0;
        return at - bt;
      })
      .map((r) => ({
        judgeId: r.judgeId,
        judgeName: r.judgeName,
        judgeEmail: r.judgeEmail,
        judgePhone: r.judgePhone,
        outstanding: r.notStarted + r.inProgress,
        notStarted: r.notStarted,
        inProgress: r.inProgress,
        oldestSessionAt: r.oldestSessionAt ? r.oldestSessionAt.toISOString() : null,
        teams: r.teams,
      }));
  }

  // ─── HEALTH CHECK ───
  async healthCheck(eventId: string) {
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (!event) throw new NotFoundException('Event not found');

    const sessions = await this.prisma.judgingSession.findMany({
      where: { eventId, stage: { notIn: ['CANCELLED'] } },
      include: { team: true, room: true, judges: true, scorecards: true },
    });

    return sessions.map(s => {
      const issues: string[] = [];
      if (s.judges.length < event.minJudgesPerTeam) issues.push(`${s.judges.length}/${event.minJudgesPerTeam} judges`);
      const pending = s.scorecards.filter(sc => sc.status === 'NOT_STARTED').length;
      if (s.stage === 'COMPLETED' && pending > 0) issues.push(`${pending} scorecard(s) not started`);
      return { sessionId: s.id, teamName: s.team.name, roomName: s.room.name, stage: s.stage, judgesAssigned: s.judges.length, judgesRequired: event.minJudgesPerTeam, isHealthy: issues.length === 0, issues };
    });
  }
}
