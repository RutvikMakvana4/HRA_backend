import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { OnboardingService } from './onboarding.service';
import {
  ChecklistTasksController,
  ChecklistTemplatesController,
  LifecycleCasesController,
} from './onboarding.controller';

/**
 * Module 5 — Onboarding / Offboarding (PRD §3). Owns checklist templates, lifecycle cases, and the
 * assignable checklist tasks spawned from templates. Depends on EmployeesModule for assignee
 * resolution, reporting-line access checks, and the offboarding clearance-gate exit transition.
 */
@Module({
  imports: [EmployeesModule],
  controllers: [ChecklistTemplatesController, LifecycleCasesController, ChecklistTasksController],
  providers: [OnboardingService],
  exports: [OnboardingService],
})
export class OnboardingModule {}
