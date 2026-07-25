import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class JudgePortalService {
  constructor(private prisma: PrismaService) {}

  generateToken(judgeId: string): string {
    return crypto.createHash('sha256').update(judgeId + 'hackjudge-salt-2026').digest('hex').substring(0, 16);
  }

  async getJudgeByToken(token: string, eventId: string) {
    const judges = await this.prisma.judge.findMany({ where: { eventId, deletedAt: null } });
    const judge = judges.find(j => this.generateToken(j.id) === token);
    if (!judge) throw new NotFoundException('Invalid judge link');
    return judge;
  }

  async getJudgeSchedule(token: string, eventId: string) {
    const judge = await this.getJudgeByToken(token, eventId);
    const sessions = await this.prisma.sessionJudge.findMany({
      where: { judgeId: judge.id, session: { eventId, stage: { notIn: ['CANCELLED'] } } },
      include: {
        session: {
          include: {
            team: { include: { track: true } },
            room: true, timeSlot: true,
            judges: { include: { judge: true } },
            scorecards: { where: { judgeId: judge.id } },
          },
        },
      },
      orderBy: { session: { scheduledStart: 'asc' } },
    });

    return {
      judge: { id: judge.id, name: judge.name, email: judge.email, judgeType: judge.judgeType, organisation: judge.organisation },
      sessions: sessions.map(sj => {
        const s = sj.session;
        const sc = s.scorecards?.[0];
        return {
          sessionId: s.id, scorecardId: sc?.id || null,
          scorecardStatus: sc?.status || 'NO_SCORECARD', totalScore: sc?.totalScore || null,
          team: { name: s.team.name, projectName: s.team.projectName, track: s.team.track?.name || null,
            organisation: s.team.organisation || null, department: (s.team as any).department || null,
            vendorTools: (s.team as any).vendorTools || null, techStack: s.team.techStack || null },
          room: s.room.name, date: s.timeSlot.date, startTime: s.timeSlot.startTime, endTime: s.timeSlot.endTime, stage: s.stage,
          fellowJudges: s.judges.filter((j: any) => j.judgeId !== judge.id).map((j: any) => ({ name: j.judge.name, type: j.judge.judgeType })),
        };
      }),
    };
  }

  async generateAllLinks(eventId: string) {
    const judges = await this.prisma.judge.findMany({ where: { eventId, deletedAt: null, status: 'ACTIVE' }, orderBy: { name: 'asc' } });
    return judges.map(j => ({ judgeId: j.id, name: j.name, email: j.email, phone: j.phone || null, token: this.generateToken(j.id), link: `/judge/${this.generateToken(j.id)}?event=${eventId}` }));
  }
}
