import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { JudgesService } from './judges.service';
import { JudgesResolver } from './judges.resolver';
import { JudgesImportController } from './judges-import.controller';

@Module({
  imports: [MulterModule.register({ storage: require('multer').memoryStorage() })],
  providers: [JudgesService, JudgesResolver],
  controllers: [JudgesImportController],
  exports: [JudgesService],
})
export class JudgesModule {}
