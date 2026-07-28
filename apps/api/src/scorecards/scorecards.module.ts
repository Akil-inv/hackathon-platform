import { Module } from '@nestjs/common';
import { ScorecardsService } from './scorecards.service';
import { ScorecardsResolver } from './scorecards.resolver';
import { RankingsModule } from '../rankings/rankings.module';

@Module({
  imports: [RankingsModule],
  providers: [ScorecardsService, ScorecardsResolver],
  exports: [ScorecardsService],
})
export class ScorecardsModule {}
