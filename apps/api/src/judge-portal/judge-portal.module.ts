import { Module } from '@nestjs/common';
import { JudgePortalService } from './judge-portal.service';
import { JudgePortalResolver } from './judge-portal.resolver';
import { JudgePortalController } from './judge-portal.controller';
import { ScorecardsModule } from '../scorecards/scorecards.module';

@Module({
  imports: [ScorecardsModule],
  providers: [JudgePortalService, JudgePortalResolver],
  controllers: [JudgePortalController],
  exports: [JudgePortalService],
})
export class JudgePortalModule {}
