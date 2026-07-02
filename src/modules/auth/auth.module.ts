import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { EmployeesModule } from '../employees/employees.module';
import { JwtAuthGuard } from './jwt-auth.guard';
import { RolesGuard } from './roles.guard';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { SessionService } from './session.service';
import { AuthService } from './auth.service';
import { AdminUsersService } from './admin-users.service';
import { AuditQueryService } from './audit-query.service';
import { AuthController } from './auth.controller';
import { AdminUsersController } from './admin-users.controller';

/**
 * Auth / RBAC Foundation (PRD Phase 1). Owns authentication (login/refresh/logout, sessions),
 * password hashing, and RBAC administration. Global so the guards are injectable in every feature
 * controller's `@UseGuards(JwtAuthGuard, RolesGuard)`.
 */
@Global()
@Module({
  imports: [JwtModule.register({}), EmployeesModule],
  controllers: [AuthController, AdminUsersController],
  providers: [
    JwtAuthGuard,
    RolesGuard,
    PasswordService,
    TokenService,
    SessionService,
    AuthService,
    AdminUsersService,
    AuditQueryService,
  ],
  exports: [JwtAuthGuard, RolesGuard, JwtModule, PasswordService],
})
export class AuthModule {}
