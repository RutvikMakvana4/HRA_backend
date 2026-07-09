import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { OnboardingModule } from '../onboarding/onboarding.module';
import { RecruitmentService } from './recruitment.service';
import {
  ApplicationsController,
  CandidatesController,
  InterviewsController,
  JobOpeningsController,
  OffersController,
  PipelineStagesController,
} from './recruitment.controller';

/**
 * Module 9 — Recruitment / ATS (PRD §4). Owns the internal hiring pipeline: job openings,
 * candidates, applications + configurable stages, interviews + scorecards, and offers. Depends on
 * EmployeesModule (to create the Employee on hire and resolve reporting lines) and OnboardingModule
 * (to spawn the Phase 2 onboarding case when an application is hired).
 */
@Module({
  imports: [EmployeesModule, OnboardingModule],
  controllers: [
    PipelineStagesController,
    JobOpeningsController,
    CandidatesController,
    ApplicationsController,
    InterviewsController,
    OffersController,
  ],
  providers: [RecruitmentService],
  exports: [RecruitmentService],
})
export class RecruitmentModule {}
