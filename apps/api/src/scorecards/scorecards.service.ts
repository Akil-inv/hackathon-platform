import { Injectable, NotFoundException, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, ScorecardStatus } from '@prisma/client';
import { SaveScorecardInput, SubmitScorecardInput } from './scorecards.types';
import { RankingsService } from '../rankings/rankings.service';

@Injectable()
export class ScorecardsService {
  private readonly logger = new Logger(ScorecardsService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private rankings: RankingsService,
  ) {}

  /**
   * Recompute standings after a scorecard lands.
   *
   * Deliberately not awaited by the caller and deliberately swallowing its own
   * errors: a judge submitting a scorecard should never see a failure because
   * a downstream ranking calculation had a problem. Results stay PROVISIONAL —
   * approving and publishing are still explicit admin actions.
   */
  private recalculateRankings(eventId: string, userId: string) {
    this.rankings.calculateRankings(eventId, null, userId).catch((err) => {
      this.logger.warn(`Ranking recalculation failed for event ${eventId}: ${err?.message}`);
    });
  }

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
        // Lets the judge portal group rows under their category and show a
        // running subtotal per section.
        parentId: cs.criterion?.parentId || null,
        categoryName: cs.criterion?.parent?.name || null,
        categoryMaxScore: cs.criterion?.parent?.maxScore || null,
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
        criterionScores: { include: { criterion: { include: { parent: true } } }, orderBy: { criterion: { displayOrder: 'asc' } } },
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
        criterionScores: { include: { criterion: { include: { parent: true } } }, orderBy: { criterion: { displayOrder: 'asc' } } },
      },
    });
    return scorecards.map(sc => this.enrichScorecard(sc));
  }

  async findOne(id: string) {
    const sc = await this.prisma.scorecard.findUnique({
      where: { id },
      include: {
        judge: true, team: true,
        criterionScores: { include: { criterion: { include: { parent: true } } }, orderBy: { criterion: { displayOrder: 'asc' } } },
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
        criterionScores: { include: { criterion: { include: { parent: true } } }, orderBy: { criterion: { displayOrder: 'asc' } } },
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
        criterionScores: { include: { criterion: { include: { parent: true } } }, orderBy: { criterion: { displayOrder: 'asc' } } },
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
    const all = await this.prisma.scoringCriterion.findMany({
      where: { templateId },
      orderBy: { displayOrder: 'asc' },
    });

    // Only leaves are scored. A criterion with children is a category — a
    // grouping for display and roll-up, not a question a judge answers.
    // Scoring both would ask for the same points twice and make 100
    // unreachable.
    const parentIds = new Set(all.map((c: any) => c.parentId).filter(Boolean));
    const criteria = all.filter((c: any) => !parentIds.has(c.id));

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

    // Categories are groupings, not questions. A client that renders one as a
    // slider — a stale page, or a replayed request — would otherwise write a
    // score against it and push the total past the maximum, because the
    // category's points are already represented by its rows.
    //
    // Dropped silently rather than rejected: a judge mid-session should not
    // hit an error because their page is a version behind.
    const allCriteria = await this.prisma.scoringCriterion.findMany({
      where: { templateId: template?.id ?? '' },
      select: { id: true, parentId: true },
    });
    const categoryIds = new Set(
      allCriteria.map((c: any) => c.parentId).filter(Boolean) as string[],
    );

    const scores = input.scores.filter(s => !categoryIds.has(s.criterionId));

    for (const s of scores) {
      await this.prisma.criterionScore.upsert({
        where: { scorecardId_criterionId: { scorecardId: sc.id, criterionId: s.criterionId } },
        create: { scorecardId: sc.id, criterionId: s.criterionId, score: s.score, comment: s.comment },
        update: { score: s.score, comment: s.comment },
      });
    }

    const totalScore = scores.reduce((sum, s) => sum + s.score, 0);
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
        criterionScores: { include: { criterion: { include: { parent: true } } }, orderBy: { criterion: { displayOrder: 'asc' } } },
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
        criterionScores: { include: { criterion: { include: { parent: true } } }, orderBy: { criterion: { displayOrder: 'asc' } } },
      },
    });

    await this.audit.log({
      userId, eventId: sc.eventId,
      action: AuditAction.UPDATE, entityType: 'Scorecard', entityId: sc.id,
      oldValues: { status: sc.status }, newValues: { status: newStatus, totalScore },
    });

    this.recalculateRankings(sc.eventId, userId);

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
        criterionScores: { include: { criterion: { include: { parent: true } } }, orderBy: { criterion: { displayOrder: 'asc' } } },
      },
    });

    await this.audit.log({
      userId, eventId: sc.eventId,
      action: AuditAction.UPDATE, entityType: 'Scorecard', entityId: scorecardId,
      oldValues: { status: sc.status }, newValues: { status: 'REOPENED', reason },
    });

    this.recalculateRankings(sc.eventId, userId);

    return this.enrichScorecard(updated);
  }

  async lock(scorecardId: string, userId: string) {
    const updated = await this.prisma.scorecard.update({
      where: { id: scorecardId },
      data: { status: 'LOCKED', lockedAt: new Date() },
      include: {
        judge: true, team: true,
        criterionScores: { include: { criterion: { include: { parent: true } } }, orderBy: { criterion: { displayOrder: 'asc' } } },
      },
    });
    return this.enrichScorecard(updated);
  }
}
