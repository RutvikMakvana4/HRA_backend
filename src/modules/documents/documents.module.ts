import { Module } from '@nestjs/common';
import { EmployeesModule } from '../employees/employees.module';
import { CandidateDocumentsController } from './candidate-documents.controller';
import { DocumentsController } from './documents.controller';
import { EmployeeDocumentsController } from './employee-documents.controller';
import { DocumentsService } from './documents.service';

/**
 * Document vault (PRD §4). Depends on EmployeesModule for existence + manager-of checks, and the
 * (global) StorageModule for signed URLs.
 */
@Module({
  imports: [EmployeesModule],
  controllers: [EmployeeDocumentsController, CandidateDocumentsController, DocumentsController],
  providers: [DocumentsService],
})
export class DocumentsModule {}
