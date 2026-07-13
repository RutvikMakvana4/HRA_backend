import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/client';
import {
  employees,
  expenseCategories,
  expenseClaims,
  expenseLineItems,
  notifications,
  type ExpenseCategory,
  type ExpenseClaim,
  type ExpenseLineItem,
} from '../../db/schema';
import { DRIZZLE } from '../../common/constants';
import { AppError, ErrorCode, pgErrorCode } from '../../common/errors/app-error';
import { AUDIT_SERVICE, type AuditService } from '../../common/audit/audit.interface';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { isAdminOrAbove, isSuperAdmin } from '../auth/roles';
import { EmployeesService } from '../employees/employees.service';
import type {
  AddLineItemDto,
  CreateCategoryDto,
  CreateClaimDto,
  ListClaimsDto,
  SpendOverviewDto,
  UpdateCategoryDto,
  UpdateClaimDto,
  UpdateLineItemDto,
} from './dto/expenses.dto';

/** Permission code that (besides super_admin) grants the final `reimbursed` transition (PRD §2). */
const FINANCE_PERMISSION = 'finance';

@Injectable()
export class ExpensesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    private readonly employeesService: EmployeesService,
  ) {}

  // ── Categories ─────────────────────────────────────────────────────────────

  async listCategories(): Promise<Array<Omit<ExpenseCategory, 'monthlyCap'> & { monthlyCap: number | null }>> {
    const rows = await this.db.select().from(expenseCategories).orderBy(asc(expenseCategories.name));
    return rows.map((r) => ({ ...r, monthlyCap: this.toMinor(r.monthlyCap) }));
  }

  async createCategory(dto: CreateCategoryDto, actor: AuthenticatedUser) {
    const [row] = await this.mapWrite(
      () =>
        this.db
          .insert(expenseCategories)
          .values({
            name: dto.name,
            requiresReceipt: dto.requiresReceipt,
            monthlyCap: dto.monthlyCap == null ? null : BigInt(dto.monthlyCap),
            isActive: dto.isActive,
          })
          .returning(),
      `A category named "${dto.name}" already exists`,
    );
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create category');
    await this.record(actor, 'expense_category.create', `expense_category:${row.id}`, { after: { name: row.name } });
    return { ...row, monthlyCap: this.toMinor(row.monthlyCap) };
  }

  async updateCategory(id: string, dto: UpdateCategoryDto, actor: AuthenticatedUser) {
    await this.getCategoryRow(id);
    const patch: Partial<typeof expenseCategories.$inferInsert> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.requiresReceipt !== undefined) patch.requiresReceipt = dto.requiresReceipt;
    if (dto.monthlyCap !== undefined) patch.monthlyCap = dto.monthlyCap == null ? null : BigInt(dto.monthlyCap);
    if (dto.isActive !== undefined) patch.isActive = dto.isActive;
    const [row] = await this.mapWrite(
      () => this.db.update(expenseCategories).set(patch).where(eq(expenseCategories.id, id)).returning(),
      dto.name ? `A category named "${dto.name}" already exists` : undefined,
    );
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to update category');
    await this.record(actor, 'expense_category.update', `expense_category:${id}`, { after: { name: row.name } });
    return { ...row, monthlyCap: this.toMinor(row.monthlyCap) };
  }

  // ── Claims ──────────────────────────────────────────────────────────────────

  async createClaim(dto: CreateClaimDto, actor: AuthenticatedUser) {
    const [row] = await this.db
      .insert(expenseClaims)
      .values({
        employeeId: actor.id,
        title: dto.title,
        currency: dto.currency,
        totalAmount: 0n,
        status: 'draft',
        projectId: dto.projectId ?? null,
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create claim');
    await this.record(actor, 'expense_claim.create', `expense_claim:${row.id}`, {
      after: { title: row.title, currency: row.currency },
    });
    return this.getClaim(row.id, actor);
  }

  async updateClaim(id: string, dto: UpdateClaimDto, actor: AuthenticatedUser) {
    const claim = await this.getClaimRow(id);
    this.assertOwner(claim, actor);
    this.assertDraft(claim);
    const [row] = await this.db
      .update(expenseClaims)
      .set({ ...dto, updatedAt: new Date() })
      .where(eq(expenseClaims.id, id))
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to update claim');
    await this.record(actor, 'expense_claim.update', `expense_claim:${id}`, { after: { title: row.title } });
    return this.getClaim(id, actor);
  }

  async listClaims(query: ListClaimsDto, actor: AuthenticatedUser) {
    const filters: SQL[] = [];
    if (query.scope === 'me') {
      filters.push(eq(expenseClaims.employeeId, actor.id));
    } else if (query.scope === 'team') {
      const reportIds = await this.directReportIds(actor.id);
      if (reportIds.length === 0) return [];
      filters.push(inArray(expenseClaims.employeeId, reportIds));
    } else {
      if (!isAdminOrAbove(actor)) {
        throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to view all claims', HttpStatus.FORBIDDEN);
      }
    }
    if (query.status) filters.push(eq(expenseClaims.status, query.status));
    if (query.projectId) filters.push(eq(expenseClaims.projectId, query.projectId));

    const rows = await this.db
      .select({
        id: expenseClaims.id,
        employeeId: expenseClaims.employeeId,
        employeeName: this.nameExpr(),
        title: expenseClaims.title,
        currency: expenseClaims.currency,
        totalAmount: expenseClaims.totalAmount,
        status: expenseClaims.status,
        projectId: expenseClaims.projectId,
        submittedAt: expenseClaims.submittedAt,
        decidedAt: expenseClaims.decidedAt,
        reimbursedAt: expenseClaims.reimbursedAt,
        createdAt: expenseClaims.createdAt,
      })
      .from(expenseClaims)
      .innerJoin(employees, eq(employees.id, expenseClaims.employeeId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(expenseClaims.createdAt));
    return rows.map((r) => ({ ...r, totalAmount: this.toMinor(r.totalAmount) ?? 0 }));
  }

  /**
   * Spend across approved + reimbursed claims. Aggregated in SQL: a category lives on the LINE ITEM,
   * not the claim, so the by-category breakdown cannot be derived from claim rows alone.
   */
  async spendOverview(query: SpendOverviewDto, actor: AuthenticatedUser) {
    // Same scope rule and guard as listClaims.
    const scopeFilters: SQL[] = [];
    if (query.scope === 'me') {
      scopeFilters.push(eq(expenseClaims.employeeId, actor.id));
    } else if (query.scope === 'team') {
      const reportIds = await this.directReportIds(actor.id);
      if (reportIds.length === 0) return { byCurrency: [], byCategory: [] };
      scopeFilters.push(inArray(expenseClaims.employeeId, reportIds));
    } else {
      if (!isAdminOrAbove(actor)) {
        throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to view all spend', HttpStatus.FORBIDDEN);
      }
    }
    // Only settled spend counts.
    scopeFilters.push(inArray(expenseClaims.status, ['approved', 'reimbursed']));
    const where = and(...scopeFilters);

    const currencyRows = await this.db
      .select({
        currency: expenseClaims.currency,
        // sum() over a bigint column comes back as a STRING — never a bigint.
        total: sql<string>`coalesce(sum(${expenseClaims.totalAmount}), 0)`,
        claimCount: sql<number>`cast(count(*) as int)`,
      })
      .from(expenseClaims)
      .where(where)
      .groupBy(expenseClaims.currency);

    const categoryRows = await this.db
      .select({
        categoryId: expenseCategories.id,
        categoryName: expenseCategories.name,
        currency: expenseClaims.currency,
        total: sql<string>`coalesce(sum(${expenseLineItems.amount}), 0)`,
      })
      .from(expenseLineItems)
      .innerJoin(expenseClaims, eq(expenseClaims.id, expenseLineItems.claimId))
      .innerJoin(expenseCategories, eq(expenseCategories.id, expenseLineItems.categoryId))
      .where(where)
      .groupBy(expenseCategories.id, expenseCategories.name, expenseClaims.currency);

    return {
      byCurrency: currencyRows.map((r) => ({
        currency: r.currency,
        total: Number(BigInt(r.total)),
        claimCount: r.claimCount,
      })),
      byCategory: categoryRows.map((r) => ({
        categoryId: r.categoryId,
        categoryName: r.categoryName,
        currency: r.currency,
        total: Number(BigInt(r.total)),
      })),
    };
  }

  /** A claim with its line items and (approver-facing) cap-breach warnings. */
  async getClaim(id: string, actor: AuthenticatedUser) {
    const claim = await this.getClaimRow(id);
    await this.assertCanView(claim, actor);

    const items = await this.db
      .select({
        id: expenseLineItems.id,
        claimId: expenseLineItems.claimId,
        categoryId: expenseLineItems.categoryId,
        categoryName: expenseCategories.name,
        requiresReceipt: expenseCategories.requiresReceipt,
        expenseDate: expenseLineItems.expenseDate,
        amount: expenseLineItems.amount,
        description: expenseLineItems.description,
        receiptDocumentId: expenseLineItems.receiptDocumentId,
        merchant: expenseLineItems.merchant,
      })
      .from(expenseLineItems)
      .innerJoin(expenseCategories, eq(expenseCategories.id, expenseLineItems.categoryId))
      .where(eq(expenseLineItems.claimId, id))
      .orderBy(asc(expenseLineItems.expenseDate));

    const lineItems = items.map((i) => ({ ...i, amount: this.toMinor(i.amount) ?? 0 }));
    const capWarnings = await this.capWarnings(id);
    return {
      ...claim,
      totalAmount: this.toMinor(claim.totalAmount) ?? 0,
      lineItems,
      capWarnings,
    };
  }

  // ── Line items (draft only) ───────────────────────────────────────────────────

  async addLineItem(claimId: string, dto: AddLineItemDto, actor: AuthenticatedUser) {
    const claim = await this.getClaimRow(claimId);
    this.assertOwner(claim, actor);
    this.assertDraft(claim);
    await this.getCategoryRow(dto.categoryId);

    const [row] = await this.db
      .insert(expenseLineItems)
      .values({
        claimId,
        categoryId: dto.categoryId,
        expenseDate: dto.expenseDate,
        amount: BigInt(dto.amount),
        description: dto.description ?? null,
        receiptDocumentId: dto.receiptDocumentId ?? null,
        merchant: dto.merchant ?? null,
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to add line item');
    await this.recomputeTotal(claimId);
    await this.record(actor, 'expense_line_item.add', `expense_line_item:${row.id}`, {
      after: { claimId, amount: dto.amount },
    });
    return this.getClaim(claimId, actor);
  }

  async updateLineItem(itemId: string, dto: UpdateLineItemDto, actor: AuthenticatedUser) {
    const item = await this.getLineItemRow(itemId);
    const claim = await this.getClaimRow(item.claimId);
    this.assertOwner(claim, actor);
    this.assertDraft(claim);
    if (dto.categoryId) await this.getCategoryRow(dto.categoryId);

    const patch: Partial<typeof expenseLineItems.$inferInsert> = { updatedAt: new Date() };
    if (dto.categoryId !== undefined) patch.categoryId = dto.categoryId;
    if (dto.expenseDate !== undefined) patch.expenseDate = dto.expenseDate;
    if (dto.amount !== undefined) patch.amount = BigInt(dto.amount);
    if (dto.description !== undefined) patch.description = dto.description;
    if (dto.receiptDocumentId !== undefined) patch.receiptDocumentId = dto.receiptDocumentId;
    if (dto.merchant !== undefined) patch.merchant = dto.merchant;

    const [row] = await this.db.update(expenseLineItems).set(patch).where(eq(expenseLineItems.id, itemId)).returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to update line item');
    await this.recomputeTotal(item.claimId);
    await this.record(actor, 'expense_line_item.update', `expense_line_item:${itemId}`, { after: { claimId: item.claimId } });
    return this.getClaim(item.claimId, actor);
  }

  async deleteLineItem(itemId: string, actor: AuthenticatedUser) {
    const item = await this.getLineItemRow(itemId);
    const claim = await this.getClaimRow(item.claimId);
    this.assertOwner(claim, actor);
    this.assertDraft(claim);
    await this.db.delete(expenseLineItems).where(eq(expenseLineItems.id, itemId));
    await this.recomputeTotal(item.claimId);
    await this.record(actor, 'expense_line_item.delete', `expense_line_item:${itemId}`, { before: { claimId: item.claimId } });
    return this.getClaim(item.claimId, actor);
  }

  // ── Transitions ────────────────────────────────────────────────────────────────

  async submitClaim(id: string, actor: AuthenticatedUser) {
    const claim = await this.getClaimRow(id);
    this.assertOwner(claim, actor);
    this.assertDraft(claim);

    const items = await this.db
      .select({
        amount: expenseLineItems.amount,
        receiptDocumentId: expenseLineItems.receiptDocumentId,
        requiresReceipt: expenseCategories.requiresReceipt,
        categoryName: expenseCategories.name,
      })
      .from(expenseLineItems)
      .innerJoin(expenseCategories, eq(expenseCategories.id, expenseLineItems.categoryId))
      .where(eq(expenseLineItems.claimId, id));
    if (items.length === 0) throw new AppError(ErrorCode.VALIDATION_FAILED, 'Cannot submit a claim with no line items');
    const missing = items.find((i) => i.requiresReceipt && !i.receiptDocumentId);
    if (missing) {
      throw new AppError(ErrorCode.VALIDATION_FAILED, `A ${missing.categoryName} line item requires a receipt`);
    }

    const [employee] = await this.db
      .select({ managerId: employees.managerId })
      .from(employees)
      .where(eq(employees.id, claim.employeeId))
      .limit(1);
    const approverId = employee?.managerId ?? null;

    const [row] = await this.db
      .update(expenseClaims)
      .set({ status: 'submitted', submittedAt: new Date(), approverId, updatedAt: new Date() })
      .where(eq(expenseClaims.id, id))
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to submit claim');
    await this.record(actor, 'expense_claim.submit', `expense_claim:${id}`, {
      before: { status: 'draft' },
      after: { status: 'submitted' },
    });
    if (approverId) {
      await this.notify(approverId, 'Expense claim submitted', `"${claim.title}" is awaiting your approval.`, '/admin/approvals');
    }
    return this.getClaim(id, actor);
  }

  approveClaim(id: string, note: string | undefined, actor: AuthenticatedUser) {
    return this.decideClaim(id, 'approved', note, actor);
  }

  rejectClaim(id: string, note: string | undefined, actor: AuthenticatedUser) {
    return this.decideClaim(id, 'rejected', note, actor);
  }

  private async decideClaim(
    id: string,
    decision: 'approved' | 'rejected',
    note: string | undefined,
    actor: AuthenticatedUser,
  ) {
    const claim = await this.getClaimRow(id);
    if (claim.status !== 'submitted') {
      throw new AppError(ErrorCode.CONFLICT, `Claim is ${claim.status}, not awaiting approval`, HttpStatus.CONFLICT);
    }
    const canDecide =
      isAdminOrAbove(actor) || (await this.employeesService.isManagerOf(actor.id, claim.employeeId));
    if (!canDecide) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to decide this claim', HttpStatus.FORBIDDEN);
    }
    const [row] = await this.db
      .update(expenseClaims)
      .set({ status: decision, approverId: actor.id, decidedAt: new Date(), decisionNote: note ?? null, updatedAt: new Date() })
      .where(eq(expenseClaims.id, id))
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to decide claim');
    await this.record(actor, `expense_claim.${decision === 'approved' ? 'approve' : 'reject'}`, `expense_claim:${id}`, {
      before: { status: 'submitted' },
      after: { status: decision },
    });
    await this.notify(claim.employeeId, `Expense claim ${decision}`, `"${claim.title}" was ${decision}.`, '/me/expenses');
    return this.getClaim(id, actor);
  }

  /** Finance-only terminal transition: mark an approved claim reimbursed with a reference. No payment. */
  async reimburseClaim(id: string, reimbursementRef: string, note: string | undefined, actor: AuthenticatedUser) {
    if (!this.hasFinanceFlag(actor)) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Only Finance can mark a claim reimbursed', HttpStatus.FORBIDDEN);
    }
    const claim = await this.getClaimRow(id);
    if (claim.status !== 'approved') {
      throw new AppError(ErrorCode.CONFLICT, `Only approved claims can be reimbursed (claim is ${claim.status})`, HttpStatus.CONFLICT);
    }
    const [row] = await this.db
      .update(expenseClaims)
      .set({
        status: 'reimbursed',
        reimbursedAt: new Date(),
        reimbursedBy: actor.id,
        reimbursementRef,
        decisionNote: note ?? claim.decisionNote,
        updatedAt: new Date(),
      })
      .where(eq(expenseClaims.id, id))
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to reimburse claim');
    await this.record(actor, 'expense_claim.reimburse', `expense_claim:${id}`, {
      before: { status: 'approved' },
      after: { status: 'reimbursed', reimbursementRef },
    });
    await this.notify(claim.employeeId, 'Expense reimbursed', `"${claim.title}" has been marked reimbursed.`, '/me/expenses');
    return this.getClaim(id, actor);
  }

  /** Owner-cancel a claim while it is still draft or submitted-but-undecided. */
  async cancelClaim(id: string, actor: AuthenticatedUser) {
    const claim = await this.getClaimRow(id);
    if (!isAdminOrAbove(actor)) this.assertOwner(claim, actor);
    if (claim.status !== 'draft' && claim.status !== 'submitted') {
      throw new AppError(ErrorCode.CONFLICT, `Cannot cancel a ${claim.status} claim`, HttpStatus.CONFLICT);
    }
    const [row] = await this.db
      .update(expenseClaims)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(expenseClaims.id, id))
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to cancel claim');
    await this.record(actor, 'expense_claim.cancel', `expense_claim:${id}`, {
      before: { status: claim.status },
      after: { status: 'cancelled' },
    });
    return this.getClaim(id, actor);
  }

  // ── internals ────────────────────────────────────────────────────────────────

  private async recomputeTotal(claimId: string): Promise<void> {
    const [agg] = await this.db
      .select({ total: sql<string>`coalesce(sum(${expenseLineItems.amount}), 0)` })
      .from(expenseLineItems)
      .where(eq(expenseLineItems.claimId, claimId));
    await this.db
      .update(expenseClaims)
      .set({ totalAmount: BigInt(agg?.total ?? '0'), updatedAt: new Date() })
      .where(eq(expenseClaims.id, claimId));
  }

  /** Soft cap-breach warnings: per capped category in the claim, sum vs the category's monthly cap. */
  private async capWarnings(claimId: string): Promise<string[]> {
    const rows = await this.db
      .select({
        categoryName: expenseCategories.name,
        monthlyCap: expenseCategories.monthlyCap,
        spent: sql<string>`coalesce(sum(${expenseLineItems.amount}), 0)`,
      })
      .from(expenseLineItems)
      .innerJoin(expenseCategories, eq(expenseCategories.id, expenseLineItems.categoryId))
      .where(eq(expenseLineItems.claimId, claimId))
      .groupBy(expenseCategories.id, expenseCategories.name, expenseCategories.monthlyCap);

    const warnings: string[] = [];
    for (const r of rows) {
      if (r.monthlyCap != null && BigInt(r.spent) > r.monthlyCap) {
        warnings.push(`${r.categoryName} exceeds its monthly cap`);
      }
    }
    return warnings;
  }

  private hasFinanceFlag(actor: AuthenticatedUser): boolean {
    return isSuperAdmin(actor) || actor.permissions.includes(FINANCE_PERMISSION);
  }

  private assertOwner(claim: ExpenseClaim, actor: AuthenticatedUser): void {
    if (claim.employeeId !== actor.id) {
      throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to modify this claim', HttpStatus.FORBIDDEN);
    }
  }

  private assertDraft(claim: ExpenseClaim): void {
    if (claim.status !== 'draft') {
      throw new AppError(ErrorCode.CONFLICT, `Claim is ${claim.status}; only draft claims are editable`, HttpStatus.CONFLICT);
    }
  }

  private async assertCanView(claim: ExpenseClaim, actor: AuthenticatedUser): Promise<void> {
    if (claim.employeeId === actor.id) return;
    if (isAdminOrAbove(actor)) return;
    if (claim.approverId === actor.id) return;
    if (await this.employeesService.isManagerOf(actor.id, claim.employeeId)) return;
    throw new AppError(ErrorCode.FORBIDDEN, 'Not allowed to view this claim', HttpStatus.FORBIDDEN);
  }

  private async directReportIds(managerId: string): Promise<string[]> {
    const rows = await this.db.select({ id: employees.id }).from(employees).where(eq(employees.managerId, managerId));
    return rows.map((r) => r.id);
  }

  private async getCategoryRow(id: string): Promise<ExpenseCategory> {
    const [row] = await this.db.select().from(expenseCategories).where(eq(expenseCategories.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Category not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private async getClaimRow(id: string): Promise<ExpenseClaim> {
    const [row] = await this.db.select().from(expenseClaims).where(eq(expenseClaims.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Claim not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private async getLineItemRow(id: string): Promise<ExpenseLineItem> {
    const [row] = await this.db.select().from(expenseLineItems).where(eq(expenseLineItems.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Line item not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private nameExpr() {
    return sql<
      string | null
    >`coalesce(${employees.displayName}, ${employees.firstName} || ' ' || ${employees.lastName})`;
  }

  /** bigint minor units → number for JSON (expense amounts fit safely in a JS number). */
  private toMinor(value: bigint | null): number | null {
    return value == null ? null : Number(value);
  }

  private async notify(employeeId: string, title: string, body: string, href: string): Promise<void> {
    await this.db.insert(notifications).values({ employeeId, title, body, href });
  }

  private async record(
    actor: AuthenticatedUser,
    action: string,
    target: string,
    data: { before?: Record<string, unknown>; after?: Record<string, unknown> },
  ): Promise<void> {
    await this.audit.record({ actorType: actor.type, actorId: actor.id, action, target, ...data });
  }

  private async mapWrite<T>(work: () => Promise<T>, conflictMessage?: string): Promise<T> {
    try {
      return await work();
    } catch (err) {
      // drizzle-orm wraps the real pg error in DrizzleQueryError.cause, so `err.code` is never set at
      // the top level — pgErrorCode() walks the cause chain to find it (see assets.service.ts).
      if (pgErrorCode(err) === '23505') {
        throw new AppError(
          ErrorCode.CONFLICT,
          conflictMessage ?? 'A record with that unique key already exists',
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
  }
}
