import { Injectable, NotFoundException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuditAction } from '@prisma/client';
import { CreateTeamInput, UpdateTeamInput } from './teams.types';

@Injectable()
export class TeamsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  async create(input: CreateTeamInput, userId: string) {
    const existing = await this.prisma.team.findUnique({
      where: { eventId_name: { eventId: input.eventId, name: input.name } },
    });
    if (existing) throw new ConflictException(`Team "${input.name}" already exists in this event`);

    if (input.trackId) {
      const track = await this.prisma.challengeTrack.findUnique({ where: { id: input.trackId } });
      if (!track) throw new NotFoundException('Track not found');
    }

    const team = await this.prisma.team.create({
      data: input,
      include: { track: true, members: true },
    });

    await this.audit.log({
      userId, eventId: input.eventId,
      action: AuditAction.CREATE, entityType: 'Team',
      entityId: team.id, newValues: { name: team.name, projectName: team.projectName },
    });

    return { ...team, trackName: team.track?.name || null };
  }

  async update(id: string, input: UpdateTeamInput, userId: string) {
    const existing = await this.prisma.team.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Team not found');

    if (input.name) {
      const dup = await this.prisma.team.findUnique({
        where: { eventId_name: { eventId: existing.eventId, name: input.name } },
      });
      if (dup && dup.id !== id) throw new ConflictException(`Team "${input.name}" already exists`);
    }

    const updated = await this.prisma.team.update({
      where: { id }, data: input,
      include: { track: true, members: true },
    });

    await this.audit.log({
      userId, eventId: existing.eventId,
      action: AuditAction.UPDATE, entityType: 'Team',
      entityId: id, oldValues: existing, newValues: updated,
    });

    return { ...updated, trackName: updated.track?.name || null };
  }

  async findAllByEvent(eventId: string, trackId?: string, status?: string) {
    const where: any = { eventId, deletedAt: null };
    if (trackId) where.trackId = trackId;
    if (status) where.status = status;

    const teams = await this.prisma.team.findMany({
      where,
      orderBy: { name: 'asc' },
      include: { track: true, members: true },
    });
    return teams.map(t => ({ ...t, trackName: t.track?.name || null }));
  }

  async findOne(id: string) {
    const team = await this.prisma.team.findUnique({
      where: { id },
      include: { track: true, members: true },
    });
    if (!team) throw new NotFoundException('Team not found');
    return { ...team, trackName: team.track?.name || null };
  }

  async importFromCsv(eventId: string, rows: any[], userId: string) {
    const errors: Array<{ row: number; field: string; message: string }> = [];
    let imported = 0;

    // Load tracks for name lookup
    const tracks = await this.prisma.challengeTrack.findMany({
      where: { eventId, deletedAt: null },
    });
    const trackMap = new Map(tracks.map(t => [t.name.toLowerCase(), t.id]));

    // Load existing teams for duplicate check
    const existingTeams = await this.prisma.team.findMany({
      where: { eventId, deletedAt: null },
      select: { name: true },
    });
    const existingNames = new Set(existingTeams.map(t => t.name.toLowerCase()));

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +2 for 1-based + header row

      // Validate required fields
      if (!row.team_name?.trim()) { errors.push({ row: rowNum, field: 'team_name', message: 'Required' }); continue; }
      if (!row.project_name?.trim()) { errors.push({ row: rowNum, field: 'project_name', message: 'Required' }); continue; }
      if (!row.team_lead_email?.trim()) { errors.push({ row: rowNum, field: 'team_lead_email', message: 'Required' }); continue; }

      const teamName = row.team_name.trim();
      const trackName = row.track_name?.trim();

      // Check duplicate
      if (existingNames.has(teamName.toLowerCase())) {
        errors.push({ row: rowNum, field: 'team_name', message: `"${teamName}" already exists` });
        continue;
      }

      // Resolve track
      let trackId: string | null = null;
      if (trackName) {
        trackId = trackMap.get(trackName.toLowerCase()) || null;
        if (!trackId) {
          const avail = tracks.map(t => t.name).join(", "); errors.push({ row: rowNum, field: 'track_name', message: `Track "${trackName}" not found. Available: ${avail}` });
          continue;
        }
      }

      try {
        await this.prisma.team.create({
          data: {
            eventId,
            trackId,
            name: teamName,
            projectName: row.project_name.trim(),
            useCaseTitle: row.use_case_title?.trim() || null,
            problemStatement: row.problem_statement?.trim() || null,
            solutionSummary: row.solution_summary?.trim() || null,
            teamLeadName: row.team_lead_name?.trim() || teamName,
            teamLeadEmail: row.team_lead_email.trim(),
            organisation: row.organisation?.trim() || null,
            country: row.country?.trim() || null,
            techStack: row.tech_stack?.trim() || null,
          },
        });
        existingNames.add(teamName.toLowerCase());
        imported++;
      } catch (e: any) {
        errors.push({ row: rowNum, field: 'general', message: e.message?.substring(0, 100) || 'Unknown error' });
      }
    }

    await this.audit.log({
      userId, eventId,
      action: AuditAction.CREATE, entityType: 'Team',
      entityId: `import-batch`,
      newValues: { imported, skipped: errors.length, totalRows: rows.length },
    });

    return { imported, skipped: errors.length, errors };
  }
  async delete(id: string, userId: string) {
    const team = await this.prisma.team.findUniqueOrThrow({ where: { id } });
    await this.prisma.team.delete({ where: { id } });
    await this.audit.log({ userId, eventId: team.eventId, action: 'DELETE' as any, entityType: 'Team', entityId: id, oldValues: { name: team.name }, reason: 'Team deleted' });
    return team;
  }

}
