/**
 * Module 11 — Analytics & Reporting (PRD §6). The analytics layer adds no operational entities —
 * its endpoints aggregate live over the prior modules. The one persisted table is `metricSnapshots`:
 * a scheduled job writes periodic point-in-time values (monthly headcount, utilization, …) so trends
 * survive even as the operational rows they were derived from change.
 */
import { doublePrecision, index, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';
import { timestamps, uuidPk } from './_conventions';

/** Detail dimension for a snapshot, e.g. `{ department: "Eng" }`. Empty object = org-wide. */
export type MetricDimension = Record<string, string>;

/**
 * A single captured metric value for one period + dimension. `dimensionKey` is a stable, indexable
 * serialization of `dimension` (e.g. `department:Eng`, or `` for org-wide) so a snapshot is unique
 * per (metricKey, dimensionKey, period) and the capture job is idempotent (safe to re-run).
 */
export const metricSnapshots = pgTable(
  'metric_snapshots',
  {
    id: uuidPk(),
    metricKey: text('metric_key').notNull(),
    dimension: jsonb('dimension').notNull().$type<MetricDimension>().default({}),
    dimensionKey: text('dimension_key').notNull().default(''),
    period: text('period').notNull(),
    value: doublePrecision('value').notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).defaultNow().notNull(),
    ...timestamps,
  },
  (t) => ({
    keyPeriodIdx: index('ix_metric_snapshots_key_period').on(t.metricKey, t.period),
    uniqSnapshot: uniqueIndex('uq_metric_snapshot').on(t.metricKey, t.dimensionKey, t.period),
  }),
);

export type MetricSnapshot = typeof metricSnapshots.$inferSelect;
export type NewMetricSnapshot = typeof metricSnapshots.$inferInsert;
