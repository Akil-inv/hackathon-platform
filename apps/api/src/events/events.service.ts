import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@prisma/client';
import { CreateEventInput, UpdateEventInput } from './events.types';

@Injectable()
export class EventsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async create(input: CreateEventInput, userId: string) {
    const event = await this.prisma.event.create({ data: input });

    await this.audit.log({
      userId,
      eventId: event.id,
      action: AuditAction.CREATE,
      entityType: 'Event',
      entityId: event.id,
      newValues: event,
    });

    return event;
  }

  async update(id: string, input: UpdateEventInput, userId: string) {
    const existing = await this.prisma.event.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Event not found');

    const updated = await this.prisma.event.update({
      where: { id },
      data: input,
    });

    await this.audit.log({
      userId,
      eventId: id,
      action: AuditAction.UPDATE,
      entityType: 'Event',
      entityId: id,
      oldValues: existing,
      newValues: updated,
    });

    return updated;
  }

  async findOne(id: string) {
    const event = await this.prisma.event.findUnique({ where: { id } });
    if (!event) throw new NotFoundException('Event not found');
    return event;
  }

  async findAll() {
    return this.prisma.event.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
    });
  }

  async softDelete(id: string, userId: string) {
    const existing = await this.prisma.event.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Event not found');

    const deleted = await this.prisma.event.update({
      where: { id },
      data: { deletedAt: new Date() },
    });

    await this.audit.log({
      userId,
      eventId: id,
      action: AuditAction.DELETE,
      entityType: 'Event',
      entityId: id,
      oldValues: existing,
    });

    return deleted;
  }
}
