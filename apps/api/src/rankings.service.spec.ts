import { Test, TestingModule } from '@nestjs/testing';
import { RankingsService } from './rankings/rankings.service';
import { PrismaService } from './prisma/prisma.service';
import { AuditService } from './audit/audit.service';
import { BadRequestException } from '@nestjs/common';

describe('RankingsService', () => {
  let service: RankingsService;
  let prisma: any;
  let audit: any;

  const mockCriteria = [
    { id: 'c1', name: 'Innovation', maxScore: 20, displayOrder: 1 },
    { id: 'c2', name: 'Impact', maxScore: 40, displayOrder: 2 },
    { id: 'c3', name: 'Feasibility', maxScore: 10, displayOrder: 3 },
    { id: 'c4', name: 'Collaboration', maxScore: 20, displayOrder: 4 },
    { id: 'c5', name: 'Bonus', maxScore: 10, displayOrder: 5 },
  ];

  beforeEach(async () => {
    prisma = {
      scoringTemplate: { findFirst: jest.fn() },
      team: { findMany: jest.fn() },
      scorecard: { findMany: jest.fn() },
      sessionJudge: { findMany: jest.fn() },
      rankingResult: { deleteMany: jest.fn(), createMany: jest.fn() },
      challengeTrack: { findUnique: jest.fn() },
    };
    audit = { log: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RankingsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: audit },
      ],
    }).compile();

    service = module.get<RankingsService>(RankingsService);
  });

  describe('calculateRankings', () => {
    it('should throw if no scoring template exists', async () => {
      prisma.scoringTemplate.findFirst.mockResolvedValue(null);
      await expect(service.calculateRankings('evt1', null, 'user1'))
        .rejects.toThrow(BadRequestException);
    });

    it('should throw if no teams found', async () => {
      prisma.scoringTemplate.findFirst.mockResolvedValue({ criteria: mockCriteria });
      prisma.team.findMany.mockResolvedValue([]);
      await expect(service.calculateRankings('evt1', null, 'user1'))
        .rejects.toThrow(BadRequestException);
    });

    it('should calculate criterion averages correctly for single judge', async () => {
      prisma.scoringTemplate.findFirst.mockResolvedValue({ criteria: mockCriteria });
      prisma.team.findMany.mockResolvedValue([
        { id: 't1', name: 'Team A', projectName: 'Project A', track: null, trackId: null },
      ]);
      prisma.sessionJudge.findMany.mockResolvedValue([]);
      prisma.scorecard.findMany.mockResolvedValue([{
        teamId: 't1',
        criterionScores: [
          { criterionId: 'c1', score: 15, criterion: mockCriteria[0] },
          { criterionId: 'c2', score: 30, criterion: mockCriteria[1] },
          { criterionId: 'c3', score: 8, criterion: mockCriteria[2] },
          { criterionId: 'c4', score: 16, criterion: mockCriteria[3] },
          { criterionId: 'c5', score: 7, criterion: mockCriteria[4] },
        ],
      }]);
      prisma.rankingResult.deleteMany.mockResolvedValue({});
      prisma.rankingResult.createMany.mockResolvedValue({});

      const result = await service.calculateRankings('evt1', null, 'user1');

      expect(result.teamsRanked).toBe(1);
      expect(result.rankings[0].aggregatedScore).toBe(76);
      expect(result.rankings[0].criterionAverages[0].average).toBe(15); // Innovation
      expect(result.rankings[0].criterionAverages[1].average).toBe(30); // Impact
      expect(result.rankings[0].judgeCount).toBe(1);
    });

    it('should average scores across multiple judges', async () => {
      prisma.scoringTemplate.findFirst.mockResolvedValue({ criteria: [mockCriteria[0]] }); // Just Innovation /20
      prisma.team.findMany.mockResolvedValue([
        { id: 't1', name: 'Team A', projectName: 'Project A', track: null, trackId: null },
      ]);
      prisma.sessionJudge.findMany.mockResolvedValue([]);
      prisma.scorecard.findMany.mockResolvedValue([
        { teamId: 't1', criterionScores: [{ criterionId: 'c1', score: 14, criterion: mockCriteria[0] }] },
        { teamId: 't1', criterionScores: [{ criterionId: 'c1', score: 18, criterion: mockCriteria[0] }] },
        { teamId: 't1', criterionScores: [{ criterionId: 'c1', score: 16, criterion: mockCriteria[0] }] },
      ]);
      prisma.rankingResult.deleteMany.mockResolvedValue({});
      prisma.rankingResult.createMany.mockResolvedValue({});

      const result = await service.calculateRankings('evt1', null, 'user1');

      expect(result.rankings[0].aggregatedScore).toBe(16); // (14+18+16)/3
      expect(result.rankings[0].judgeCount).toBe(3);
    });

    it('should rank teams by score descending', async () => {
      prisma.scoringTemplate.findFirst.mockResolvedValue({ criteria: [mockCriteria[0]] });
      prisma.team.findMany.mockResolvedValue([
        { id: 't1', name: 'Team A', projectName: 'PA', track: null, trackId: null },
        { id: 't2', name: 'Team B', projectName: 'PB', track: null, trackId: null },
        { id: 't3', name: 'Team C', projectName: 'PC', track: null, trackId: null },
      ]);
      prisma.sessionJudge.findMany.mockResolvedValue([]);
      prisma.scorecard.findMany.mockResolvedValue([
        { teamId: 't1', criterionScores: [{ criterionId: 'c1', score: 15, criterion: mockCriteria[0] }] },
        { teamId: 't2', criterionScores: [{ criterionId: 'c1', score: 18, criterion: mockCriteria[0] }] },
        { teamId: 't3', criterionScores: [{ criterionId: 'c1', score: 12, criterion: mockCriteria[0] }] },
      ]);
      prisma.rankingResult.deleteMany.mockResolvedValue({});
      prisma.rankingResult.createMany.mockResolvedValue({});

      const result = await service.calculateRankings('evt1', null, 'user1');

      expect(result.rankings[0].teamName).toBe('Team B'); // 18 - highest
      expect(result.rankings[0].rankPosition).toBe(1);
      expect(result.rankings[1].teamName).toBe('Team A'); // 15
      expect(result.rankings[1].rankPosition).toBe(2);
      expect(result.rankings[2].teamName).toBe('Team C'); // 12
      expect(result.rankings[2].rankPosition).toBe(3);
    });

    it('should handle tied scores with same rank position', async () => {
      prisma.scoringTemplate.findFirst.mockResolvedValue({ criteria: [mockCriteria[0]] });
      prisma.team.findMany.mockResolvedValue([
        { id: 't1', name: 'Team A', projectName: 'PA', track: null, trackId: null },
        { id: 't2', name: 'Team B', projectName: 'PB', track: null, trackId: null },
      ]);
      prisma.sessionJudge.findMany.mockResolvedValue([]);
      prisma.scorecard.findMany.mockResolvedValue([
        { teamId: 't1', criterionScores: [{ criterionId: 'c1', score: 15, criterion: mockCriteria[0] }] },
        { teamId: 't2', criterionScores: [{ criterionId: 'c1', score: 15, criterion: mockCriteria[0] }] },
      ]);
      prisma.rankingResult.deleteMany.mockResolvedValue({});
      prisma.rankingResult.createMany.mockResolvedValue({});

      const result = await service.calculateRankings('evt1', null, 'user1');

      // Both should have same rank since same score
      expect(result.rankings[0].aggregatedScore).toBe(15);
      expect(result.rankings[1].aggregatedScore).toBe(15);
    });

    it('should skip teams with no submitted scorecards', async () => {
      prisma.scoringTemplate.findFirst.mockResolvedValue({ criteria: [mockCriteria[0]] });
      prisma.team.findMany.mockResolvedValue([
        { id: 't1', name: 'Team A', projectName: 'PA', track: null, trackId: null },
        { id: 't2', name: 'Team B', projectName: 'PB', track: null, trackId: null },
      ]);
      prisma.sessionJudge.findMany.mockResolvedValue([]);
      prisma.scorecard.findMany.mockResolvedValue([
        { teamId: 't1', criterionScores: [{ criterionId: 'c1', score: 15, criterion: mockCriteria[0] }] },
        // t2 has no scorecards
      ]);
      prisma.rankingResult.deleteMany.mockResolvedValue({});
      prisma.rankingResult.createMany.mockResolvedValue({});

      const result = await service.calculateRankings('evt1', null, 'user1');

      expect(result.teamsRanked).toBe(1);
      expect(result.teamsWithIncompleteScores).toBe(1);
    });

    it('should handle null scores in criterion scores', async () => {
      prisma.scoringTemplate.findFirst.mockResolvedValue({ criteria: [mockCriteria[0]] });
      prisma.team.findMany.mockResolvedValue([
        { id: 't1', name: 'Team A', projectName: 'PA', track: null, trackId: null },
      ]);
      prisma.sessionJudge.findMany.mockResolvedValue([]);
      prisma.scorecard.findMany.mockResolvedValue([{
        teamId: 't1',
        criterionScores: [
          { criterionId: 'c1', score: 15, criterion: mockCriteria[0] },
          { criterionId: 'c1', score: null, criterion: mockCriteria[0] },
        ],
      }]);
      prisma.rankingResult.deleteMany.mockResolvedValue({});
      prisma.rankingResult.createMany.mockResolvedValue({});

      const result = await service.calculateRankings('evt1', null, 'user1');

      // Should only average non-null scores
      expect(result.rankings[0].aggregatedScore).toBe(15);
    });

    it('should set status to PROVISIONAL', async () => {
      prisma.scoringTemplate.findFirst.mockResolvedValue({ criteria: [mockCriteria[0]] });
      prisma.team.findMany.mockResolvedValue([
        { id: 't1', name: 'Team A', projectName: 'PA', track: null, trackId: null },
      ]);
      prisma.sessionJudge.findMany.mockResolvedValue([]);
      prisma.scorecard.findMany.mockResolvedValue([
        { teamId: 't1', criterionScores: [{ criterionId: 'c1', score: 15, criterion: mockCriteria[0] }] },
      ]);
      prisma.rankingResult.deleteMany.mockResolvedValue({});
      prisma.rankingResult.createMany.mockResolvedValue({});

      const result = await service.calculateRankings('evt1', null, 'user1');

      expect(result.status).toBe('PROVISIONAL');
    });

    it('should create audit log entry', async () => {
      prisma.scoringTemplate.findFirst.mockResolvedValue({ criteria: [mockCriteria[0]] });
      prisma.team.findMany.mockResolvedValue([
        { id: 't1', name: 'Team A', projectName: 'PA', track: null, trackId: null },
      ]);
      prisma.sessionJudge.findMany.mockResolvedValue([]);
      prisma.scorecard.findMany.mockResolvedValue([
        { teamId: 't1', criterionScores: [{ criterionId: 'c1', score: 15, criterion: mockCriteria[0] }] },
      ]);
      prisma.rankingResult.deleteMany.mockResolvedValue({});
      prisma.rankingResult.createMany.mockResolvedValue({});

      await service.calculateRankings('evt1', null, 'user1');

      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user1',
          eventId: 'evt1',
          entityType: 'RankingResult',
        }),
      );
    });
  });
});
