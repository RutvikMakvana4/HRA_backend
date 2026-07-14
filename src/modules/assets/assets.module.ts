import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { AssetsService } from './assets.service';
import {
  AssetCategoriesController,
  AssetsController,
  EmployeeAssetsController,
  LicensesController,
  MyAssetsController,
} from './assets.controller';

/**
 * Module 10 — Asset Management (PRD §5). Owns asset categories, the asset inventory, and the
 * assign/return custody flow (hardware single-custody + seat-based software licences), plus the
 * ESS "my assets" view and licence-renewal alerts. Depends on EmployeesModule to validate holders.
 */
@Module({
  imports: [EmployeesModule],
  controllers: [
    AssetCategoriesController,
    AssetsController,
    LicensesController,
    EmployeeAssetsController,
    MyAssetsController,
  ],
  providers: [AssetsService],
  exports: [AssetsService],
})
export class AssetsModule {}
