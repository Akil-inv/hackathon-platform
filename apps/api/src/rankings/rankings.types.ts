import { ObjectType, Field, Int, Float, registerEnumType } from '@nestjs/graphql';
import { RankingStatus } from '@prisma/client';

registerEnumType(RankingStatus, { name: 'RankingStatus' });

@ObjectType()
export class CriterionAverage {
  @Field() criterionId!: string;
  @Field() criterionName!: string;
  @Field(() => Float) average!: number;
  @Field(() => Int) maxScore!: number;
}

@ObjectType()
export class TeamRanking {
  @Field() teamId!: string;
  @Field() teamName!: string;
  @Field() projectName!: string;
  @Field({ nullable: true }) trackName?: string;
  @Field({ nullable: true }) trackId?: string;
  @Field(() => Int) rankPosition!: number;
  @Field(() => Float) aggregatedScore!: number;
  @Field(() => Int) judgeCount!: number;
  @Field(() => [CriterionAverage]) criterionAverages!: CriterionAverage[];
  @Field({ nullable: true }) tieBreakNote?: string;
  @Field({ nullable: true }) judgeNames?: string;
}

@ObjectType()
export class RankingOutput {
  @Field() eventId!: string;
  @Field({ nullable: true }) trackId?: string;
  @Field({ nullable: true }) trackName?: string;
  @Field(() => RankingStatus) status!: RankingStatus;
  @Field(() => [TeamRanking]) rankings!: TeamRanking[];
  @Field(() => Int) teamsRanked!: number;
  @Field(() => Int) teamsWithIncompleteScores!: number;
  @Field({ nullable: true }) calculatedAt?: string;
}
