import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, ScorecardStatus } from '@prisma/client';
import { SaveScorecardInput, SubmitScorecardInput } from './scorecards.types';

@Injectable()
export class ScorecardsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private enrichScorecard(sc: any) {
    return {
      ...sc,
      judgeName: sc.judge?.name || '',
      teamName: sc.team?.name || '',
      projectName: sc.team?.projectName || '',
      criterionScores: (sc.criterionScores || []).map((cs: any) => ({
        id: cs.id,
        criterionId: cs.criterionId,
        criterionName: cs.criterion?.name || '',
        maxScore: cs.criterion?.maxScore || 0,
        guidanceText: cs.criterion?.guidanceText || null,
        requiresComment: cs.criterion?.requiresComment || false,
        score: cs.score,
        comment: cs.comment,
      })),
    };
  }

  // ─── SECURITY: Check if scoring is allowed ───
  private async assertScoringAllowed(scorecard: any) {
    // Check event is not completed
    const event = await this.prisma.event.findUnique({ where: { id: scorecard.eventId } });
    if (!event) throw new NotFoundException('Event not found');
    if (event.status === 'COMPLETED' || event.status === 'ARCHIVED') {
      throw new BadRequestException('Event is closed. No more scoring allowed.');
    }

    // Check session is in a scoreable stage
    const session = await this.prisma.judgingSession.findUnique({ where: { id: scorecard.sessionId } });
    if (!session) throw new NotFoundException('Session not found');

    const scoreableStages = ['SCORING', 'COMPLETED', 'QA', 'IN_PROGRESS'];
    if (!scoreableStages.includes(session.stage)) {
      throw new BadRequestException(`Scoring not enabled. Session is in ${session.stage} stage. Organizer must start the session first.`);
    }
  }

  async findByJudge(judgeId: string, eventId: string) {
    const scorecards = await this.prisma.scorecard.findMany({
      where: { judgeId, eventId },
      include: {
        judge: true, team: true,
        criterionScores: { include: { criterion: true }, orderBy: { criterion: { displayOrder: 'asc' } } },
        session: { include: { room: true, timeSlot: true } },
      },
      orderBy: { session: { scheduledStart: 'asc' } },
    });
    return scorecards.map(sc => this.enrichScorecard(sc));
  }

  async findByTeam(teamId: string) {
    const scorecards = await this.prisma.scorecard.findMany({
      where: { teamId },
      include: {
        judge: true, team: true,
        criterionScores: { include: { criterion: true }, orderBy: { criterion: { displayOrder: 'asc' } } },
      },
    });
    return scorecards.map(sc => this.enrichScorecard(sc));
  }

  async findOne(id: string) {
    const sc = await this.prisma.scorecard.findUnique({
      where: { id },
      include: {
        judge: true, team: true,
        criterionScores: { include: { criterion: true }, orderBy: { criterion: { displayOrder: 'asc' } } },
      },
    });
    if (!sc) throw new NotFoundException('Scorecard not found');
    return this.enrichScorecard(sc);
  }

  async findByEvent(eventId: string) {
    const scorecards = await this.prisma.scorecard.findMany({
      where: { eventId },
      include: {
        judge: true, team: true,
        criterionScores: { include: { criterion: true }, orderBy: { criterion: { displayOrder: 'asc' } } },
      },
      orderBy: { createdAt: 'asc' },
    });
    return scorecards.map(sc => this.enrichScorecard(sc));
  }

  // ─── SCORING BY TOKEN (judge portal) ───
  async findByJudgeToken(judgeId: string, eventId: string) {
    const scorecards = await this.prisma.scorecard.findMany({
      where: { judgeId, eventId },
      include: {
        judge: true, team: true,
        criterionScores: { include: { criterion: true }, orderBy: { criterion: { displayOrder: 'asc' } } },
        session: { include: { room: true, timeSlot: true } },
      },
      orderBy: { session: { scheduledStart: 'asc' } },
    });

    return scorecards.map(sc => {
      const session = sc.session;
      const scoreableStages = ['SCORING', 'COMPLETED', 'QA', 'IN_PROGRESS'];
      const canScore = scoreableStages.includes(session?.stage || '') &&
        ['NOT_STARTED', 'DRAFT', 'REOPENED'].includes(sc.status);

      return {
        ...this.enrichScorecard(sc),
        sessionStage: session?.stage || 'UNKNOWN',
        roomName: session?.room?.name || '',
        scheduledStart: session?.timeSlot?.startTime,
        scheduledEnd: session?.timeSlot?.endTime,
        canScore,
      };
    });
  }

  async initializeCriterionScores(scorecardId: string, templateId: string) {
    const criteria = await this.prisma.scoringCriterion.findMany({
      where: { templateId },
      orderBy: { displayOrder: 'asc' },
    });
    for (const c of criteria) {
      await this.prisma.criterionScore.upsert({
        where: { scorecardId_criterionId: { scorecardId, criterionId: c.id } },
        create: { scorecardId, criterionId: c.id },
        update: {},
      });
    }
  }

  async saveDraft(input: SaveScorecardInput, userId: string) {
    const sc = await this.prisma.scorecard.findUnique({
      where: { id: input.scorecardId },
      include: { session: true },
    });
    if (!sc) throw new NotFoundException('Scorecard not found');

    // Security check
    await this.assertScoringAllowed(sc);

    if (['SUBMITTED', 'RESUBMITTED', 'LOCKED'].includes(sc.status)) {
      throw new BadRequestException('Cannot edit a submitted or locked scorecard');
    }

    const template = await this.prisma.scoringTemplate.findFirst({
      where: { eventId: sc.eventId, status: 'ACTIVE' },
    });
    if (template) await this.initializeCriterionScores(sc.id, template.id);

    for (const s of input.scores) {
      await this.prisma.criterionScore.upsert({
        where: { scorecardId_criterionId: { scorecardId: sc.id, criterionId: s.criterionId } },
        create: { scorecardId: sc.id, criterionId: s.criterionId, score: s.score, comment: s.comment },
        update: { score: s.score, comment: s.comment },
      });
    }

    const totalScore = input.scores.reduce((sum, s) => sum + s.score, 0);
    const newStatus = sc.status === 'NOT_STARTED' ? 'DRAFT' : sc.status === 'REOPENED' ? 'REOPENED' : 'DRAFT';

    const updated = await this.prisma.scorecard.update({
      where: { id: sc.id },
      data: {
        status: newStatus as ScorecardStatus,
        totalScore,
        overallStrengths: input.overallStrengths,
        areasForImprovement: input.areasForImprovement,
        recommendation: input.recommendation,
      },
      include: {
        judge: true, team: true,
        criterionScores: { include: { criterion: true }, orderBy: { criterion: { displayOrder: 'asc' } } },
      },
    });

    return this.enrichScorecard(updated);
  }

  async submit(input: SubmitScorecardInput, userId: string) {
    const sc = await this.prisma.scorecard.findUnique({
      where: { id: input.scorecardId },
      include: { criterionScores: { include: { criterion: true } }, session: true },
    });
    if (!sc) throw new NotFoundException('Scorecard not found');

    // Security check
    await this.assertScoringAllowed(sc);

    if (!['DRAFT', 'REOPENED'].includes(sc.status)) {
      throw new BadRequestException(`Cannot submit a scorecard with status ${sc.status}`);
    }

    for (const cs of sc.criterionScores) {
      if (cs.score === null || cs.score === undefined) {
        throw new BadRequestException(`Score for "${cs.criterion.name}" is required`);
      }
      if (cs.score > cs.criterion.maxScore) {
        throw new BadRequestException(`Score for "${cs.criterion.name}" exceeds maximum of ${cs.criterion.maxScore}`);
      }
      if (cs.criterion.requiresComment && !cs.comment?.trim()) {
        throw new BadRequestException(`Comment for "${cs.criterion.name}" is required`);
      }
    }

    if (!input.conflictConfirmed) {
      throw new BadRequestException('You must confirm no conflict of interest');
    }

    const totalScore = sc.criterionScores.reduce((sum, cs) => sum + (cs.score || 0), 0);
    const newStatus = sc.status === 'REOPENED' ? 'RESUBMITTED' : 'SUBMITTED';

    const updated = await this.prisma.scorecard.update({
      where: { id: sc.id },
      data: { status: newStatus as ScorecardStatus, totalScore, conflictConfirmed: true, submittedAt: new Date() },
      include: {
        judge: true, team: true,
        criterionScores: { include: { criterion: true }, orderBy: { criterion: { displayOrder: 'asc' } } },
      },
    });

    await this.audit.log({
      userId, eventId: sc.eventId,
      action: AuditAction.UPDATE, entityType: 'Scorecard', entityId: sc.id,
      oldValues: { status: sc.status }, newValues: { status: newStatus, totalScore },
    });

    return this.enrichScorecard(updated);
  }

  async reopen(scorecardId: string, reason: string, userId: string) {
    const sc = await this.prisma.scorecard.findUnique({ where: { id: scorecardId } });
    if (!sc) throw new NotFoundException('Scorecard not found');
    if (!['SUBMITTED', 'RESUBMITTED'].includes(sc.status)) {
      throw new BadRequestException('Can only reopen submitted scorecards');
    }

    const updated = await this.prisma.scorecard.update({
      where: { id: scorecardId },
      data: { status: 'REOPENED', reopenReason: reason },
      include: {
        judge: true, team: true,
        criterionScores: { include: { criterion: true }, orderBy: { criterion: { displayOrder: 'asc' } } },
      },
    });

    await this.audit.log({
      userId, eventId: sc.eventId,
      action: AuditAction.UPDATE, entityType: 'Scorecard', entityId: scorecardId,
      oldValues: { status: sc.status }, newValues: { status: 'REOPENED', reason },
    });

    return this.enrichScorecard(updated);
  }

  async lock(scorecardId: string, userId: string) {
    const updated = await this.prisma.scorecard.update({
      where: { id: scorecardId },
      data: { status: 'LOCKED', lockedAt: new Date() },
      include: {
        judge: true, team: true,
        criterionScores: { include: { criterion: true }, orderBy: { criterion: { displayOrder: 'asc' } } },
      },
    });
    return this.enrichScorecard(updated);
  }
}
