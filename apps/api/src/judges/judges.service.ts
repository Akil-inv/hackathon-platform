import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@prisma/client';
import { CreateJudgeInput, UpdateJudgeInput, SetJudgeAvailabilityInput, SetJudgeExpertiseInput } from './judges.types';

@Injectable()
export class JudgesService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private enrichJudge(judge: any) {
    return {
      ...judge,
      availabilityCount: judge._count?.availability ?? judge.availability?.length ?? 0,
      conflictCount: judge._count?.conflicts ?? judge.conflicts?.length ?? 0,
      expertise: judge.expertise?.map((e: any) => ({
        ...e,
        trackName: e.track?.name || null,
      })) || [],
    };
  }

  async create(input: CreateJudgeInput, userId: string) {
    const existing = await this.prisma.judge.findUnique({
      where: { eventId_email: { eventId: input.eventId, email: input.email } },
    });
    if (existing) throw new ConflictException(`Judge with email "${input.email}" already exists`);

    const judge = await this.prisma.judge.create({
      data: input as any,
      include: {
        availability: true,
        expertise: { include: { track: true } },
        _count: { select: { availability: true, conflicts: true } },
      },
    });

    await this.audit.log({
      userId, eventId: input.eventId,
      action: AuditAction.CREATE, entityType: 'Judge',
      entityId: judge.id, newValues: { name: judge.name, email: judge.email },
    });

    return this.enrichJudge(judge);
  }

  async update(id: string, input: UpdateJudgeInput, userId: string) {
    const existing = await this.prisma.judge.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Judge not found');

    const updated = await this.prisma.judge.update({
      where: { id }, data: input as any,
      include: {
        availability: true,
        expertise: { include: { track: true } },
        _count: { select: { availability: true, conflicts: true } },
      },
    });

    await this.audit.log({
      userId, eventId: existing.eventId,
      action: AuditAction.UPDATE, entityType: 'Judge',
      entityId: id, oldValues: existing, newValues: updated,
    });

    return this.enrichJudge(updated);
  }

  async findAllByEvent(eventId: string, judgeType?: string, status?: string) {
    const where: any = { eventId, deletedAt: null };
    if (judgeType) where.judgeType = judgeType;
    if (status) where.status = status;

    const judges = await this.prisma.judge.findMany({
      where,
      orderBy: { name: 'asc' },
      include: {
        availability: true,
        expertise: { include: { track: true } },
        _count: { select: { availability: true, conflicts: true } },
      },
    });

    return judges.map(j => this.enrichJudge(j));
  }

  async findOne(id: string) {
    const judge = await this.prisma.judge.findUnique({
      where: { id },
      include: {
        availability: true,
        expertise: { include: { track: true } },
        _count: { select: { availability: true, conflicts: true } },
      },
    });
    if (!judge) throw new NotFoundException('Judge not found');
    return this.enrichJudge(judge);
  }

  async setAvailability(input: SetJudgeAvailabilityInput, userId: string) {
    const judge = await this.prisma.judge.findUnique({ where: { id: input.judgeId } });
    if (!judge) throw new NotFoundException('Judge not found');

    const dateStr = new Date(input.date).toISOString().split('T')[0];
    const parseTime = (timeStr: string): Date => {
      const [h, m] = timeStr.split(':').map(Number);
      const d = new Date(dateStr + 'T00:00:00.000Z');
      d.setUTCHours(h, m, 0, 0);
      return d;
    };

    // Delete existing availability for this judge on this date
    await this.prisma.judgeAvailability.deleteMany({
      where: { judgeId: input.judgeId, date: new Date(dateStr) },
    });

    const avail = await this.prisma.judgeAvailability.create({
      data: {
        judgeId: input.judgeId,
        date: new Date(dateStr),
        startTime: parseTime(input.startTime),
        endTime: parseTime(input.endTime),
      },
    });

    await this.audit.log({
      userId, eventId: judge.eventId,
      action: AuditAction.UPDATE, entityType: 'JudgeAvailability',
      entityId: input.judgeId,
      newValues: { date: dateStr, startTime: input.startTime, endTime: input.endTime },
    });

    return avail;
  }

  async setExpertise(input: SetJudgeExpertiseInput, userId: string) {
    const judge = await this.prisma.judge.findUnique({ where: { id: input.judgeId } });
    if (!judge) throw new NotFoundException('Judge not found');

    const expertise = await this.prisma.judgeExpertise.upsert({
      where: { judgeId_trackId: { judgeId: input.judgeId, trackId: input.trackId } },
      create: {
        judgeId: input.judgeId,
        trackId: input.trackId,
        expertiseLevel: input.expertiseLevel,
      },
      update: { expertiseLevel: input.expertiseLevel },
      include: { track: true },
    });

    return { ...expertise, trackName: expertise.track?.name || null };
  }

  async importFromCsv(eventId: string, rows: any[], userId: string) {
    const errors: Array<{ row: number; field: string; message: string }> = [];
    let imported = 0;

    const validTypes = ['TECHNICAL', 'BUSINESS', 'DOMAIN', 'INNOVATION', 'EXECUTIVE'];

    const existingJudges = await this.prisma.judge.findMany({
      where: { eventId, deletedAt: null },
      select: { email: true },
    });
    const existingEmails = new Set(existingJudges.map(j => j.email.toLowerCase()));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;

      if (!row.name?.trim()) { errors.push({ row: rowNum, field: 'name', message: 'Required' }); continue; }
      if (!row.email?.trim()) { errors.push({ row: rowNum, field: 'email', message: 'Required' }); continue; }

      const judgeType = (row.judge_type || 'TECHNICAL').trim().toUpperCase();
      if (!validTypes.includes(judgeType)) {
        errors.push({ row: rowNum, field: 'judge_type', message: `Invalid type "${row.judge_type}". Valid: ${validTypes.join(', ')}` });
        continue;
      }

      const email = row.email.trim().toLowerCase();
      if (existingEmails.has(email)) {
        errors.push({ row: rowNum, field: 'email', message: `"${email}" already exists` });
        continue;
      }

      try {
        await this.prisma.judge.create({
          data: {
            eventId,
            name: row.name.trim(),
            email,
            organisation: row.organisation?.trim() || null,
            designation: row.designation?.trim() || null,
            judgeType: judgeType as any,
            maxSessions: parseInt(row.max_sessions) || 10,
            judgeTier: (row.judge_tier || "L1").trim().toUpperCase() as any,
          },
        });
        existingEmails.add(email);
        imported++;
      } catch (e: any) {
        errors.push({ row: rowNum, field: 'general', message: e.message?.substring(0, 100) || 'Unknown error' });
      }
    }

    await this.audit.log({
      userId, eventId,
      action: AuditAction.CREATE, entityType: 'Judge',
      entityId: 'import-batch',
      newValues: { imported, skipped: errors.length, totalRows: rows.length },
    });

    return { imported, skipped: errors.length, errors };
  }
  async deleteJudge(id: string, userId: string) {
    const judge = await this.prisma.judge.findUniqueOrThrow({ where: { id } });
    await this.prisma.judge.delete({ where: { id } });
    await this.audit.log({ userId, eventId: judge.eventId, action: 'DELETE' as any, entityType: 'Judge', entityId: id, oldValues: { name: judge.name }, reason: 'Judge deleted' });
    return judge;
  }

}
