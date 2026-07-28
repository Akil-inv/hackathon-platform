import { Controller, Get, Post, Param, Query, Body, BadRequestException, NotFoundException, ForbiddenException } from '@nestjs/common';
import { JudgePortalService } from './judge-portal.service';
import { Public } from '../auth/public.decorator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

@Controller('api/judge-portal')
export class JudgePortalController {
  constructor(
    private service: JudgePortalService,
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  @Public()
  @Get(':token')
  async getSchedule(@Param('token') token: string, @Query('event') eventId: string) {
    return this.service.getJudgeSchedule(token, eventId);
  }

  @Public()
  @Get(':token/scorecards')
  async getScorecards(@Param('token') token: string, @Query('event') eventId: string) {
    const judge = await this.service.getJudgeByToken(token, eventId);
    const scorecards = await this.prisma.scorecard.findMany({
      where: { judgeId: judge.id, eventId },
      include: {
        judge: true, team: true,
        criterionScores: { include: { criterion: { include: { parent: true } } }, orderBy: { criterion: { displayOrder: 'asc' } } },
        session: { include: { room: true, timeSlot: true } },
      },
      orderBy: { session: { scheduledStart: 'asc' } },
    });

    // ─── Auto-create criterion scores for scorecards that have none ───
    // This ensures the judge sees sliders on first load, not just after saving a draft
    const template = await this.prisma.scoringTemplate.findFirst({
      where: { eventId },
      include: { criteria: { orderBy: { displayOrder: 'asc' } } },
    });
    if (template) {
      // Categories group the questions; they are not questions themselves.
      // Creating a score row for one would ask a judge for the same points
      // twice and put the total past 100.
      const categoryIds = new Set(
        template.criteria.map((c: any) => c.parentId).filter(Boolean) as string[],
      );
      const scoreableCriteria = template.criteria.filter((c: any) => !categoryIds.has(c.id));

      for (const sc of scorecards) {
        if (sc.criterionScores.length === 0) {
          for (const c of scoreableCriteria) {
            await this.prisma.criterionScore.upsert({
              where: { scorecardId_criterionId: { scorecardId: sc.id, criterionId: c.id } },
              create: { scorecardId: sc.id, criterionId: c.id },
              update: {},
            });
          }
          // Re-fetch so the response includes the newly created scores
          const updated = await this.prisma.scorecard.findUnique({
            where: { id: sc.id },
            include: { criterionScores: { include: { criterion: { include: { parent: true } } }, orderBy: { criterion: { displayOrder: 'asc' } } } },
          });
          if (updated) (sc as any).criterionScores = updated.criterionScores;
        }
      }
    }

    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    const eventClosed = event?.status === 'COMPLETED' || event?.status === 'ARCHIVED';

    return scorecards.map(sc => {
      const scoreableStages = ['SCORING', 'COMPLETED', 'QA', 'IN_PROGRESS'];
      const sessionActive = scoreableStages.includes(sc.session?.stage || '');
      const scorecardEditable = ['NOT_STARTED', 'DRAFT', 'REOPENED'].includes(sc.status);

      return {
        id: sc.id,
        sessionId: sc.sessionId,
        judgeId: sc.judgeId,
        teamName: sc.team?.name,
        projectName: sc.team?.projectName,
        roomName: sc.session?.room?.name,
        scheduledStart: sc.session?.timeSlot?.startTime,
        scheduledEnd: sc.session?.timeSlot?.endTime,
        sessionStage: sc.session?.stage,
        status: sc.status,
        totalScore: sc.totalScore,
        overallStrengths: sc.overallStrengths,
        areasForImprovement: sc.areasForImprovement,
        recommendation: sc.recommendation,
        submittedAt: sc.submittedAt,
        reopenReason: sc.reopenReason,
        canScore: sessionActive && scorecardEditable && !eventClosed,
        canView: sc.status !== 'NOT_STARTED',
        eventClosed,
        criterionScores: sc.criterionScores.map(cs => ({
          id: cs.id,
          criterionId: cs.criterionId,
          criterionName: cs.criterion?.name,
          maxScore: cs.criterion?.maxScore,
          guidanceText: cs.criterion?.guidanceText,
          requiresComment: cs.criterion?.requiresComment,
          scoringAnchors: cs.criterion?.scoringAnchors,
          // Lets the portal group rows under their category and show a
          // running subtotal per section.
          parentId: (cs.criterion as any)?.parentId ?? null,
          categoryName: (cs.criterion as any)?.parent?.name ?? null,
          categoryMaxScore: (cs.criterion as any)?.parent?.maxScore ?? null,
          score: cs.score,
          comment: cs.comment,
        })),
      };
    });
  }

  @Public()
  @Post(':token/score')
  async saveScore(
    @Param('token') token: string,
    @Query('event') eventId: string,
    @Body() body: {
      scorecardId: string;
      scores: Array<{ criterionId: string; score: number; comment?: string }>;
      overallStrengths?: string;
      areasForImprovement?: string;
      recommendation?: string;
      submit?: boolean;
    },
  ) {
    const judge = await this.service.getJudgeByToken(token, eventId);

    // Verify this scorecard belongs to this judge
    const scorecard = await this.prisma.scorecard.findUnique({
      where: { id: body.scorecardId },
      include: { session: true },
    });
    if (!scorecard) throw new NotFoundException('Scorecard not found');
    if (scorecard.judgeId !== judge.id) throw new ForbiddenException('This scorecard does not belong to you');

    // Check event not closed
    const event = await this.prisma.event.findUnique({ where: { id: eventId } });
    if (event?.status === 'COMPLETED' || event?.status === 'ARCHIVED') {
      throw new BadRequestException('Event is closed. No more scoring allowed.');
    }

    // Check session stage
    const scoreableStages = ['SCORING', 'COMPLETED', 'QA', 'IN_PROGRESS'];
    if (!scoreableStages.includes(scorecard.session?.stage || '')) {
      throw new BadRequestException(`Scoring not enabled. Session is ${scorecard.session?.stage}. Wait for organizer to start the session.`);
    }

    // Check scorecard is editable
    if (['SUBMITTED', 'RESUBMITTED', 'LOCKED'].includes(scorecard.status)) {
      throw new BadRequestException('Scorecard already submitted. Ask organizer to reopen if changes needed.');
    }

    // Initialize criterion scores if needed — leaves only. A category's points
    // are already represented by its rows.
    const template = await this.prisma.scoringTemplate.findFirst({ where: { eventId, status: 'ACTIVE' } });
    const categoryIds = new Set<string>();
    if (template) {
      const criteria = await this.prisma.scoringCriterion.findMany({ where: { templateId: template.id } });
      for (const c of criteria) {
        if ((c as any).parentId) categoryIds.add((c as any).parentId);
      }
      for (const c of criteria) {
        if (categoryIds.has(c.id)) continue;
        await this.prisma.criterionScore.upsert({
          where: { scorecardId_criterionId: { scorecardId: scorecard.id, criterionId: c.id } },
          create: { scorecardId: scorecard.id, criterionId: c.id },
          update: {},
        });
      }
    }

    // Save scores, dropping anything aimed at a category. A page loaded before
    // the rubric became two-level would otherwise put those rows back.
    const incoming = body.scores.filter(s => !categoryIds.has(s.criterionId));

    for (const s of incoming) {
      await this.prisma.criterionScore.upsert({
        where: { scorecardId_criterionId: { scorecardId: scorecard.id, criterionId: s.criterionId } },
        create: { scorecardId: scorecard.id, criterionId: s.criterionId, score: s.score, comment: s.comment },
        update: { score: s.score, comment: s.comment },
      });
    }

    const totalScore = incoming.reduce((sum, s) => sum + s.score, 0);

    if (body.submit) {
      // Validate all criteria scored
      const allScores = await this.prisma.criterionScore.findMany({
        where: { scorecardId: scorecard.id },
        include: { criterion: true },
      });
      for (const cs of allScores) {
        if (categoryIds.has(cs.criterionId)) continue;
        if (cs.score === null) throw new BadRequestException(`Score for "${cs.criterion.name}" is required`);
        if (cs.criterion.requiresComment && !cs.comment?.trim()) throw new BadRequestException(`Comment for "${cs.criterion.name}" is required`);
      }

      await this.prisma.scorecard.update({
        where: { id: scorecard.id },
        data: {
          status: scorecard.status === 'REOPENED' ? 'RESUBMITTED' : 'SUBMITTED',
          totalScore, conflictConfirmed: true, submittedAt: new Date(),
          overallStrengths: body.overallStrengths,
          areasForImprovement: body.areasForImprovement,
          recommendation: body.recommendation,
        },
      });
      return { success: true, message: 'Scorecard submitted', totalScore };
    } else {
      await this.prisma.scorecard.update({
        where: { id: scorecard.id },
        data: {
          status: scorecard.status === 'NOT_STARTED' ? 'DRAFT' : scorecard.status,
          totalScore,
          overallStrengths: body.overallStrengths,
          areasForImprovement: body.areasForImprovement,
          recommendation: body.recommendation,
        },
      });
      return { success: true, message: 'Draft saved', totalScore };
    }
  }
}
