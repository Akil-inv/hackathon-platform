import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@prisma/client';
import { SaveScheduleInput } from './sessions.types';

@Injectable()
export class SessionsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private enrichSession(s: any) {
    return {
      ...s,
      teamName: s.team?.name || '',
      projectName: s.team?.projectName || '',
      teamCountry: s.team?.country || null,
      teamPlatform: (s.team as any)?.platform || null,
      trackName: s.team?.track?.name || null,
      roomName: s.room?.name || '',
      judges: (s.judges || []).map((sj: any) => ({
        id: sj.id,
        judgeId: sj.judgeId,
        judgeName: sj.judge?.name || '',
        attended: sj.attended,
      })),
      scorecardsSubmitted: (s.scorecards || []).filter((sc: any) =>
        ['SUBMITTED', 'RESUBMITTED', 'LOCKED'].includes(sc.status)
      ).length,
      scorecardsTotal: (s.scorecards || []).length,
    };
  }

  async saveFromSchedule(inputs: SaveScheduleInput[], userId: string) {
    const results = [];

    // Auto-Generate solves the full team set from scratch, so any team that
    // already has a session would end up with two — two rooms, two time
    // slots, and duplicate scorecards feeding into rankings. Clear the
    // existing sessions for these teams first.
    //
    // Scorecards and session-judge rows are removed explicitly because the
    // foreign keys are RESTRICT; criterion_scores go first because they
    // reference the scorecards.
    const teamIds = [...new Set(inputs.map((i) => i.teamId))];
    const eventIdForClear = inputs[0]?.eventId;

    if (eventIdForClear && teamIds.length > 0) {
      const existing = await this.prisma.judgingSession.findMany({
        where: { eventId: eventIdForClear, teamId: { in: teamIds } },
        select: { id: true },
      });
      const existingIds = existing.map((s) => s.id);

      if (existingIds.length > 0) {
        await this.prisma.$transaction(async (tx) => {
          const scorecards = await tx.scorecard.findMany({
            where: { sessionId: { in: existingIds } },
            select: { id: true },
          });
          const scorecardIds = scorecards.map((sc) => sc.id);

          if (scorecardIds.length > 0) {
            await tx.criterionScore.deleteMany({ where: { scorecardId: { in: scorecardIds } } });
            await tx.scorecard.deleteMany({ where: { id: { in: scorecardIds } } });
          }
          await tx.sessionJudge.deleteMany({ where: { sessionId: { in: existingIds } } });
          await tx.judgingSession.deleteMany({ where: { id: { in: existingIds } } });
        });

        await this.audit.log({
          userId, eventId: eventIdForClear,
          action: AuditAction.DELETE, entityType: 'JudgingSession',
          entityId: 'batch-replaced',
          reason: 'Replaced by a newly generated schedule',
          oldValues: { count: existingIds.length },
        });
      }
    }

    for (const input of inputs) {
      const slot = await this.prisma.timeSlot.findUnique({ where: { id: input.timeSlotId } });

      const session = await this.prisma.judgingSession.create({
        data: {
          eventId: input.eventId,
          teamId: input.teamId,
          roomId: input.roomId,
          timeSlotId: input.timeSlotId,
          scheduledStart: slot?.startTime,
          scheduledEnd: slot?.endTime,
          judges: {
            create: input.judgeIds.map(judgeId => ({ judgeId })),
          },
        },
        include: {
          team: { include: { track: true } },
          room: true,
          judges: { include: { judge: true } },
          scorecards: true,
        },
      });

      // Create empty scorecards for each judge
      for (const judgeId of input.judgeIds) {
        await this.prisma.scorecard.create({
          data: {
            sessionId: session.id,
            judgeId,
            teamId: input.teamId,
            eventId: input.eventId,
          },
        });
      }

      results.push(this.enrichSession(session));
    }

    await this.audit.log({
      userId, eventId: inputs[0]?.eventId,
      action: AuditAction.CREATE, entityType: 'JudgingSession',
      entityId: 'batch',
      newValues: { count: inputs.length },
    });

    return results;
  }

  async findByEvent(eventId: string) {
    const sessions = await this.prisma.judgingSession.findMany({
      where: { eventId },
      orderBy: [{ scheduledStart: 'asc' }],
      include: {
        team: { include: { track: true } },
        room: true,
        judges: { include: { judge: true } },
        scorecards: true,
      },
    });
    return sessions.map(s => this.enrichSession(s));
  }

  async findOne(id: string) {
    const session = await this.prisma.judgingSession.findUnique({
      where: { id },
      include: {
        team: { include: { track: true } },
        room: true,
        judges: { include: { judge: true } },
        scorecards: true,
      },
    });
    if (!session) throw new NotFoundException('Session not found');
    return this.enrichSession(session);
  }
}
