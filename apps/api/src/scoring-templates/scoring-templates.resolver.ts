import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { ScoringTemplatesService } from './scoring-templates.service';
import {
  ScoringTemplateEntity, ScoringCriterionEntity,
  CreateScoringTemplateInput, UpdateScoringTemplateInput,
  AddCriterionInput, UpdateCriterionInput, ReorderCriterionInput,
  LoadRubricResult,
} from './scoring-templates.types';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../auth/current-user.decorator';

@Resolver(() => ScoringTemplateEntity)
export class ScoringTemplatesResolver {
  constructor(private service: ScoringTemplatesService) {}

  @Roles('ADMIN')
  @Mutation(() => ScoringTemplateEntity)
  async createScoringTemplate(
    @Args('input') input: CreateScoringTemplateInput,
    @CurrentUser() user: any,
  ) {
    return this.service.create(input, user.sub);
  }

  @Roles('ADMIN')
  @Mutation(() => ScoringTemplateEntity)
  async updateScoringTemplate(
    @Args('id') id: string,
    @Args('input') input: UpdateScoringTemplateInput,
    @CurrentUser() user: any,
  ) {
    return this.service.update(id, input, user.sub);
  }

  @Query(() => ScoringTemplateEntity)
  async scoringTemplate(@Args('id') id: string) {
    return this.service.findOne(id);
  }

  @Query(() => [ScoringTemplateEntity])
  async scoringTemplates(@Args('eventId') eventId: string) {
    return this.service.findByEvent(eventId);
  }

  @Roles('SUPER_ADMIN', 'ADMIN')
  @Mutation(() => LoadRubricResult)
  async loadStandardRubric(
    @Args('eventId') eventId: string,
    @CurrentUser() user: any,
  ) {
    return this.service.loadStandardRubric(eventId, user.sub);
  }

  @Roles('ADMIN')
  @Mutation(() => ScoringCriterionEntity)
  async addCriterion(
    @Args('input') input: AddCriterionInput,
    @CurrentUser() user: any,
  ) {
    return this.service.addCriterion(input, user.sub);
  }

  @Roles('ADMIN')
  @Mutation(() => ScoringCriterionEntity)
  async updateCriterion(
    @Args('id') id: string,
    @Args('input') input: UpdateCriterionInput,
    @CurrentUser() user: any,
  ) {
    return this.service.updateCriterion(id, input, user.sub);
  }

  @Roles('ADMIN')
  @Mutation(() => Boolean)
  async removeCriterion(
    @Args('id') id: string,
    @CurrentUser() user: any,
  ) {
    return this.service.removeCriterion(id, user.sub);
  }

  @Roles('ADMIN')
  @Mutation(() => Boolean)
  async reorderCriteria(
    @Args({ name: 'inputs', type: () => [ReorderCriterionInput] }) inputs: ReorderCriterionInput[],
  ) {
    return this.service.reorderCriteria(inputs);
  }
}
