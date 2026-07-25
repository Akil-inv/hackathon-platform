import { ObjectType, Field, InputType, Int, Float } from '@nestjs/graphql';

@ObjectType()
export class SessionAssignment {
  @Field() teamId!: string;
  @Field() teamName!: string;
  @Field() roomId!: string;
  @Field() roomName!: string;
  @Field() slotId!: string;
  @Field() slotDate!: string;
  @Field() slotStart!: string;
  @Field() slotEnd!: string;
  @Field(() => [String]) judgeIds!: string[];
  @Field(() => [String]) judgeNames!: string[];
}

@ObjectType()
export class ScheduleResult {
  @Field() success!: boolean;
  @Field(() => [SessionAssignment]) sessions!: SessionAssignment[];
  @Field(() => [String]) unscheduledTeams!: string[];
  @Field(() => [String]) warnings!: string[];
  @Field(() => Float) qualityScore!: number;
  @Field(() => Float) solveTimeSeconds!: number;
}

@InputType()
export class GenerateScheduleInput {
  @Field() eventId!: string;
  @Field(() => Int, { defaultValue: 3 }) minJudgesPerTeam!: number;
  @Field(() => Int, { defaultValue: 5 }) maxJudgesPerTeam!: number;
}
