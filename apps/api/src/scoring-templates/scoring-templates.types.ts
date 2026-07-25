import { ObjectType, Field, InputType, Int, Float, registerEnumType } from '@nestjs/graphql';
import { ScoringTemplateStatus } from '@prisma/client';
import { GraphQLJSON } from 'graphql-type-json';

registerEnumType(ScoringTemplateStatus, { name: 'ScoringTemplateStatus' });

@ObjectType()
export class ScoringCriterionEntity {
  @Field() id!: string;
  @Field() templateId!: string;
  @Field() name!: string;
  @Field({ nullable: true }) description?: string;
  @Field(() => Int) maxScore!: number;
  @Field(() => Float) weight!: number;
  @Field(() => Int) displayOrder!: number;
  @Field({ nullable: true }) guidanceText?: string;
  @Field(() => GraphQLJSON, { nullable: true }) scoringAnchors?: any;
  @Field() requiresComment!: boolean;
  @Field(() => Float) scoreIncrement!: number;
}

@ObjectType()
export class ScoringTemplateEntity {
  @Field() id!: string;
  @Field() eventId!: string;
  @Field() name!: string;
  @Field({ nullable: true }) description?: string;
  @Field(() => Int) maxTotal!: number;
  @Field(() => ScoringTemplateStatus) status!: ScoringTemplateStatus;
  @Field() createdAt!: Date;
  @Field(() => [ScoringCriterionEntity]) criteria!: ScoringCriterionEntity[];
  @Field(() => Int) criteriaTotal!: number;
}

@InputType()
export class CreateScoringTemplateInput {
  @Field() eventId!: string;
  @Field() name!: string;
  @Field({ nullable: true }) description?: string;
}

@InputType()
export class UpdateScoringTemplateInput {
  @Field({ nullable: true }) name?: string;
  @Field({ nullable: true }) description?: string;
  @Field(() => ScoringTemplateStatus, { nullable: true }) status?: ScoringTemplateStatus;
}

@InputType()
export class AddCriterionInput {
  @Field() templateId!: string;
  @Field() name!: string;
  @Field({ nullable: true }) description?: string;
  @Field(() => Int) maxScore!: number;
  @Field(() => Float, { defaultValue: 1.0 }) weight!: number;
  @Field({ nullable: true }) guidanceText?: string;
  @Field(() => GraphQLJSON, { nullable: true }) scoringAnchors?: any;
  @Field({ defaultValue: false }) requiresComment!: boolean;
  @Field(() => Float, { defaultValue: 1.0 }) scoreIncrement!: number;
}

@InputType()
export class UpdateCriterionInput {
  @Field({ nullable: true }) name?: string;
  @Field({ nullable: true }) description?: string;
  @Field(() => Int, { nullable: true }) maxScore?: number;
  @Field(() => Float, { nullable: true }) weight?: number;
  @Field({ nullable: true }) guidanceText?: string;
  @Field(() => GraphQLJSON, { nullable: true }) scoringAnchors?: any;
  @Field({ nullable: true }) requiresComment?: boolean;
  @Field(() => Float, { nullable: true }) scoreIncrement?: number;
}

@InputType()
export class ReorderCriterionInput {
  @Field() id!: string;
  @Field(() => Int) displayOrder!: number;
}
