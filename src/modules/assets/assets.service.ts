import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, ilike, isNull, lte, or, sql, type SQL } from 'drizzle-orm';
import type { Database } from '../../db/client';
import {
  assetAssignments,
  assetCategories,
  assets,
  checklistTasks,
  employees,
  notifications,
  type Asset,
  type AssetCategory,
} from '../../db/schema';
import { DRIZZLE } from '../../common/constants';
import { AppError, ErrorCode, pgErrorCode } from '../../common/errors/app-error';
import { AUDIT_SERVICE, type AuditService } from '../../common/audit/audit.interface';
import type { AuthenticatedUser } from '../../common/decorators/current-user.decorator';
import { EmployeesService } from '../employees/employees.service';
import type {
  AssignAssetDto,
  CreateAssetCategoryDto,
  CreateAssetDto,
  ExpiringLicensesDto,
  ListAssetsDto,
  ReturnAssetDto,
  UpdateAssetCategoryDto,
  UpdateAssetDto,
} from './dto/assets.dto';

/** Default look-ahead window (days) for licence renewal alerts when no `before` is given. */
const RENEWAL_LOOKAHEAD_DAYS = 90;

@Injectable()
export class AssetsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(AUDIT_SERVICE) private readonly audit: AuditService,
    private readonly employeesService: EmployeesService,
  ) {}

  // ── Categories ─────────────────────────────────────────────────────────────

  listCategories(): Promise<AssetCategory[]> {
    return this.db.select().from(assetCategories).orderBy(asc(assetCategories.name));
  }

  async createCategory(dto: CreateAssetCategoryDto, actor: AuthenticatedUser) {
    let row: AssetCategory | undefined;
    try {
      [row] = await this.db
        .insert(assetCategories)
        .values({ name: dto.name, type: dto.type })
        .returning();
    } catch (err) {
      if (pgErrorCode(err) === '23505') {
        throw new AppError(
          ErrorCode.CONFLICT,
          `A category named "${dto.name}" already exists`,
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create asset category');
    await this.record(actor, 'asset_category.create', `asset_category:${row.id}`, {
      after: { name: row.name, type: row.type },
    });
    return row;
  }

  async updateCategory(id: string, dto: UpdateAssetCategoryDto, actor: AuthenticatedUser) {
    await this.getCategoryRow(id);
    const patch: Partial<typeof assetCategories.$inferInsert> = { updatedAt: new Date() };
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.type !== undefined) patch.type = dto.type;
    const [row] = await this.db
      .update(assetCategories)
      .set(patch)
      .where(eq(assetCategories.id, id))
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to update asset category');
    await this.record(actor, 'asset_category.update', `asset_category:${id}`, {
      after: { name: row.name },
    });
    return row;
  }

  // ── Assets ───────────────────────────────────────────────────────────────────

  listAssets(query: ListAssetsDto) {
    const filters: SQL[] = [];
    if (query.status) filters.push(eq(assets.status, query.status));
    if (query.category) filters.push(eq(assets.categoryId, query.category));
    if (query.q) {
      const term = `%${query.q}%`;
      const match = or(
        ilike(assets.assetTag, term),
        ilike(assets.make, term),
        ilike(assets.model, term),
        ilike(assets.serialNumber, term),
      );
      if (match) filters.push(match);
    }
    return this.db
      .select({
        id: assets.id,
        assetTag: assets.assetTag,
        categoryId: assets.categoryId,
        categoryName: assetCategories.name,
        categoryType: assetCategories.type,
        make: assets.make,
        model: assets.model,
        serialNumber: assets.serialNumber,
        status: assets.status,
        purchaseDate: assets.purchaseDate,
        purchaseCost: assets.purchaseCost,
        warrantyExpiry: assets.warrantyExpiry,
        vendor: assets.vendor,
        seatsTotal: assets.seatsTotal,
        seatsUsed: assets.seatsUsed,
        renewalDate: assets.renewalDate,
        notes: assets.notes,
        // The employee on this asset's OPEN assignment. A correlated scalar subquery keeps the
        // result at exactly one row per asset — a leftJoin would duplicate a multi-seat licence.
        // `"assets"."id"` is written literally on purpose: an interpolated ${assets.id} emits
        // UNQUALIFIED inside a raw subquery, so Postgres would resolve it against asset_assignments
        // and the predicate would never match.
        holderName: sql<string | null>`(
          select ${this.nameExpr()}
          from asset_assignments aa
          join employees on employees.id = aa.employee_id
          where aa.asset_id = "assets"."id" and aa.returned_at is null
          order by aa.assigned_at desc
          limit 1
        )`,
      })
      .from(assets)
      .innerJoin(assetCategories, eq(assetCategories.id, assets.categoryId))
      .where(filters.length ? and(...filters) : undefined)
      .orderBy(desc(assets.createdAt));
  }

  async getAsset(id: string) {
    const asset = await this.getAssetRow(id);
    const [category] = await this.db
      .select()
      .from(assetCategories)
      .where(eq(assetCategories.id, asset.categoryId))
      .limit(1);
    const holders = await this.db
      .select({
        assignmentId: assetAssignments.id,
        employeeId: assetAssignments.employeeId,
        employeeName: this.nameExpr(),
        assignedAt: assetAssignments.assignedAt,
      })
      .from(assetAssignments)
      .leftJoin(employees, eq(employees.id, assetAssignments.employeeId))
      .where(and(eq(assetAssignments.assetId, id), isNull(assetAssignments.returnedAt)))
      .orderBy(desc(assetAssignments.assignedAt));
    return { ...asset, category: category ?? null, currentHolders: holders };
  }

  async createAsset(dto: CreateAssetDto, actor: AuthenticatedUser) {
    await this.getCategoryRow(dto.categoryId);
    let row: Asset | undefined;
    try {
      [row] = await this.db
        .insert(assets)
        .values({
          assetTag: dto.assetTag,
          categoryId: dto.categoryId,
          make: dto.make ?? null,
          model: dto.model ?? null,
          serialNumber: dto.serialNumber ?? null,
          purchaseDate: dto.purchaseDate ?? null,
          purchaseCost: dto.purchaseCost == null ? null : BigInt(dto.purchaseCost),
          warrantyExpiry: dto.warrantyExpiry ?? null,
          notes: dto.notes ?? null,
          vendor: dto.vendor ?? null,
          seatsTotal: dto.seatsTotal ?? null,
          renewalDate: dto.renewalDate ?? null,
        })
        .returning();
    } catch (err) {
      if (pgErrorCode(err) === '23505') {
        throw new AppError(
          ErrorCode.CONFLICT,
          `An asset with tag "${dto.assetTag}" already exists`,
          HttpStatus.CONFLICT,
        );
      }
      throw err;
    }
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to create asset');
    await this.record(actor, 'asset.create', `asset:${row.id}`, {
      after: { assetTag: row.assetTag, status: row.status },
    });
    return row;
  }

  async updateAsset(id: string, dto: UpdateAssetDto, actor: AuthenticatedUser) {
    const before = await this.getAssetRow(id);
    if (dto.categoryId) await this.getCategoryRow(dto.categoryId);

    const patch: Partial<typeof assets.$inferInsert> = { updatedAt: new Date() };
    if (dto.assetTag !== undefined) patch.assetTag = dto.assetTag;
    if (dto.categoryId !== undefined) patch.categoryId = dto.categoryId;
    if (dto.make !== undefined) patch.make = dto.make;
    if (dto.model !== undefined) patch.model = dto.model;
    if (dto.serialNumber !== undefined) patch.serialNumber = dto.serialNumber;
    if (dto.purchaseDate !== undefined) patch.purchaseDate = dto.purchaseDate;
    if (dto.purchaseCost !== undefined)
      patch.purchaseCost = dto.purchaseCost == null ? null : BigInt(dto.purchaseCost);
    if (dto.warrantyExpiry !== undefined) patch.warrantyExpiry = dto.warrantyExpiry;
    if (dto.notes !== undefined) patch.notes = dto.notes;
    if (dto.vendor !== undefined) patch.vendor = dto.vendor;
    if (dto.seatsTotal !== undefined) patch.seatsTotal = dto.seatsTotal;
    if (dto.renewalDate !== undefined) patch.renewalDate = dto.renewalDate;

    // Retiring / losing an asset closes any open assignment (PRD §5 business rules).
    if (dto.status !== undefined) {
      patch.status = dto.status;
      if (dto.status === 'retired' || dto.status === 'lost') {
        await this.closeOpenAssignments(id, `asset ${dto.status}`);
        patch.seatsUsed = 0;
      }
    }

    const [row] = await this.db.update(assets).set(patch).where(eq(assets.id, id)).returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to update asset');
    await this.record(actor, 'asset.update', `asset:${id}`, {
      before: { status: before.status },
      after: { status: row.status },
    });
    return row;
  }

  // ── Assign / return ──────────────────────────────────────────────────────────

  /**
   * Assign an asset to an employee. Hardware allows at most one active assignment (status flips to
   * `assigned`); a software licence is seat-based (`seatsUsed < seatsTotal`, one assignment per
   * employee). Optionally links the assignment to a Phase 2 checklist task.
   */
  async assignAsset(assetId: string, dto: AssignAssetDto, actor: AuthenticatedUser) {
    const asset = await this.getAssetRow(assetId);
    const category = await this.getCategoryRow(asset.categoryId);
    if (asset.status === 'retired' || asset.status === 'lost') {
      throw new AppError(
        ErrorCode.CONFLICT,
        `Asset is ${asset.status}; cannot assign`,
        HttpStatus.CONFLICT,
      );
    }
    await this.employeesService.ensureExists(dto.employeeId);
    if (dto.linkedChecklistTaskId) await this.assertChecklistTaskExists(dto.linkedChecklistTaskId);

    const isLicense = category.type === 'software_license';
    if (isLicense) {
      // Seat-based: enforce capacity and one seat per employee.
      const total = asset.seatsTotal ?? 0;
      if (asset.seatsUsed >= total) {
        throw new AppError(
          ErrorCode.CONFLICT,
          'No seats available on this licence',
          HttpStatus.CONFLICT,
        );
      }
      if (await this.hasActiveAssignment(assetId, dto.employeeId)) {
        throw new AppError(
          ErrorCode.CONFLICT,
          'This employee already holds a seat on the licence',
          HttpStatus.CONFLICT,
        );
      }
    } else if (await this.hasActiveAssignment(assetId)) {
      throw new AppError(
        ErrorCode.CONFLICT,
        'Asset is already assigned; return it before reassigning',
        HttpStatus.CONFLICT,
      );
    }

    const [row] = await this.db
      .insert(assetAssignments)
      .values({
        assetId,
        employeeId: dto.employeeId,
        assignedBy: actor.id,
        assignedAt: dto.assignedAt ? new Date(dto.assignedAt) : undefined,
        linkedChecklistTaskId: dto.linkedChecklistTaskId ?? null,
      })
      .returning();
    if (!row) throw new AppError(ErrorCode.INTERNAL, 'Failed to assign asset');

    await this.db
      .update(assets)
      .set({
        status: 'assigned',
        // Relative, in SQL, so the database does the arithmetic — writing the absolute value
        // `asset.seatsUsed + 1` from the stale read above loses an update under ANY two
        // concurrent assignments, not just a race for the last seat. Hardware has no seat
        // concept, so leave `seatsUsed` untouched rather than rewriting it unchanged.
        ...(isLicense ? { seatsUsed: sql`${assets.seatsUsed} + 1` } : {}),
        updatedAt: new Date(),
      })
      .where(eq(assets.id, assetId));

    await this.record(actor, 'asset.assign', `asset:${assetId}`, {
      after: { employeeId: dto.employeeId, assignmentId: row.id },
    });
    await this.notify(
      dto.employeeId,
      'Asset assigned',
      `${asset.assetTag} (${asset.make ?? category.name}) has been assigned to you.`,
      '/me/assets',
    );
    return row;
  }

  /**
   * Return an asset. Hardware closes its single active assignment and flips back to `available`; a
   * software licence closes the given employee's seat and frees it (status returns to `available`
   * only once every seat is back).
   */
  async returnAsset(assetId: string, dto: ReturnAssetDto, actor: AuthenticatedUser) {
    const asset = await this.getAssetRow(assetId);
    const category = await this.getCategoryRow(asset.categoryId);
    const isLicense = category.type === 'software_license';

    if (isLicense && !dto.employeeId) {
      throw new AppError(
        ErrorCode.VALIDATION_FAILED,
        'employeeId is required to return a software-licence seat',
      );
    }

    const active = and(
      eq(assetAssignments.assetId, assetId),
      isNull(assetAssignments.returnedAt),
      dto.employeeId ? eq(assetAssignments.employeeId, dto.employeeId) : undefined,
    );
    const [assignment] = await this.db
      .select()
      .from(assetAssignments)
      .where(active)
      .orderBy(desc(assetAssignments.assignedAt))
      .limit(1);
    if (!assignment) {
      throw new AppError(
        ErrorCode.CONFLICT,
        'No active assignment to return for this asset',
        HttpStatus.CONFLICT,
      );
    }

    await this.db
      .update(assetAssignments)
      .set({
        returnedAt: new Date(),
        returnedCondition: dto.returnedCondition ?? null,
        updatedAt: new Date(),
      })
      .where(eq(assetAssignments.id, assignment.id));

    // Relative, in SQL — writing the absolute `asset.seatsUsed - 1` from the stale read above
    // loses an update under ANY two concurrent returns/assignments, and a later return could
    // then zero a count that should still be positive. Hardware has no seat concept and always
    // reads back 0. Read the POST-update count back via `.returning()` — deciding `nextStatus`
    // from the stale `asset.seatsUsed` instead would flip a still-held licence to `available`,
    // which is the exact bug being fixed here.
    let seatsUsed = 0;
    if (isLicense) {
      const [seatRow] = await this.db
        .update(assets)
        .set({ seatsUsed: sql`greatest(${assets.seatsUsed} - 1, 0)`, updatedAt: new Date() })
        .where(eq(assets.id, assetId))
        .returning({ seatsUsed: assets.seatsUsed });
      seatsUsed = seatRow?.seatsUsed ?? 0;
    }
    // In-repair assets stay in repair on return; otherwise a fully-returned asset is available.
    const nextStatus =
      asset.status === 'in_repair'
        ? 'in_repair'
        : isLicense && seatsUsed > 0
          ? 'assigned'
          : 'available';
    await this.db
      .update(assets)
      .set({ status: nextStatus, updatedAt: new Date() })
      .where(eq(assets.id, assetId));

    await this.record(actor, 'asset.return', `asset:${assetId}`, {
      after: { assignmentId: assignment.id, employeeId: assignment.employeeId },
    });
    return { ...assignment, returnedAt: new Date(), returnedCondition: dto.returnedCondition ?? null };
  }

  // ── History / views ───────────────────────────────────────────────────────────

  async assetHistory(assetId: string) {
    await this.getAssetRow(assetId);
    return this.db
      .select({
        id: assetAssignments.id,
        assetId: assetAssignments.assetId,
        employeeId: assetAssignments.employeeId,
        employeeName: this.nameExpr(),
        assignedAt: assetAssignments.assignedAt,
        assignedBy: assetAssignments.assignedBy,
        returnedAt: assetAssignments.returnedAt,
        returnedCondition: assetAssignments.returnedCondition,
        linkedChecklistTaskId: assetAssignments.linkedChecklistTaskId,
      })
      .from(assetAssignments)
      .leftJoin(employees, eq(employees.id, assetAssignments.employeeId))
      .where(eq(assetAssignments.assetId, assetId))
      .orderBy(desc(assetAssignments.assignedAt));
  }

  /** Assets currently held by an employee (active assignments only). */
  async employeeAssets(employeeId: string) {
    await this.employeesService.ensureExists(employeeId);
    return this.heldBy(employeeId);
  }

  /** ESS "My assets": what the authenticated caller currently holds. */
  myAssets(actor: AuthenticatedUser) {
    return this.heldBy(actor.id);
  }

  private heldBy(employeeId: string) {
    return this.db
      .select({
        assignmentId: assetAssignments.id,
        assignedAt: assetAssignments.assignedAt,
        assetId: assets.id,
        assetTag: assets.assetTag,
        make: assets.make,
        model: assets.model,
        serialNumber: assets.serialNumber,
        categoryId: assets.categoryId,
        categoryName: assetCategories.name,
        status: assets.status,
      })
      .from(assetAssignments)
      .innerJoin(assets, eq(assets.id, assetAssignments.assetId))
      .innerJoin(assetCategories, eq(assetCategories.id, assets.categoryId))
      .where(and(eq(assetAssignments.employeeId, employeeId), isNull(assetAssignments.returnedAt)))
      .orderBy(desc(assetAssignments.assignedAt));
  }

  /** Software licences whose renewal date falls on/before the cutoff (default: 90 days out). */
  expiringLicenses(query: ExpiringLicensesDto) {
    const cutoff = query.before ?? this.daysFromNow(RENEWAL_LOOKAHEAD_DAYS);
    return this.db
      .select({
        id: assets.id,
        assetTag: assets.assetTag,
        vendor: assets.vendor,
        categoryName: assetCategories.name,
        seatsTotal: assets.seatsTotal,
        seatsUsed: assets.seatsUsed,
        renewalDate: assets.renewalDate,
        status: assets.status,
      })
      .from(assets)
      .innerJoin(assetCategories, eq(assetCategories.id, assets.categoryId))
      .where(
        and(
          eq(assetCategories.type, 'software_license'),
          sql`${assets.renewalDate} is not null`,
          lte(assets.renewalDate, cutoff),
        ),
      )
      .orderBy(asc(assets.renewalDate));
  }

  // ── internals ──────────────────────────────────────────────────────────────────

  private async hasActiveAssignment(assetId: string, employeeId?: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: assetAssignments.id })
      .from(assetAssignments)
      .where(
        and(
          eq(assetAssignments.assetId, assetId),
          isNull(assetAssignments.returnedAt),
          employeeId ? eq(assetAssignments.employeeId, employeeId) : undefined,
        ),
      )
      .limit(1);
    return !!row;
  }

  private async closeOpenAssignments(assetId: string, condition: string): Promise<void> {
    await this.db
      .update(assetAssignments)
      .set({ returnedAt: new Date(), returnedCondition: condition, updatedAt: new Date() })
      .where(and(eq(assetAssignments.assetId, assetId), isNull(assetAssignments.returnedAt)));
  }

  private daysFromNow(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }

  private nameExpr() {
    return sql<
      string | null
    >`coalesce(${employees.displayName}, ${employees.firstName} || ' ' || ${employees.lastName})`;
  }

  private async assertChecklistTaskExists(id: string): Promise<void> {
    const [row] = await this.db
      .select({ id: checklistTasks.id })
      .from(checklistTasks)
      .where(eq(checklistTasks.id, id))
      .limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Checklist task not found', HttpStatus.NOT_FOUND);
  }

  private async getCategoryRow(id: string): Promise<AssetCategory> {
    const [row] = await this.db
      .select()
      .from(assetCategories)
      .where(eq(assetCategories.id, id))
      .limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Asset category not found', HttpStatus.NOT_FOUND);
    return row;
  }

  private async getAssetRow(id: string): Promise<Asset> {
    const [row] = await this.db.select().from(assets).where(eq(assets.id, id)).limit(1);
    if (!row) throw new AppError(ErrorCode.NOT_FOUND, 'Asset not found', HttpStatus.NOT_FOUND);
    return row;
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
}
