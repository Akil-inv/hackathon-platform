import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { RankingStatus, AuditAction, ScorecardStatus } from '@prisma/client';
import { RankingOutput } from './rankings.types';

@Injectable()
export class RankingsService {
  private readonly logger = new Logger(RankingsService.name);

  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /**
   * Fetch judge names for a list of teams from session assignments.
   */
  private async getTeamJudgeNames(eventId: string, teamIds: string[]): Promise<Map<string, string[]>> {
    const sessionJudges = await this.prisma.sessionJudge.findMany({
      where: { session: { eventId, teamId: { in: teamIds } } },
      include: { judge: true, session: true },
    });
    const map = new Map<string, string[]>();
    for (const sj of sessionJudges) {
      const names = map.get(sj.session.teamId) || [];
      if (!names.includes(sj.judge.name)) names.push(sj.judge.name);
      map.set(sj.session.teamId, names);
    }
    return map;
  }

  /**
   * Core ranking calculation:
   * 1. Find all teams (optionally filtered by track)
   * 2. For each team, find all SUBMITTED/LOCKED scorecards
   * 3. For each criterion, average the scores across judges
   * 4. Sum criterion averages = team aggregated score
   * 5. Rank by aggregated score descending
   * 6. Tie-break: highest single criterion average, then judge count
   * 7. Store results in ranking_results table
   */
  async calculateRankings(
    eventId: string,
    trackId: string | null,
    userId: string,
  ): Promise<RankingOutput> {
    this.logger.log(`Calculating rankings for event ${eventId}, track ${trackId || 'overall'}`);

    // Get scoring criteria for this event
    const template = await this.prisma.scoringTemplate.findFirst({
      where: { eventId },
      include: { criteria: { orderBy: { displayOrder: 'asc' } } },
    });

    if (!template || template.criteria.length === 0) {
      throw new BadRequestException('No scoring template found for this event');
    }

    // Categories carry no scores of their own — including them would add a run
    // of zeroes to every team's criterion breakdown.
    const parentIds = new Set(template.criteria.map((c: any) => c.parentId).filter(Boolean));
    const criteria = template.criteria.filter((c: any) => !parentIds.has(c.id));

    // Get teams
    const teamWhere: any = { eventId, deletedAt: null };
    if (trackId) teamWhere.trackId = trackId;
    const teams = await this.prisma.team.findMany({
      where: teamWhere,
      include: { track: true },
    });

    if (teams.length === 0) {
      throw new BadRequestException('No teams found');
    }

    // Get all submitted/locked scorecards for these teams
    const teamIds = teams.map(t => t.id);
    const scorecards = await this.prisma.scorecard.findMany({
      where: {
        eventId,
        teamId: { in: teamIds },
        status: { in: [ScorecardStatus.SUBMITTED, ScorecardStatus.RESUBMITTED, ScorecardStatus.LOCKED] },
      },
      include: {
        criterionScores: {
          include: { criterion: true },
        },
      },
    });

    // Get judge names per team
    const teamJudgeNames = await this.getTeamJudgeNames(eventId, teamIds);

    // Group scorecards by team
    const teamScorecards = new Map<string, typeof scorecards>();
    for (const sc of scorecards) {
      const arr = teamScorecards.get(sc.teamId) || [];
      arr.push(sc);
      teamScorecards.set(sc.teamId, arr);
    }

    // Calculate scores per team
    let teamsWithIncompleteScores = 0;
    const teamScores: Array<{
      teamId: string;
      teamName: string;
      projectName: string;
      trackName: string | null;
      trackId: string | null;
      aggregatedScore: number;
      judgeCount: number;
      judgeNames: string;
      criterionAverages: Array<{
        criterionId: string;
        criterionName: string;
        average: number;
        maxScore: number;
      }>;
    }> = [];

    for (const team of teams) {
      const cards = teamScorecards.get(team.id) || [];
      if (cards.length === 0) {
        teamsWithIncompleteScores++;
        continue;
      }

      const judgeCount = cards.length;
      const criterionAverages: typeof teamScores[0]['criterionAverages'] = [];

      for (const criterion of criteria) {
        // Collect all scores for this criterion across judges
        const scores: number[] = [];
        for (const card of cards) {
          const cs = card.criterionScores.find(
            s => s.criterionId === criterion.id,
          );
          if (cs && cs.score !== null) scores.push(cs.score);
        }

        const average =
          scores.length > 0
            ? scores.reduce((a, b) => a + b, 0) / scores.length
            : 0;

        criterionAverages.push({
          criterionId: criterion.id,
          criterionName: criterion.name,
          average: Math.round(average * 100) / 100,
          maxScore: criterion.maxScore,
        });
      }

      const aggregatedScore = criterionAverages.reduce(
        (sum, ca) => sum + ca.average,
        0,
      );

      teamScores.push({
        teamId: team.id,
        teamName: team.name,
        projectName: team.projectName,
        trackName: team.track?.name || null,
        trackId: team.trackId || null,
        aggregatedScore: Math.round(aggregatedScore * 100) / 100,
        judgeCount,
        judgeNames: (teamJudgeNames.get(team.id) || []).join(', '),
        criterionAverages,
      });
    }

    // Sort: primary by aggregated score desc, tie-break by highest criterion average, then judge count
    teamScores.sort((a, b) => {
      if (b.aggregatedScore !== a.aggregatedScore) {
        return b.aggregatedScore - a.aggregatedScore;
      }
      // Tie-break 1: highest single criterion average
      const aMax = Math.max(...a.criterionAverages.map(c => c.average));
      const bMax = Math.max(...b.criterionAverages.map(c => c.average));
      if (bMax !== aMax) return bMax - aMax;
      // Tie-break 2: more judges = higher confidence
      return b.judgeCount - a.judgeCount;
    });

    // Clear old rankings for this scope
    const deleteWhere: any = { eventId };
    if (trackId) {
      deleteWhere.trackId = trackId;
    } else {
      deleteWhere.trackId = null;
    }
    await this.prisma.rankingResult.deleteMany({ where: deleteWhere });

    // Insert new rankings
    let rank = 1;
    const rankingsData: any[] = [];
    for (let i = 0; i < teamScores.length; i++) {
      const ts = teamScores[i];
      // Same score as previous = same rank
      if (i > 0 && ts.aggregatedScore === teamScores[i - 1].aggregatedScore) {
        // keep same rank
      } else {
        rank = i + 1;
      }

      rankingsData.push({
        eventId,
        trackId: trackId || null,
        teamId: ts.teamId,
        rankPosition: rank,
        aggregatedScore: ts.aggregatedScore,
        judgeCount: ts.judgeCount,
        aggregationMethod: 'criterion_average_sum',
        status: RankingStatus.PROVISIONAL,
      });
    }

    if (rankingsData.length > 0) {
      await this.prisma.rankingResult.createMany({ data: rankingsData });
    }

    // Audit log
    await this.audit.log({
      userId,
      eventId,
      action: AuditAction.UPDATE,
      entityType: 'RankingResult',
      entityId: trackId || 'overall',
      newValues: {
        status: 'PROVISIONAL',
        teamsRanked: teamScores.length,
        scope: trackId ? 'track' : 'overall',
      },
    });

    const track = trackId
      ? await this.prisma.challengeTrack.findUnique({ where: { id: trackId } })
      : null;

    return {
      eventId,
      trackId: trackId || undefined,
      trackName: track?.name || 'Overall',
      status: RankingStatus.PROVISIONAL,
      teamsRanked: teamScores.length,
      teamsWithIncompleteScores,
      calculatedAt: new Date().toISOString(),
      rankings: teamScores.map((ts, i) => ({
        teamId: ts.teamId,
        teamName: ts.teamName,
        projectName: ts.projectName,
        trackName: ts.trackName || undefined,
        trackId: ts.trackId || undefined,
        rankPosition: rankingsData[i]?.rankPosition || i + 1,
        aggregatedScore: ts.aggregatedScore,
        judgeCount: ts.judgeCount,
        judgeNames: ts.judgeNames,
        criterionAverages: ts.criterionAverages,
        tieBreakNote:
          i > 0 && ts.aggregatedScore === teamScores[i - 1].aggregatedScore
            ? 'Tie broken by highest criterion average, then judge count'
            : undefined,
      })),
    };
  }

  async getRankings(
    eventId: string,
    trackId?: string,
  ): Promise<RankingOutput | null> {
    const where: any = { eventId };
    if (trackId) {
      where.trackId = trackId;
    } else {
      where.trackId = null;
    }

    const rankings = await this.prisma.rankingResult.findMany({
      where,
      orderBy: { rankPosition: 'asc' },
      include: { team: { include: { track: true } } },
    });

    if (rankings.length === 0) return null;

    const track = trackId
      ? await this.prisma.challengeTrack.findUnique({ where: { id: trackId } })
      : null;

    // Fetch criterion averages from scorecards (not stored in ranking_results)
    const template = await this.prisma.scoringTemplate.findFirst({
      where: { eventId },
      include: { criteria: { orderBy: { displayOrder: 'asc' } } },
    });
    const allCriteria = template?.criteria || [];
    const getParentIds = new Set(allCriteria.map((c: any) => c.parentId).filter(Boolean));
    const criteria = allCriteria.filter((c: any) => !getParentIds.has(c.id));

    const teamIds = rankings.map(r => r.teamId);

    // Fetch judge names per team
    const teamJudgeNames = await this.getTeamJudgeNames(eventId, teamIds);

    const scorecards = await this.prisma.scorecard.findMany({
      where: {
        eventId,
        teamId: { in: teamIds },
        status: { in: ['SUBMITTED', 'RESUBMITTED', 'LOCKED'] },
      },
      include: { criterionScores: true },
    });

    // Build criterion averages per team
    const teamCriterionAvgs = new Map<string, any[]>();
    for (const teamId of teamIds) {
      const cards = scorecards.filter(sc => sc.teamId === teamId);
      const avgs = criteria.map(cr => {
        const scores: number[] = cards
          .flatMap(c => c.criterionScores)
          .filter(cs => cs.criterionId === cr.id && cs.score !== null)
          .map(cs => cs.score!);
        const avg = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
        return {
          criterionId: cr.id,
          criterionName: cr.name,
          average: Math.round(avg * 100) / 100,
          maxScore: cr.maxScore,
        };
      });
      teamCriterionAvgs.set(teamId, avgs);
    }

    return {
      eventId,
      trackId,
      trackName: track?.name || 'Overall',
      status: rankings[0]?.status || RankingStatus.CALCULATING,
      teamsRanked: rankings.length,
      teamsWithIncompleteScores: 0,
      calculatedAt: rankings[0]?.createdAt?.toISOString(),
      rankings: rankings.map((r, i) => ({
        teamId: r.teamId,
        teamName: r.team.name,
        projectName: r.team.projectName,
        trackName: r.team.track?.name || undefined,
        trackId: r.team.trackId || undefined,
        rankPosition: r.rankPosition,
        aggregatedScore: Number(r.aggregatedScore),
        judgeCount: r.judgeCount,
        judgeNames: (teamJudgeNames.get(r.teamId) || []).join(', '),
        criterionAverages: teamCriterionAvgs.get(r.teamId) || [],
        tieBreakNote:
          i > 0 && Number(r.aggregatedScore) === Number(rankings[i - 1].aggregatedScore)
            ? 'Tie broken by highest criterion average, then judge count'
            : undefined,
      })),
    };
  }

  async approveRankings(
    eventId: string,
    trackId: string | null,
    userId: string,
  ): Promise<RankingOutput | null> {
    const where: any = { eventId, status: RankingStatus.PROVISIONAL };
    if (trackId) {
      where.trackId = trackId;
    } else {
      where.trackId = null;
    }

    const updated = await this.prisma.rankingResult.updateMany({
      where,
      data: {
        status: RankingStatus.APPROVED,
        approvedBy: userId,
        approvedAt: new Date(),
      },
    });

    this.logger.log(`Approved ${updated.count} rankings`);

    await this.audit.log({
      userId,
      eventId,
      action: AuditAction.UPDATE,
      entityType: 'RankingResult',
      entityId: trackId || 'overall',
      newValues: { status: 'APPROVED' },
    });

    return this.getRankings(eventId, trackId || undefined);
  }

  async publishRankings(
    eventId: string,
    trackId: string | null,
    userId: string,
  ): Promise<RankingOutput | null> {
    const where: any = { eventId, status: RankingStatus.APPROVED };
    if (trackId) {
      where.trackId = trackId;
    } else {
      where.trackId = null;
    }

    const updated = await this.prisma.rankingResult.updateMany({
      where,
      data: {
        status: RankingStatus.PUBLISHED,
        publishedAt: new Date(),
      },
    });

    this.logger.log(`Published ${updated.count} rankings`);

    await this.audit.log({
      userId,
      eventId,
      action: AuditAction.UPDATE,
      entityType: 'RankingResult',
      entityId: trackId || 'overall',
      newValues: { status: 'PUBLISHED' },
    });

    return this.getRankings(eventId, trackId || undefined);
  }
}
