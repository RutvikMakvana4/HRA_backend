import { Module } from '@nestjs/common';
import { EmployeesController } from './employees.controller';
import { OrgChartController } from './org-chart.controller';
import { EmployeesService } from './employees.service';

/**
 * Employee Core (PRD §4). Owns the `employees` table and the org chart. Exports the service so
 * sibling modules (documents, and later leave/attendance) can resolve employees and reporting lines.
 */
@Module({
  controllers: [EmployeesController, OrgChartController],
  providers: [EmployeesService],
  exports: [EmployeesService],
})
export class EmployeesModule {}
