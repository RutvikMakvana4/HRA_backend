import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { PerformanceService } from './performance.service';
import {
  FeedbackController,
  GoalsController,
  OneOnOnesController,
  ReviewCyclesController,
  ReviewTemplatesController,
  ReviewsController,
} from './performance.controller';

/**
 * Module 8 — Performance & Reviews (PRD §3). Owns goals/OKRs, review cycles + templates + reviews,
 * 1:1s, and continuous feedback. Deliberately lightweight (adoption-first). Depends on EmployeesModule
 * for reporting-line resolution (manager/team scope and access checks).
 */
@Module({
  imports: [EmployeesModule],
  controllers: [
    ReviewCyclesController,
    ReviewTemplatesController,
    GoalsController,
    ReviewsController,
    OneOnOnesController,
    FeedbackController,
  ],
  providers: [PerformanceService],
  exports: [PerformanceService],
})
export class PerformanceModule {}
