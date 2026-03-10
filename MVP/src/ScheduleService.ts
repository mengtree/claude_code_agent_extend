import { randomUUID } from 'node:crypto';
import { DebugLogger } from './DebugLogger';
import { Storage } from './Storage';
import { ScheduleTask } from './types';

const CLAIM_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_CRON_SEARCH_MINUTES = 366 * 24 * 60;
const EXPLICIT_TIMEZONE_PATTERN = /(Z|[+-]\d{2}:\d{2})$/i;

interface TimeParts {
  month: number;
  day: number;
  hour: number;
  minute: number;
  weekday: number;
}

export class ScheduleService {
  constructor(private readonly storage: Storage) {}

  async list(sessionId?: string): Promise<ScheduleTask[]> {
    const schedules = await this.storage.listSchedules(sessionId);
    const normalizedSchedules: ScheduleTask[] = [];

    for (const schedule of schedules) {
      const normalized = this.normalizeSchedule(schedule);

      if (!normalized) {
        continue;
      }

      normalizedSchedules.push(normalized);
    }

    return normalizedSchedules.sort((left, right) => left.nextRunAt.localeCompare(right.nextRunAt));
  }

  async remove(sessionId: string, scheduleId: string): Promise<boolean> {
    const existing = await this.storage.loadSchedule(sessionId, scheduleId);

    if (!existing) {
      return false;
    }

    await this.storage.deleteSchedule(sessionId, scheduleId);
    DebugLogger.info('schedule.deleted', {
      sessionId,
      scheduleId
    });
    return true;
  }

  async claimDueSchedules(now = new Date()): Promise<ScheduleTask[]> {
    return this.storage.withNamedLock('schedules-scan', async () => {
      const schedules = await this.storage.listSchedules();
      const dueSchedules: ScheduleTask[] = [];

      for (const schedule of schedules) {
        const normalized = this.normalizeSchedule(schedule);

        if (!normalized || normalized.status !== 'active') {
          continue;
        }

        if (!this.isDue(normalized, now)) {
          continue;
        }

        if (normalized.claimedAt && !this.isClaimStale(normalized.claimedAt, now)) {
          continue;
        }

        const claimedAt = now.toISOString();
        const claimedSchedule: ScheduleTask = {
          ...normalized,
          claimedAt,
          triggerToken: randomUUID(),
          updatedAt: claimedAt,
          lastError: undefined
        };

        await this.storage.saveSchedule(claimedSchedule.sessionId, claimedSchedule);
        DebugLogger.info('schedule.claimed_due', {
          sessionId: claimedSchedule.sessionId,
          scheduleId: claimedSchedule.id,
          sourceType: claimedSchedule.sourceType,
          ...this.buildScheduleTimePayload(claimedSchedule, schedule, claimedAt)
        });
        dueSchedules.push(claimedSchedule);
      }

      dueSchedules.sort((left, right) => left.nextRunAt.localeCompare(right.nextRunAt));
      return dueSchedules;
    });
  }

  async completeTriggeredSchedule(schedule: ScheduleTask, dispatchedTaskId?: string): Promise<void> {
    await this.storage.withNamedLock(this.getScheduleLockName(schedule.sessionId, schedule.id), async () => {
      const latest = await this.storage.loadSchedule(schedule.sessionId, schedule.id);

      if (!latest) {
        return;
      }

      if (latest.claimedAt !== schedule.claimedAt) {
        return;
      }

      if (latest.sourceType === 'cron') {
        const timezone = this.resolveScheduleTimezone(latest.timezone);
        const nextRunAt = this.computeNextCronRun(
          latest.cronExpression,
          schedule.claimedAt || latest.nextRunAt,
          timezone
        );

        if (!nextRunAt) {
          const pausedSchedule: ScheduleTask = {
            ...latest,
            status: 'paused',
            claimedAt: undefined,
            triggerToken: undefined,
            lastTriggeredAt: schedule.claimedAt,
            lastError: 'Failed to compute next cron run time.',
            updatedAt: new Date().toISOString()
          };

          await this.storage.saveSchedule(pausedSchedule.sessionId, pausedSchedule);
          DebugLogger.warn('schedule.paused_invalid_cron', {
            sessionId: pausedSchedule.sessionId,
            scheduleId: pausedSchedule.id,
            cronExpression: pausedSchedule.cronExpression,
            timezone
          });
          return;
        }

        const updatedSchedule: ScheduleTask = {
          ...latest,
          nextRunAt,
          claimedAt: undefined,
          triggerToken: undefined,
          lastTriggeredAt: schedule.claimedAt,
          lastError: undefined,
          updatedAt: new Date().toISOString()
        };

        await this.storage.saveSchedule(updatedSchedule.sessionId, updatedSchedule);
        DebugLogger.info('schedule.rescheduled', {
          sessionId: updatedSchedule.sessionId,
          scheduleId: updatedSchedule.id,
          nextRunAt: updatedSchedule.nextRunAt,
          timezone,
          ...this.buildScheduleTimePayload(updatedSchedule, latest, new Date().toISOString())
        });
        return;
      }

      const dispatchedSchedule: ScheduleTask = {
        ...latest,
        status: 'dispatched',
        claimedAt: undefined,
        triggerToken: undefined,
        lastTriggeredAt: schedule.claimedAt,
        lastDispatchedTaskId: dispatchedTaskId,
        lastError: undefined,
        updatedAt: new Date().toISOString()
      };

      await this.storage.saveSchedule(dispatchedSchedule.sessionId, dispatchedSchedule);
      DebugLogger.info('schedule.dispatched_waiting_task_completion', {
        sessionId: dispatchedSchedule.sessionId,
        scheduleId: dispatchedSchedule.id,
        sourceType: dispatchedSchedule.sourceType,
        taskId: dispatchedTaskId,
        ...this.buildScheduleTimePayload(dispatchedSchedule, latest, new Date().toISOString())
      });
    });
  }

  async settleTriggeredTask(
    task: Pick<ScheduleTask, 'sessionId'> & { id: string; sourceScheduleId?: string },
    outcome: 'completed' | 'failed' | 'cancelled',
    error?: string
  ): Promise<void> {
    if (!task.sourceScheduleId) {
      return;
    }

    const sourceScheduleId = task.sourceScheduleId;

    await this.storage.withNamedLock(this.getScheduleLockName(task.sessionId, sourceScheduleId), async () => {
      const latest = await this.storage.loadSchedule(task.sessionId, sourceScheduleId);

      if (!latest) {
        return;
      }

      if (latest.sourceType === 'cron') {
        if (outcome !== 'completed') {
          const cronSchedule: ScheduleTask = {
            ...latest,
            lastError: error,
            updatedAt: new Date().toISOString()
          };

          await this.storage.saveSchedule(cronSchedule.sessionId, cronSchedule);
        }

        return;
      }

      if (latest.lastDispatchedTaskId && latest.lastDispatchedTaskId !== task.id) {
        return;
      }

      if (outcome === 'completed') {
        await this.storage.deleteSchedule(latest.sessionId, latest.id);
        DebugLogger.info('schedule.completed_deleted', {
          sessionId: latest.sessionId,
          scheduleId: latest.id,
          sourceType: latest.sourceType,
          taskId: task.id
        });
        return;
      }

      const pausedSchedule: ScheduleTask = {
        ...latest,
        status: 'paused',
        claimedAt: undefined,
        triggerToken: undefined,
        lastError: error,
        updatedAt: new Date().toISOString()
      };

      await this.storage.saveSchedule(pausedSchedule.sessionId, pausedSchedule);
      DebugLogger.warn('schedule.paused_after_task_end', {
        sessionId: pausedSchedule.sessionId,
        scheduleId: pausedSchedule.id,
        taskId: task.id,
        outcome,
        error
      });
    });
  }

  async releaseClaim(schedule: ScheduleTask, error: string): Promise<void> {
    await this.storage.withNamedLock(this.getScheduleLockName(schedule.sessionId, schedule.id), async () => {
      const latest = await this.storage.loadSchedule(schedule.sessionId, schedule.id);

      if (!latest) {
        return;
      }

      if (latest.claimedAt !== schedule.claimedAt) {
        return;
      }

      const releasedSchedule: ScheduleTask = {
        ...latest,
        claimedAt: undefined,
        triggerToken: undefined,
        lastError: error,
        updatedAt: new Date().toISOString()
      };

      await this.storage.saveSchedule(releasedSchedule.sessionId, releasedSchedule);
      DebugLogger.warn('schedule.claim_released', {
        sessionId: releasedSchedule.sessionId,
        scheduleId: releasedSchedule.id,
        error
      });
    });
  }

  private normalizeSchedule(schedule: ScheduleTask): ScheduleTask | undefined {
    if (!schedule || typeof schedule !== 'object') {
      return undefined;
    }

    if (!this.isNonEmptyString(schedule.id) || !this.isNonEmptyString(schedule.sessionId)) {
      this.logInvalidSchedule(schedule, 'missing_id_or_session');
      return undefined;
    }

    if (!this.isNonEmptyString(schedule.content) || !this.isNonEmptyString(schedule.summary)) {
      this.logInvalidSchedule(schedule, 'missing_content_or_summary');
      return undefined;
    }

    if (!['one_time', 'delay', 'cron'].includes(schedule.sourceType)) {
      this.logInvalidSchedule(schedule, 'invalid_source_type');
      return undefined;
    }

    const now = new Date().toISOString();
    const normalized: ScheduleTask = {
      ...schedule,
      status: this.normalizeScheduleStatus(schedule.status),
      createdAt: this.normalizeIsoString(schedule.createdAt) || now,
      updatedAt: this.normalizeIsoString(schedule.updatedAt) || now,
      nextRunAt: this.normalizeExplicitIsoString(schedule.nextRunAt) || '',
      timezone: this.resolveScheduleTimezone(schedule.timezone),
      lastTriggeredAt: this.normalizeIsoString(schedule.lastTriggeredAt),
      claimedAt: this.normalizeIsoString(schedule.claimedAt),
      triggerToken: this.isNonEmptyString(schedule.triggerToken) ? schedule.triggerToken : undefined,
      lastError: this.isNonEmptyString(schedule.lastError) ? schedule.lastError : undefined,
      runAt: this.normalizeExplicitIsoString(schedule.runAt),
      lastDispatchedTaskId: this.isNonEmptyString(schedule.lastDispatchedTaskId)
        ? schedule.lastDispatchedTaskId
        : undefined
    };

    if (normalized.sourceType === 'cron') {
      if (!this.isNonEmptyString(normalized.cronExpression)) {
        this.logInvalidSchedule(schedule, 'missing_cron_expression');
        return undefined;
      }

      const nextRunAt =
        this.normalizeExplicitIsoString(normalized.nextRunAt) ||
        this.computeNextCronRun(
          normalized.cronExpression,
          normalized.createdAt,
          this.resolveScheduleTimezone(normalized.timezone)
        );

      if (!nextRunAt) {
        this.logInvalidSchedule(schedule, 'invalid_cron_expression');
        return undefined;
      }

      normalized.nextRunAt = nextRunAt;

      return normalized;
    }

    normalized.nextRunAt = this.normalizeExplicitIsoString(normalized.nextRunAt) || normalized.runAt || '';

    if (!normalized.nextRunAt) {
      this.logInvalidSchedule(schedule, 'missing_or_ambiguous_next_run_at');
      return undefined;
    }

    return normalized;
  }

  private isDue(schedule: ScheduleTask, now: Date): boolean {
    return schedule.nextRunAt.localeCompare(now.toISOString()) <= 0;
  }

  private isClaimStale(claimedAt: string, now: Date): boolean {
    return now.getTime() - Date.parse(claimedAt) >= CLAIM_TIMEOUT_MS;
  }

  private getScheduleLockName(sessionId: string, scheduleId: string): string {
    return `schedule-${sessionId}-${scheduleId}`;
  }

  private computeNextCronRun(expression: string | undefined, afterIso: string, timezone: string): string | undefined {
    if (!expression) {
      return undefined;
    }

    const fields = expression.trim().split(/\s+/);

    if (fields.length !== 5) {
      return undefined;
    }

    const minute = this.parseCronField(fields[0], 0, 59);
    const hour = this.parseCronField(fields[1], 0, 23);
    const dayOfMonth = this.parseCronField(fields[2], 1, 31);
    const month = this.parseCronField(fields[3], 1, 12);
    const dayOfWeek = this.parseCronField(fields[4], 0, 7, true);

    if (!minute || !hour || !dayOfMonth || !month || !dayOfWeek) {
      return undefined;
    }

    const candidate = new Date(afterIso);

    if (Number.isNaN(candidate.getTime())) {
      return undefined;
    }

    candidate.setUTCSeconds(0, 0);
    candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);

    for (let attempt = 0; attempt < MAX_CRON_SEARCH_MINUTES; attempt += 1) {
      if (this.matchesCron(candidate, minute, hour, dayOfMonth, month, dayOfWeek, timezone)) {
        return candidate.toISOString();
      }

      candidate.setUTCMinutes(candidate.getUTCMinutes() + 1);
    }

    return undefined;
  }

  private matchesCron(
    date: Date,
    minute: Set<number>,
    hour: Set<number>,
    dayOfMonth: Set<number>,
    month: Set<number>,
    dayOfWeek: Set<number>,
    timezone: string
  ): boolean {
    const timeParts = this.getTimeParts(date, timezone);
    const isDayOfMonthWildcard = dayOfMonth.size === 31;
    const isDayOfWeekWildcard = dayOfWeek.size === 7;
    const dayOfMonthMatches = dayOfMonth.has(timeParts.day);
    const dayOfWeekMatches = dayOfWeek.has(timeParts.weekday);
    const dayMatches = isDayOfMonthWildcard || isDayOfWeekWildcard
      ? dayOfMonthMatches && dayOfWeekMatches
      : dayOfMonthMatches || dayOfWeekMatches;

    return minute.has(timeParts.minute)
      && hour.has(timeParts.hour)
      && month.has(timeParts.month)
      && dayMatches;
  }

  private parseCronField(expression: string, minimum: number, maximum: number, normalizeSunday = false): Set<number> | undefined {
    const values = new Set<number>();
    const segments = expression.split(',');

    for (const segment of segments) {
      const trimmedSegment = segment.trim();

      if (!trimmedSegment) {
        return undefined;
      }

      const [base, stepPart] = trimmedSegment.split('/');
      const step = stepPart ? Number.parseInt(stepPart, 10) : 1;

      if (!Number.isInteger(step) || step <= 0) {
        return undefined;
      }

      const addValue = (value: number): void => {
        const normalizedValue = normalizeSunday && value === 7 ? 0 : value;

        if (normalizedValue >= minimum && normalizedValue <= maximum) {
          values.add(normalizedValue);
        }
      };

      if (base === '*') {
        for (let value = minimum; value <= maximum; value += step) {
          addValue(value);
        }
        continue;
      }

      if (base.includes('-')) {
        const [startText, endText] = base.split('-');
        const start = Number.parseInt(startText, 10);
        const end = Number.parseInt(endText, 10);

        if (!Number.isInteger(start) || !Number.isInteger(end) || start > end) {
          return undefined;
        }

        for (let value = start; value <= end; value += step) {
          addValue(value);
        }
        continue;
      }

      const directValue = Number.parseInt(base, 10);

      if (!Number.isInteger(directValue)) {
        return undefined;
      }

      addValue(directValue);
    }

    return values.size > 0 ? values : undefined;
  }

  private normalizeIsoString(value: string | undefined): string | undefined {
    if (!this.isNonEmptyString(value)) {
      return undefined;
    }

    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }

  private normalizeExplicitIsoString(value: string | undefined): string | undefined {
    if (!this.isNonEmptyString(value)) {
      return undefined;
    }

    const normalizedValue = value.trim();

    if (!EXPLICIT_TIMEZONE_PATTERN.test(normalizedValue)) {
      return undefined;
    }

    return this.normalizeIsoString(normalizedValue);
  }

  private resolveScheduleTimezone(value: string | undefined): string {
    const fallbackTimezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

    if (!this.isNonEmptyString(value)) {
      return fallbackTimezone;
    }

    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date());
      return value;
    } catch {
      return fallbackTimezone;
    }
  }

  private normalizeScheduleStatus(value: ScheduleTask['status'] | undefined): ScheduleTask['status'] {
    if (value === 'paused' || value === 'dispatched') {
      return value;
    }

    return 'active';
  }

  private buildScheduleTimePayload(
    normalizedSchedule: ScheduleTask,
    rawSchedule: Partial<ScheduleTask>,
    referenceNowIso: string
  ): Record<string, unknown> {
    const timezone = this.resolveScheduleTimezone(normalizedSchedule.timezone || rawSchedule.timezone);

    return {
      timezone,
      rawNextRunAt: rawSchedule.nextRunAt,
      rawRunAt: rawSchedule.runAt,
      normalizedNextRunAtUtc: normalizedSchedule.nextRunAt,
      normalizedRunAtUtc: normalizedSchedule.runAt,
      nowUtc: referenceNowIso,
      nowInTimezone: this.formatDateInTimezone(referenceNowIso, timezone),
      nextRunAtInTimezone: this.formatDateInTimezone(normalizedSchedule.nextRunAt, timezone),
      systemTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      nextRunAtInSystemTimezone: this.formatDateInTimezone(
        normalizedSchedule.nextRunAt,
        Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
      )
    };
  }

  private formatDateInTimezone(value: string | undefined, timezone: string): string | undefined {
    if (!this.isNonEmptyString(value)) {
      return undefined;
    }

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      return undefined;
    }

    return new Intl.DateTimeFormat('sv-SE', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    }).format(date);
  }

  private getTimeParts(date: Date, timezone: string): TimeParts {
    const formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      weekday: 'short',
      hour12: false,
      hourCycle: 'h23'
    });

    const parts = formatter.formatToParts(date);
    const lookup = new Map(parts.map((part) => [part.type, part.value]));
    const weekdayText = lookup.get('weekday');
    const weekday = this.parseWeekday(weekdayText);

    return {
      month: Number.parseInt(lookup.get('month') || '', 10),
      day: Number.parseInt(lookup.get('day') || '', 10),
      hour: Number.parseInt(lookup.get('hour') || '', 10),
      minute: Number.parseInt(lookup.get('minute') || '', 10),
      weekday
    };
  }

  private parseWeekday(value: string | undefined): number {
    switch (value) {
      case 'Sun':
        return 0;
      case 'Mon':
        return 1;
      case 'Tue':
        return 2;
      case 'Wed':
        return 3;
      case 'Thu':
        return 4;
      case 'Fri':
        return 5;
      case 'Sat':
        return 6;
      default:
        return Number.NaN;
    }
  }

  private isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
  }

  private logInvalidSchedule(schedule: Partial<ScheduleTask>, reason: string): void {
    DebugLogger.warn('schedule.invalid_skipped', {
      scheduleId: schedule.id,
      sessionId: schedule.sessionId,
      reason,
      timezone: schedule.timezone,
      rawNextRunAt: schedule.nextRunAt,
      rawRunAt: schedule.runAt,
      normalizedNextRunAtUtc: this.normalizeExplicitIsoString(schedule.nextRunAt),
      normalizedRunAtUtc: this.normalizeExplicitIsoString(schedule.runAt)
    });
  }
}