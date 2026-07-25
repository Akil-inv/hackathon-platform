import { Module } from '@nestjs/common';
import { ScorecardsService } from './scorecards.service';
import { ScorecardsResolver } from './scorecards.resolver';

@Module({
  providers: [ScorecardsService, ScorecardsResolver],
  exports: [ScorecardsService],
})
export class ScorecardsModule {}
