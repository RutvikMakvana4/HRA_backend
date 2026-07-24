import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { ProjectJobsService } from './project-jobs.service';
import { ProjectsService } from './projects.service';
import { TimesheetsService } from './timesheets.service';
import { UpdatesService } from './updates.service';
import {
  AllocationsController,
  ClientsController,
  MeProjectsController,
  MeTasksController,
  MeUpdatesController,
  MilestonesController,
  ProjectsController,
  ReportsController,
  TasksController,
  TimesheetsController,
  UpdatesController,
} from './timesheets.controller';

/**
 * Module 7 — Timesheets + Project Allocation (PRD §5). Owns clients, projects, allocations, the
 * weekly timesheet workflow, the daily updates feed/comments, the utilization/allocation reports,
 * and the three project reminder cron jobs (ProjectJobsService). Depends on EmployeesModule for
 * reporting-line checks used in timesheet approval routing and report scoping.
 *
 * No ScheduleModule import here: `analytics.module.ts` already calls `ScheduleModule.forRoot()`,
 * which registers it as a `global` dynamic module. Its ScheduleExplorer discovers `@Cron` methods
 * via Nest's app-wide DiscoveryService (`getProviders()`/`getControllers()` over the whole
 * container), not by walking this module's import graph — so a bare `@Cron` method on any
 * registered provider is picked up regardless of which module declares it. Re-importing
 * `ScheduleModule` here (with or without `forRoot()`) would risk registering a second, separate
 * module instance that lacks the `SCHEDULE_MODULE_OPTIONS`/`SchedulerRegistry` providers the
 * dynamic `forRoot()` call supplies, since Nest tokens a dynamic-module import differently from a
 * bare class reference to the same class.
 */
@Module({
  imports: [EmployeesModule],
  controllers: [
    ClientsController,
    ProjectsController,
    AllocationsController,
    MilestonesController,
    TasksController,
    TimesheetsController,
    ReportsController,
    MeUpdatesController,
    MeProjectsController,
    MeTasksController,
    UpdatesController,
  ],
  providers: [ProjectsService, TimesheetsService, UpdatesService, ProjectJobsService],
  exports: [ProjectsService, TimesheetsService],
})
export class TimesheetsModule {}
