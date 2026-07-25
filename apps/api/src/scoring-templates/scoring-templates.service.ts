import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@prisma/client';
import { CreateScoringTemplateInput, UpdateScoringTemplateInput, AddCriterionInput, UpdateCriterionInput, ReorderCriterionInput } from './scoring-templates.types';

@Injectable()
export class ScoringTemplatesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private enrichTemplate(t: any) {
    const criteriaTotal = t.criteria?.reduce((sum: number, c: any) => sum + c.maxScore, 0) || 0;
    return {
      ...t,
      criteriaTotal,
      criteria: t.criteria?.map((c: any) => ({
        ...c,
        weight: Number(c.weight),
        scoreIncrement: Number(c.scoreIncrement),
      })) || [],
    };
  }

  async create(input: CreateScoringTemplateInput, userId: string) {
    const template = await this.prisma.scoringTemplate.create({
      data: input,
      include: { criteria: { orderBy: { displayOrder: 'asc' } } },
    });

    await this.audit.log({
      userId, eventId: input.eventId,
      action: AuditAction.CREATE, entityType: 'ScoringTemplate',
      entityId: template.id, newValues: { name: template.name },
    });

    return this.enrichTemplate(template);
  }

  async update(id: string, input: UpdateScoringTemplateInput, userId: string) {
    const existing = await this.prisma.scoringTemplate.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Scoring template not found');

    const updated = await this.prisma.scoringTemplate.update({
      where: { id }, data: input,
      include: { criteria: { orderBy: { displayOrder: 'asc' } } },
    });

    await this.audit.log({
      userId, eventId: existing.eventId,
      action: AuditAction.UPDATE, entityType: 'ScoringTemplate',
      entityId: id, oldValues: existing, newValues: updated,
    });

    return this.enrichTemplate(updated);
  }

  async findOne(id: string) {
    const t = await this.prisma.scoringTemplate.findUnique({
      where: { id },
      include: { criteria: { orderBy: { displayOrder: 'asc' } } },
    });
    if (!t) throw new NotFoundException('Scoring template not found');
    return this.enrichTemplate(t);
  }

  async findByEvent(eventId: string) {
    const templates = await this.prisma.scoringTemplate.findMany({
      where: { eventId },
      include: { criteria: { orderBy: { displayOrder: 'asc' } } },
      orderBy: { createdAt: 'desc' },
    });
    return templates.map(t => this.enrichTemplate(t));
  }

  async addCriterion(input: AddCriterionInput, userId: string) {
    const template = await this.prisma.scoringTemplate.findUnique({
      where: { id: input.templateId },
      include: { criteria: true },
    });
    if (!template) throw new NotFoundException('Scoring template not found');

    const currentTotal = template.criteria.reduce((sum, c) => sum + c.maxScore, 0);
    if (currentTotal + input.maxScore > template.maxTotal) {
      throw new BadRequestException(
        `Adding ${input.maxScore} would make total ${currentTotal + input.maxScore}, exceeding max ${template.maxTotal}`
      );
    }

    const maxOrder = template.criteria.reduce((max, c) => Math.max(max, c.displayOrder), -1);

    const criterion = await this.prisma.scoringCriterion.create({
      data: {
        templateId: input.templateId,
        name: input.name,
        description: input.description,
        maxScore: input.maxScore,
        weight: input.weight,
        displayOrder: maxOrder + 1,
        guidanceText: input.guidanceText,
        scoringAnchors: input.scoringAnchors || undefined,
        requiresComment: input.requiresComment,
        scoreIncrement: input.scoreIncrement,
      },
    });

    await this.audit.log({
      userId, eventId: template.eventId,
      action: AuditAction.CREATE, entityType: 'ScoringCriterion',
      entityId: criterion.id, newValues: { name: criterion.name, maxScore: criterion.maxScore },
    });

    return {
      ...criterion,
      weight: Number(criterion.weight),
      scoreIncrement: Number(criterion.scoreIncrement),
    };
  }

  async updateCriterion(id: string, input: UpdateCriterionInput, userId: string) {
    const existing = await this.prisma.scoringCriterion.findUnique({
      where: { id },
      include: { template: { include: { criteria: true } } },
    });
    if (!existing) throw new NotFoundException('Criterion not found');

    if (input.maxScore !== undefined) {
      const otherTotal = existing.template.criteria
        .filter(c => c.id !== id)
        .reduce((sum, c) => sum + c.maxScore, 0);
      if (otherTotal + input.maxScore > existing.template.maxTotal) {
        throw new BadRequestException(
          `Score of ${input.maxScore} would make total ${otherTotal + input.maxScore}, exceeding max ${existing.template.maxTotal}`
        );
      }
    }

    const updated = await this.prisma.scoringCriterion.update({
      where: { id }, data: input,
    });

    return {
      ...updated,
      weight: Number(updated.weight),
      scoreIncrement: Number(updated.scoreIncrement),
    };
  }

  async removeCriterion(id: string, userId: string) {
    const existing = await this.prisma.scoringCriterion.findUnique({
      where: { id },
      include: { template: true },
    });
    if (!existing) throw new NotFoundException('Criterion not found');

    await this.prisma.scoringCriterion.delete({ where: { id } });

    await this.audit.log({
      userId, eventId: existing.template.eventId,
      action: AuditAction.DELETE, entityType: 'ScoringCriterion',
      entityId: id, oldValues: { name: existing.name, maxScore: existing.maxScore },
    });

    return true;
  }

  async reorderCriteria(inputs: ReorderCriterionInput[]) {
    for (const input of inputs) {
      await this.prisma.scoringCriterion.update({
        where: { id: input.id },
        data: { displayOrder: input.displayOrder },
      });
    }
    return true;
  }
}
