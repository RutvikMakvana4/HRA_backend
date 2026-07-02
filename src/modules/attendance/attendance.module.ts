import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { AttendanceService } from './attendance.service';
import { AttendanceController } from './attendance.controller';

/**
 * Module 3 — Attendance (PRD §6). Check-in/out, records, and regularizations. Depends on
 * EmployeesModule for reporting-line checks on approvals.
 */
@Module({
  imports: [EmployeesModule],
  controllers: [AttendanceController],
  providers: [AttendanceService],
  exports: [AttendanceService],
})
export class AttendanceModule {}
