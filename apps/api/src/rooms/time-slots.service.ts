import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction, SlotType } from '@prisma/client';
import { GenerateTimeSlotsInput } from './rooms.types';

@Injectable()
export class TimeSlotsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /**
   * Get UTC offset string (e.g. '+08:00') for an IANA timezone.
   * Uses a reference date to determine the offset.
   */
  private getTimezoneOffset(timezone: string, refDate: Date): string {
    try {
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: timezone,
        timeZoneName: 'shortOffset',
      });
      const parts = formatter.formatToParts(refDate);
      const tzPart = parts.find(p => p.type === 'timeZoneName');
      if (tzPart) {
        // Converts "GMT+8" or "GMT+5:30" to "+08:00" or "+05:30"
        const match = tzPart.value.match(/GMT([+-]?)(\d{1,2})(?::(\d{2}))?/);
        if (match) {
          const sign = match[1] || '+';
          const hours = match[2].padStart(2, '0');
          const minutes = match[3] || '00';
          return `${sign}${hours}:${minutes}`;
        }
      }
    } catch (e) {
      // Fallback to +08:00 for Asia/Singapore
    }
    return '+08:00';
  }

  async generate(input: GenerateTimeSlotsInput, userId: string) {
    const { eventId, date, operatingStart, operatingEnd, sessionDurationMinutes, breakDurationMinutes, lunchStart, lunchEnd } = input;

    // Fetch event timezone
    const event = await this.prisma.event.findUnique({ where: { id: eventId }, select: { timezone: true } });
    const timezone = event?.timezone || 'Asia/Singapore';

    // Get the date string in YYYY-MM-DD format
    const dateStr = new Date(date).toLocaleDateString('en-CA', { timeZone: 'UTC' });

    // Calculate UTC offset for this timezone on this date
    const refDate = new Date(dateStr + 'T12:00:00Z');
    const utcOffset = this.getTimezoneOffset(timezone, refDate);

    // Parse a time string (HH:MM) into a Date in the event's timezone
    const parseTime = (timeStr: string): Date => {
      return new Date(`${dateStr}T${timeStr}:00${utcOffset}`);
    };

    // Midnight UTC, not local. `date` is a date-only column, so Postgres
    // truncates in UTC — using the event offset here stores the previous day.
    const slotDate = new Date(`${dateStr}T00:00:00Z`);

    const opStart = parseTime(operatingStart);
    const opEnd = parseTime(operatingEnd);
    const lunchStartTime = lunchStart ? parseTime(lunchStart) : null;
    const lunchEndTime = lunchEnd ? parseTime(lunchEnd) : null;

    if (opStart >= opEnd) throw new BadRequestException('Operating start must be before end');
    if (lunchStartTime && lunchEndTime && lunchStartTime >= lunchEndTime) {
      throw new BadRequestException('Lunch start must be before lunch end');
    }

    // Delete existing slots for this date
    await this.prisma.timeSlot.deleteMany({
      where: { eventId, date: slotDate },
    });

    const slots: Array<{ eventId: string; date: Date; startTime: Date; endTime: Date; slotType: SlotType }> = [];
    let cursor = new Date(opStart);

    while (cursor < opEnd) {
      const slotEnd = new Date(cursor.getTime() + sessionDurationMinutes * 60000);

      // Check if we're in lunch
      if (lunchStartTime && lunchEndTime && cursor < lunchEndTime && slotEnd > lunchStartTime) {
        if (cursor <= lunchStartTime) {
          slots.push({
            eventId, date: slotDate,
            startTime: new Date(lunchStartTime),
            endTime: new Date(lunchEndTime),
            slotType: SlotType.LUNCH,
          });
        }
        cursor = new Date(lunchEndTime);
        continue;
      }

      if (slotEnd > opEnd) break;

      // Add judging slot
      slots.push({
        eventId, date: slotDate,
        startTime: new Date(cursor),
        endTime: new Date(slotEnd),
        slotType: SlotType.JUDGING,
      });

      // Add break after session
      const breakEnd = new Date(slotEnd.getTime() + breakDurationMinutes * 60000);
      if (breakDurationMinutes > 0 && breakEnd <= opEnd) {
        slots.push({
          eventId, date: slotDate,
          startTime: new Date(slotEnd),
          endTime: new Date(breakEnd),
          slotType: SlotType.BREAK,
        });
        cursor = breakEnd;
      } else {
        cursor = slotEnd;
      }
    }

    await this.prisma.timeSlot.createMany({ data: slots });

    await this.audit.log({
      userId, eventId,
      action: AuditAction.CREATE, entityType: 'TimeSlot',
      entityId: `batch-${dateStr}`,
      newValues: { date: dateStr, timezone, utcOffset, slotCount: slots.length },
    });

    return this.prisma.timeSlot.findMany({
      where: { eventId, date: slotDate },
      orderBy: { startTime: 'asc' },
    });
  }

  async findByEventAndDate(eventId: string, date: Date) {
    return this.prisma.timeSlot.findMany({
      where: { eventId, date },
      orderBy: { startTime: 'asc' },
    });
  }

  async findAllByEvent(eventId: string) {
    return this.prisma.timeSlot.findMany({
      where: { eventId },
      orderBy: [{ date: 'asc' }, { startTime: 'asc' }],
    });
  }
}
