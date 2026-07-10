import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AnalyticsService } from './analytics.service';
import { AnalyticsController } from './analytics.controller';

/**
 * Module 11 — Analytics & Reporting (PRD §6). Read-only aggregation over every prior module plus the
 * `metric_snapshots` trend table. ScheduleModule powers the monthly snapshot-capture cron in
 * AnalyticsService (idempotent, so safe even if more than one instance runs it).
 */
@Module({
  imports: [ScheduleModule.forRoot()],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
  exports: [AnalyticsService],
})
export class AnalyticsModule {}
