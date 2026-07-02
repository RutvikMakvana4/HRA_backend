import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { LeaveModule } from '../leave/leave.module';
import { EssService } from './ess.service';
import { AuditLogController, MeController, NotificationsController } from './ess.controller';

/**
 * Module 4 — Employee Self-Service (PRD §7). Composition layer over Employees + Leave + Attendance
 * for the ESS dashboard (`/me`, `/me/dashboard`, `/notifications`, `/audit-log`).
 */
@Module({
  imports: [EmployeesModule, LeaveModule],
  controllers: [MeController, NotificationsController, AuditLogController],
  providers: [EssService],
})
export class EssModule {}
