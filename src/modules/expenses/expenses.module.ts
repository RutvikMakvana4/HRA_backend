import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { ExpensesService } from './expenses.service';
import { ExpenseCategoriesController, ExpenseClaimsController } from './expenses.controller';

/**
 * Module 6 — Expenses & Reimbursement (PRD §4). Owns expense categories and the claim lifecycle
 * (draft → submitted → approved/rejected → reimbursed). Multi-currency, no money movement. Depends on
 * EmployeesModule for approval routing (line manager) and reporting-line access checks.
 */
@Module({
  imports: [EmployeesModule],
  controllers: [ExpenseCategoriesController, ExpenseClaimsController],
  providers: [ExpensesService],
  exports: [ExpensesService],
})
export class ExpensesModule {}
