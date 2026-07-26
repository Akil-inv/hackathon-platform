import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { GraphQLModule } from '@nestjs/graphql';
import { ApolloDriver, ApolloDriverConfig } from '@nestjs/apollo';
import { APP_GUARD } from '@nestjs/core';
import { join } from 'path';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { AuditModule } from './audit/audit.module';
import { EventsModule } from './events/events.module';
import { TracksModule } from './tracks/tracks.module';
import { RoomsModule } from './rooms/rooms.module';
import { TeamsModule } from './teams/teams.module';
import { JudgesModule } from './judges/judges.module';
import { ConflictsModule } from './conflicts/conflicts.module';
import { ScoringTemplatesModule } from './scoring-templates/scoring-templates.module';
import { SchedulingModule } from './scheduling/scheduling.module';
import { SessionsModule } from './sessions/sessions.module';
import { ScorecardsModule } from './scorecards/scorecards.module';
import { RankingsModule } from './rankings/rankings.module';
import { ExportModule } from './export/export.module';
import { NotificationModule } from './notification/notification.module';
import { HealthController } from './health.controller';
import { JudgePortalModule } from './judge-portal/judge-portal.module';
import { OperationsModule } from './operations/operations.module';
import { HealthResolver } from './health.resolver';
import { JwtAuthGuard } from './auth/jwt-auth.guard';
import { RolesGuard } from './auth/roles.guard';

@Module({
  controllers: [HealthController],
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    GraphQLModule.forRoot<ApolloDriverConfig>({
      driver: ApolloDriver,
      autoSchemaFile: join(process.cwd(), 'src/schema.gql'),
      sortSchema: true,
      playground: true,
      introspection: true,
      subscriptions: { 'graphql-ws': true },
      context: ({ req }: { req: Request }) => ({ req }),
    }),
    PrismaModule,
    AuthModule,
    AuditModule,
    EventsModule,
    TracksModule,
    RoomsModule,
    TeamsModule,
    JudgesModule,
    ConflictsModule,
    ScoringTemplatesModule,
    SchedulingModule,
    SessionsModule,
    ScorecardsModule,
    RankingsModule,
    ExportModule,
    NotificationModule,
    JudgePortalModule,
    OperationsModule,
  ],
  providers: [
    HealthResolver,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
