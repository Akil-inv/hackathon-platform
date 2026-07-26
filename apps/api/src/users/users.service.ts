import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async createUser(input: { email: string; password: string; name: string; phone?: string; globalRole?: string }) {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw new ConflictException('Email already registered');
    const passwordHash = await bcrypt.hash(input.password, 10);
    return this.prisma.user.create({
      data: { email: input.email, passwordHash, name: input.name || '', phone: input.phone || null, role: (input.globalRole as any) || 'COORDINATOR' },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });
  }

  async listUsers() {
    return this.prisma.user.findMany({
      select: { id: true, email: true, name: true, role: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async assignToEvent(userId: string, eventId: string, role: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException('User not found');
    return this.prisma.eventUser.upsert({
      where: { userId_eventId: { userId, eventId } },
      create: { userId, eventId, role: role as any },
      update: { role: role as any },
    });
  }

  async removeFromEvent(userId: string, eventId: string) {
    return this.prisma.eventUser.delete({ where: { userId_eventId: { userId, eventId } } });
  }

  async getMyEvents(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user?.role === 'SUPER_ADMIN') {
      const events = await this.prisma.event.findMany({ orderBy: { createdAt: 'desc' }, select: { id: true, name: true, status: true, startDate: true, endDate: true } });
      return events.map((e: any) => ({ ...e, role: 'ADMIN' }));
    }
    const eventUsers = await this.prisma.eventUser.findMany({
      where: { userId },
      include: { event: { select: { id: true, name: true, status: true, startDate: true, endDate: true } } },
    });
    return eventUsers.map((eu: any) => ({ ...eu.event, role: eu.role }));
  }

  async deleteUser(userId: string) {
    await this.prisma.eventUser.deleteMany({ where: { userId } });
    return this.prisma.user.delete({ where: { id: userId } });
  }

  async resetPassword(userId: string, newPassword: string) {
    const passwordHash = await bcrypt.hash(newPassword, 10);
    return this.prisma.user.update({ where: { id: userId }, data: { passwordHash }, select: { id: true, email: true } });
  }
}
