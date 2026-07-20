import { Inject, Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, gte, isNotNull, lte, sql } from 'drizzle-orm';
import type { Database } from '../../db/client';
import {
  leaveRequests,
  notifications,
  projectAllocations,
  projectMilestones,
  projects,
  timesheetEntries,
} from '../../db/schema';
import { DRIZZLE } from '../../common/constants';

/**
 * Module 7 scheduled reminders (PRD §5). Three jobs: a missing-daily-update nudge, a milestone
 * due/overdue nudge, and a weekly per-project roll-up to the PM. All three write through the same
 * `notifications` insert every other service in this module uses — no separate helper invented.
 */
@Injectable()
export class ProjectJobsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  private async notify(employeeId: string, title: string, body: string, href: string) {
    await this.db.insert(notifications).values({ employeeId, title, body, href });
  }

  /** Yesterday, stepping back over the weekend — Monday looks at Friday. */
  private previousWorkingDay(): string {
    const d = new Date();
    do {
      d.setDate(d.getDate() - 1);
    } while (d.getDay() === 0 || d.getDay() === 6);
    return d.toISOString().slice(0, 10);
  }

  /** Weekdays 09:30 — anyone on an active project who logged nothing for the last working day. */
  @Cron('30 9 * * 1-5')
  async remindMissingUpdates(): Promise<void> {
    const target = this.previousWorkingDay();

    const members = await this.db
      .selectDistinct({ employeeId: projectAllocations.employeeId })
      .from(projectAllocations)
      .innerJoin(projects, eq(projects.id, projectAllocations.projectId))
      .where(and(eq(projectAllocations.isActive, true), eq(projects.status, 'active')));
    if (members.length === 0) return;

    // Logged anything at all that day, on any project — not "logged on every project they're
    // allocated to". Somebody on three projects who worked on one has not failed to update;
    // nagging them per-project would train people to ignore the notification entirely.
    const logged = await this.db
      .selectDistinct({ employeeId: timesheetEntries.employeeId })
      .from(timesheetEntries)
      .where(eq(timesheetEntries.workDate, target));
    const didLog = new Set(logged.map((r) => r.employeeId));

    // On approved leave that day — never nag someone who was away.
    const away = await this.db
      .selectDistinct({ employeeId: leaveRequests.employeeId })
      .from(leaveRequests)
      .where(
        and(
          eq(leaveRequests.status, 'approved'),
          lte(leaveRequests.startDate, target),
          gte(leaveRequests.endDate, target),
        ),
      );
    const onLeave = new Set(away.map((r) => r.employeeId));

    for (const { employeeId } of members) {
      if (didLog.has(employeeId) || onLeave.has(employeeId)) continue;
      await this.notify(
        employeeId,
        'Daily update missing',
        `You have not logged your work for ${target}.`,
        '/timesheets',
      );
    }
  }

  /** Daily 08:00 — pending milestones due within 3 days, or already overdue. */
  @Cron('0 8 * * *')
  async remindMilestones(): Promise<void> {
    const today = new Date().toISOString().slice(0, 10);
    const horizon = new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10);

    const rows = await this.db
      .select({
        name: projectMilestones.name,
        dueDate: projectMilestones.dueDate,
        projectId: projectMilestones.projectId,
        projectName: projects.name,
        pmEmployeeId: projects.pmEmployeeId,
      })
      .from(projectMilestones)
      .innerJoin(projects, eq(projects.id, projectMilestones.projectId))
      .where(
        and(
          eq(projectMilestones.status, 'pending'),
          lte(projectMilestones.dueDate, horizon),
          isNotNull(projects.pmEmployeeId),
        ),
      );

    for (const m of rows) {
      if (!m.pmEmployeeId) continue;
      const overdue = m.dueDate < today;
      await this.notify(
        m.pmEmployeeId,
        overdue ? 'Milestone overdue' : 'Milestone due soon',
        `${m.projectName}: "${m.name}" ${overdue ? 'was due' : 'is due'} ${m.dueDate}.`,
        `/projects/${m.projectId}`,
      );
    }
  }

  /** Mondays 08:30 — one roll-up per active project, to its PM. */
  @Cron('30 8 * * 1')
  async weeklyRollup(): Promise<void> {
    const now = new Date();
    const to = now.toISOString().slice(0, 10);
    const from = new Date(now.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
    const staleBefore = new Date(now.getTime() - 14 * 86_400_000);

    const activeProjects = await this.db
      .select({
        id: projects.id,
        name: projects.name,
        pmEmployeeId: projects.pmEmployeeId,
        progressPct: projects.progressPct,
        progressUpdatedAt: projects.progressUpdatedAt,
      })
      .from(projects)
      .where(and(eq(projects.status, 'active'), isNotNull(projects.pmEmployeeId)));

    for (const p of activeProjects) {
      if (!p.pmEmployeeId) continue;

      const [hours] = await this.db
        .select({
          minutes: sql<number>`cast(coalesce(sum(${timesheetEntries.minutes}), 0) as int)`,
        })
        .from(timesheetEntries)
        .where(
          and(
            eq(timesheetEntries.projectId, p.id),
            gte(timesheetEntries.workDate, from),
            lte(timesheetEntries.workDate, to),
          ),
        );

      const milestones = await this.db
        .select({ status: projectMilestones.status, dueDate: projectMilestones.dueDate })
        .from(projectMilestones)
        .where(eq(projectMilestones.projectId, p.id));
      const overdue = milestones.filter((m) => m.status === 'pending' && m.dueDate < to).length;

      const allocated = await this.db
        .selectDistinct({ employeeId: projectAllocations.employeeId })
        .from(projectAllocations)
        .where(
          and(eq(projectAllocations.projectId, p.id), eq(projectAllocations.isActive, true)),
        );

      const updated = await this.db
        .selectDistinct({ employeeId: timesheetEntries.employeeId })
        .from(timesheetEntries)
        .where(
          and(
            eq(timesheetEntries.projectId, p.id),
            gte(timesheetEntries.workDate, from),
            lte(timesheetEntries.workDate, to),
          ),
        );

      const stale = !p.progressUpdatedAt || p.progressUpdatedAt < staleBefore;
      const loggedHours = Math.round(((hours?.minutes ?? 0) / 60) * 10) / 10;

      const body = [
        `${loggedHours}h logged`,
        `${updated.length}/${allocated.length} people updated`,
        `${overdue} milestone(s) overdue`,
        stale
          ? `progress not updated in 2+ weeks (${p.progressPct}%)`
          : `progress ${p.progressPct}%`,
      ].join(' · ');

      await this.notify(p.pmEmployeeId, `Weekly summary — ${p.name}`, body, `/projects/${p.id}`);
    }
  }
}
