import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { EmployeesService } from './employees.service';

/**
 * `GET /org-chart` (PRD §4.1) — the reporting tree derived from `manager_id`. Readable by any
 * authenticated user.
 */
@ApiTags('employees')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard)
@Controller('org-chart')
export class OrgChartController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  tree() {
    return this.employees.orgChart();
  }
}
