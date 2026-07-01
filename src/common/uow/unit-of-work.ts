import { Inject, Injectable } from '@nestjs/common';
import { DRIZZLE } from '../constants';
import type { Database } from '../../db/client';

/** A transaction-scoped database handle (the `tx` Drizzle hands to the callback). */
export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

/**
 * UnitOfWork — wraps a unit of work in a single DB transaction so every write inside commits
 * or rolls back together (CLAUDE.md §5.4).
 *
 * Rules the callback MUST honour:
 *  - lock rows with `.for('update')` in a deterministic order (by id) to avoid deadlocks;
 *  - keep it SHORT — never `await` external I/O (HTTP, provider, email) inside the txn (§1.7);
 *    commit first, then enqueue follow-ups via the outbox.
 */
@Injectable()
export class UnitOfWork {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** Run `work` inside a transaction; commit on success, roll back on throw. */
  async run<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction(async (tx) => work(tx));
  }
}
