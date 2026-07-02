/**
 * Module 4 — ESS in-app notifications (PRD §7/§8.3). Email is the primary channel; this table is
 * the in-app mirror shown in the notification bell.
 */
import { boolean, index, pgTable, text, uuid } from 'drizzle-orm/pg-core';
import { createdAt, uuidPk } from './_conventions';
import { employees } from './employees';

export const notifications = pgTable(
  'notifications',
  {
    id: uuidPk(),
    /** The employee who should see this notification. */
    employeeId: uuid('employee_id')
      .notNull()
      .references(() => employees.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    body: text('body'),
    /** Deep link into the app (e.g. `/admin/approvals`). */
    href: text('href'),
    read: boolean('read').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => ({
    employeeIdx: index('ix_notifications_employee').on(t.employeeId, t.read),
  }),
);

export type Notification = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
