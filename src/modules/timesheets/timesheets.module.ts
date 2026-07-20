import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { ProjectsService } from './projects.service';
import { TimesheetsService } from './timesheets.service';
import { UpdatesService } from './updates.service';
import {
  AllocationsController,
  ClientsController,
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
 * weekly timesheet workflow, the daily updates feed/comments, and the utilization/allocation
 * reports. Depends on EmployeesModule for reporting-line checks used in timesheet approval routing
 * and report scoping.
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
    UpdatesController,
  ],
  providers: [ProjectsService, TimesheetsService, UpdatesService],
  exports: [ProjectsService, TimesheetsService],
})
export class TimesheetsModule {}
