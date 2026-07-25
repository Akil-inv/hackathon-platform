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
