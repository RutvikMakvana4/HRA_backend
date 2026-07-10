/**
 * Module 10 — Asset Management (PRD §5). Custody tracking for hardware, devices, and software
 * licenses; wires into the Phase 2 on/offboarding checklist.
 *
 *  - `assetCategories`  — a category (Laptop, Monitor, Software License, …) with a hardware /
 *                         software-license nature.
 *  - `assets`           — a single tracked asset. Hardware is single-custody; a software license
 *                         is seat-based (`seatsUsed ≤ seatsTotal`) and holds vendor/renewal fields.
 *  - `assetAssignments` — a custody record: which employee holds an asset, when it was assigned,
 *                         and (once returned) when and in what condition. `returnedAt IS NULL` marks
 *                         an active assignment. Can link back to a Phase 2 onboarding/offboarding task.
 */
import { date, index, integer, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import { money, timestamps, uuidPk } from './_conventions';
import { checklistTasks } from './onboarding';
import { employees } from './employees';
import { assetCategoryType, assetStatus } from './enums';

/** An asset category. `type` decides whether members are single-custody hardware or seat-based licenses. */
export const assetCategories = pgTable(
  'asset_categories',
  {
    id: uuidPk(),
    name: text('name').notNull().unique(),
    type: assetCategoryType('type').notNull().default('hardware'),
    ...timestamps,
  },
  (t) => ({
    typeIdx: index('ix_asset_categories_type').on(t.type),
  }),
);

/**
 * A single tracked asset. `purchaseCost` follows the money golden rule (bigint minor units).
 * Software-license fields (`vendor`, `seatsTotal`, `seatsUsed`, `renewalDate`) are null for hardware.
 */
export const assets = pgTable(
  'assets',
  {
    id: uuidPk(),
    assetTag: text('asset_tag').notNull().unique(),
    categoryId: uuid('category_id')
      .notNull()
      .references(() => assetCategories.id, { onDelete: 'restrict' }),
    make: text('make'),
    model: text('model'),
    serialNumber: text('serial_number'),
    status: assetStatus('status').notNull().default('available'),
    purchaseDate: date('purchase_date'),
    purchaseCost: money('purchase_cost'),
    warrantyExpiry: date('warranty_expiry'),
    notes: text('notes'),
    // ── Software-license fields (null for hardware) ──
    vendor: text('vendor'),
    seatsTotal: integer('seats_total'),
    seatsUsed: integer('seats_used').notNull().default(0),
    renewalDate: date('renewal_date'),
    ...timestamps,
  },
  (t) => ({
    statusIdx: index('ix_assets_status').on(t.status),
    categoryIdx: index('ix_assets_category').on(t.categoryId),
    warrantyIdx: index('ix_assets_warranty_expiry').on(t.warrantyExpiry),
    renewalIdx: index('ix_assets_renewal_date').on(t.renewalDate),
  }),
);

/**
 * A custody record for an asset. An active assignment has `returnedAt IS NULL`; hardware allows at
 * most one active assignment, a software license may have several (one per seat). Optionally links
 * to the Phase 2 checklist task that drove the assign/return.
 */
export const assetAssignments = pgTable(
  'asset_assignments',
  {
    id: uuidPk(),
    assetId: uuid('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
    assignedBy: uuid('assigned_by').references(() => employees.id, { onDelete: 'set null' }),
    returnedAt: timestamp('returned_at', { withTimezone: true }),
    returnedCondition: text('returned_condition'),
    linkedChecklistTaskId: uuid('linked_checklist_task_id').references(() => checklistTasks.id, {
      onDelete: 'set null',
    }),
    ...timestamps,
  },
  (t) => ({
    assetIdx: index('ix_asset_assignments_asset').on(t.assetId, t.returnedAt),
    employeeIdx: index('ix_asset_assignments_employee').on(t.employeeId, t.returnedAt),
  }),
);

export type AssetCategory = typeof assetCategories.$inferSelect;
export type NewAssetCategory = typeof assetCategories.$inferInsert;
export type Asset = typeof assets.$inferSelect;
export type NewAsset = typeof assets.$inferInsert;
export type AssetAssignment = typeof assetAssignments.$inferSelect;
export type NewAssetAssignment = typeof assetAssignments.$inferInsert;
