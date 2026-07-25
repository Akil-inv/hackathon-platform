import { Controller, Post, UploadedFile, UseInterceptors, Body, UseGuards, Req } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import * as Papa from 'papaparse';
import { JudgesService } from './judges.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('api/import')
export class JudgesImportController {
  constructor(private judgesService: JudgesService) {}

  @Post('judges')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file'))
  async importJudges(
    @UploadedFile() file: Express.Multer.File,
    @Body('eventId') eventId: string,
    @Req() req: any,
  ) {
    const csv = file.buffer.toString('utf-8');
    const parsed = Papa.parse(csv, { header: true, skipEmptyLines: true });
    const userId = req.user?.sub || req.user?.id;
    return this.judgesService.importFromCsv(eventId, parsed.data as any[], userId);
  }
}
