import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@prisma/client';
import { CreateScoringTemplateInput, UpdateScoringTemplateInput, AddCriterionInput, UpdateCriterionInput, ReorderCriterionInput } from './scoring-templates.types';
import { UOB_RUBRIC } from './uob-rubric';

@Injectable()
export class ScoringTemplatesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private enrichTemplate(t: any) {
    const all = t.criteria || [];

    // Only top-level criteria count toward the template total. A row's score
    // is already represented by its category, so summing everything would
    // double-count.
    const criteriaTotal = all
      .filter((c: any) => !c.parentId)
      .reduce((sum: number, c: any) => sum + c.maxScore, 0);

    const childSums = new Map<string, number>();
    for (const c of all) {
      if (!c.parentId) continue;
      childSums.set(c.parentId, (childSums.get(c.parentId) || 0) + c.maxScore);
    }

    return {
      ...t,
      criteriaTotal,
      criteria: all.map((c: any) => ({
        ...c,
        weight: Number(c.weight),
        scoreIncrement: Number(c.scoreIncrement),
        childrenTotal: childSums.get(c.id) || 0,
      })),
    };
  }

  /**
   * A row is measured against its category; a category against the template.
   * Measuring a row against the template total would let five rows of 10 sit
   * inside a category of 40 without complaint.
   */
  private async assertFits(
    templateId: string,
    parentId: string | null | undefined,
    maxScore: number,
    excludingCriterionId?: string,
  ) {
    const template = await this.prisma.scoringTemplate.findUnique({
      where: { id: templateId },
      include: { criteria: true },
    });
    if (!template) throw new NotFoundException('Scoring template not found');

    if (parentId) {
      const parent = template.criteria.find(c => c.id === parentId);
      if (!parent) throw new NotFoundException('Category not found');
      if ((parent as any).parentId) {
        throw new BadRequestException(
          'Criteria are two levels deep. Add rows under a category, not under another row.',
        );
      }

      const siblings = template.criteria
        .filter(c => (c as any).parentId === parentId && c.id !== excludingCriterionId)
        .reduce((sum, c) => sum + c.maxScore, 0);

      if (siblings + maxScore > parent.maxScore) {
        throw new BadRequestException(
          `"${parent.name}" allows ${parent.maxScore} points. Its rows would total ` +
          `${siblings + maxScore}. Reduce this row or raise the category.`,
        );
      }
      return;
    }

    const otherCategories = template.criteria
      .filter(c => !(c as any).parentId && c.id !== excludingCriterionId)
      .reduce((sum, c) => sum + c.maxScore, 0);

    if (otherCategories + maxScore > template.maxTotal) {
      throw new BadRequestException(
        `Categories would total ${otherCategories + maxScore}, over the ${template.maxTotal} available.`,
      );
    }
  }

  /**
   * Create every category and row from the standard rubric in one go.
   *
   * Twelve rows across five categories is a lot to type into a wizard, and
   * getting the totals to balance by hand is fiddly. Everything created here
   * is ordinary data — rename it, reweight it, delete it.
   */
  async loadStandardRubric(eventId: string, userId: string) {
    const existing = await this.prisma.scoringTemplate.findFirst({
      where: { eventId },
      include: { criteria: true },
    });

    if (existing && existing.criteria.length > 0) {
      throw new BadRequestException(
        'This event already has scoring criteria. Clear them before loading the standard rubric.',
      );
    }

    const template = existing ?? await this.prisma.scoringTemplate.create({
      data: { eventId, name: UOB_RUBRIC.name, description: UOB_RUBRIC.description },
    });

    let order = 0;
    let categoriesCreated = 0;
    let rowsCreated = 0;

    for (const cat of UOB_RUBRIC.categories) {
      const category = await this.prisma.scoringCriterion.create({
        data: {
          templateId: template.id,
          name: cat.name,
          description: cat.description,
          maxScore: cat.maxScore,
          weight: 1.0,
          displayOrder: order++,
        },
      });
      categoriesCreated++;

      for (const row of cat.rows) {
        await this.prisma.scoringCriterion.create({
          data: {
            templateId: template.id,
            parentId: category.id,
            name: row.name,
            maxScore: row.maxScore,
            weight: 1.0,
            displayOrder: order++,
            guidanceText: row.guidanceText,
            requiresComment: row.requiresComment ?? false,
          },
        });
        rowsCreated++;
      }
    }

    await this.audit.log({
      userId, eventId,
      action: AuditAction.CREATE, entityType: 'ScoringTemplate',
      entityId: template.id,
      newValues: { source: 'standard rubric', categoriesCreated, rowsCreated },
    });

    return { templateId: template.id, categoriesCreated, rowsCreated };
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

    await this.assertFits(input.templateId, input.parentId, input.maxScore);

    const maxOrder = template.criteria.reduce((max, c) => Math.max(max, c.displayOrder), -1);

    const criterion = await this.prisma.scoringCriterion.create({
      data: {
        templateId: input.templateId,
        parentId: input.parentId || null,
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
      await this.assertFits(
        existing.templateId,
        (existing as any).parentId,
        input.maxScore,
        id,
      );
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
