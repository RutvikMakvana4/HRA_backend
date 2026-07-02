import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { LeaveService } from './leave.service';
import {
  HolidaysController,
  LeaveBalancesController,
  LeaveRequestsController,
  LeaveTypesController,
} from './leave.controller';

/**
 * Module 2 — Leave Management (PRD §5). Owns leave types, holidays, balances, and the
 * apply → approve/reject/cancel workflow. Depends on EmployeesModule for reporting-line checks.
 */
@Module({
  imports: [EmployeesModule],
  controllers: [
    LeaveTypesController,
    LeaveRequestsController,
    LeaveBalancesController,
    HolidaysController,
  ],
  providers: [LeaveService],
  exports: [LeaveService],
})
export class LeaveModule {}
