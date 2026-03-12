import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { CronExpressionParser } from 'cron-parser';
import type {
  CreateScheduleRequest,
  ListSchedulesQuery,
  ScheduleSourceType,
  ScheduleStats,
  StoredSchedule,
  UpdateScheduleRequest
} from '../types/index.js';
import { ValidationError } from '../types/index.js';

interface ScheduleFilePayload {
  items: StoredSchedule[];
}

export class ScheduleStore {
  private readonly filePath: string;

  constructor(
    dataDir: string,
    private readonly claimTimeoutMs: number
  ) {
    this.filePath = join(dataDir, 'schedules.json');
  }

  async initialize(): Promise<void> {
    await mkdir(dirname(this.filePath), { recursive: true });
    try {
      await readFile(this.filePath, 'utf-8');
    } catch {
      await this.writeAll([]);
    }
  }

  async list(query?: ListSchedulesQuery): Promise<StoredSchedule[]> {
    const items = await this.readAll();
    return items
      .filter((item) => !query?.status || item.status === query.status)
      .filter((item) => !query?.sourceType || item.sourceType === query.sourceType)
      .sort((left, right) => (left.nextRunAt || '').localeCompare(right.nextRunAt || ''));
  }

  async getById(scheduleId: string): Promise<StoredSchedule | null> {
    const items = await this.readAll();
    return items.find((item) => item.id === scheduleId) || null;
  }

  async create(input: CreateScheduleRequest): Promise<StoredSchedule> {
    const payload = this.normalizeCreateInput(input);
    const items = await this.readAll();
    const now = new Date().toISOString();

    const schedule: StoredSchedule = {
      id: randomUUID(),
      title: payload.title || this.buildDefaultTitle(payload.sourceType),
      message: payload.message,
      sourceType: payload.sourceType,
      status: payload.status || 'active',
      createdAt: now,
      updatedAt: now,
      nextRunAt: this.computeInitialNextRun(payload, now),
      delayMs: payload.delayMs,
      cronExpression: payload.cronExpression,
      timezone: payload.timezone,
      sessionId: payload.sessionId,
      claudeSessionId: payload.claudeSessionId,
      workingDirectory: payload.workingDirectory,
      systemPrompt: payload.systemPrompt,
      model: payload.model
    };

    items.push(schedule);
    await this.writeAll(items);
    return schedule;
  }

  async update(input: UpdateScheduleRequest): Promise<StoredSchedule | null> {
    const items = await this.readAll();
    const index = items.findIndex((item) => item.id === input.scheduleId);
    if (index === -1) {
      return null;
    }

    const current = items[index];
    const merged = this.normalizeUpdateInput(current, input);
    const now = new Date().toISOString();
    const shouldRecomputeNextRun = this.shouldRecomputeNextRun(current, input);

    const updated: StoredSchedule = {
      ...current,
      ...merged,
      updatedAt: now,
      nextRunAt: shouldRecomputeNextRun
        ? this.computeInitialNextRun(merged, now)
        : merged.nextRunAt
    };

    items[index] = updated;
    await this.writeAll(items);
    return updated;
  }

  async delete(scheduleId: string): Promise<boolean> {
    const items = await this.readAll();
    const nextItems = items.filter((item) => item.id !== scheduleId);
    if (nextItems.length === items.length) {
      return false;
    }

    await this.writeAll(nextItems);
    return true;
  }

  async getStats(): Promise<ScheduleStats> {
    const items = await this.readAll();
    return {
      total: items.length,
      active: items.filter((item) => item.status === 'active').length,
      byType: {
        delay: items.filter((item) => item.sourceType === 'delay').length,
        cron: items.filter((item) => item.sourceType === 'cron').length
      }
    };
  }

  async claimDueSchedules(now = new Date()): Promise<StoredSchedule[]> {
    const items = await this.readAll();
    const nowIso = now.toISOString();
    const claimedItems: StoredSchedule[] = [];

    const nextItems = items.map((item) => {
      if (item.status !== 'active' || !item.nextRunAt) {
        return item;
      }

      if (item.claimedAt && !this.isClaimExpired(item.claimedAt, now)) {
        return item;
      }

      if (new Date(item.nextRunAt).getTime() > now.getTime()) {
        return item;
      }

      const claimed = {
        ...item,
        claimedAt: nowIso,
        updatedAt: nowIso,
        lastError: undefined
      };
      claimedItems.push(claimed);
      return claimed;
    });

    if (claimedItems.length > 0) {
      await this.writeAll(nextItems);
    }

    return claimedItems;
  }

  async markExecutionSucceeded(
    scheduleId: string,
    triggerAt: string,
    responseSummary?: string,
    claudeSessionId?: string
  ): Promise<StoredSchedule | null> {
    const items = await this.readAll();
    const index = items.findIndex((item) => item.id === scheduleId);
    if (index === -1) {
      return null;
    }

    const current = items[index];
    const updatedAt = new Date().toISOString();

    const updated: StoredSchedule = current.sourceType === 'cron'
      ? {
          ...current,
          status: 'active',
          claimedAt: undefined,
          updatedAt,
          lastRunAt: triggerAt,
          nextRunAt: this.computeNextCronRun(current.cronExpression, triggerAt, current.timezone),
          lastError: undefined,
          lastResponseSummary: responseSummary,
          claudeSessionId: claudeSessionId || current.claudeSessionId
        }
      : {
          ...current,
          status: 'completed',
          claimedAt: undefined,
          updatedAt,
          lastRunAt: triggerAt,
          nextRunAt: undefined,
          lastError: undefined,
          lastResponseSummary: responseSummary,
          claudeSessionId: claudeSessionId || current.claudeSessionId
        };

    items[index] = updated;
    await this.writeAll(items);
    return updated;
  }

  async markExecutionFailed(scheduleId: string, triggerAt: string, errorMessage: string): Promise<StoredSchedule | null> {
    const items = await this.readAll();
    const index = items.findIndex((item) => item.id === scheduleId);
    if (index === -1) {
      return null;
    }

    const current = items[index];
    const updated: StoredSchedule = {
      ...current,
      status: current.sourceType === 'cron' ? 'paused' : 'failed',
      claimedAt: undefined,
      updatedAt: new Date().toISOString(),
      lastRunAt: triggerAt,
      lastError: errorMessage,
      lastResponseSummary: undefined
    };

    items[index] = updated;
    await this.writeAll(items);
    return updated;
  }

  async releaseClaim(scheduleId: string, errorMessage: string): Promise<StoredSchedule | null> {
    const items = await this.readAll();
    const index = items.findIndex((item) => item.id === scheduleId);
    if (index === -1) {
      return null;
    }

    const current = items[index];
    const updated: StoredSchedule = {
      ...current,
      claimedAt: undefined,
      updatedAt: new Date().toISOString(),
      lastError: errorMessage
    };

    items[index] = updated;
    await this.writeAll(items);
    return updated;
  }

  private normalizeCreateInput(input: CreateScheduleRequest): CreateScheduleRequest {
    if (!input.message || !input.message.trim()) {
      throw new ValidationError('message is required');
    }

    if (input.sourceType !== 'delay' && input.sourceType !== 'cron') {
      throw new ValidationError('sourceType must be delay or cron');
    }

    if (input.sourceType === 'delay') {
      if (!input.delayMs || input.delayMs <= 0) {
        throw new ValidationError('delayMs is required for delay schedules');
      }
    }

    if (input.sourceType === 'cron') {
      if (!input.cronExpression?.trim()) {
        throw new ValidationError('cronExpression is required for cron schedules');
      }
      this.computeNextCronRun(input.cronExpression, new Date().toISOString(), input.timezone);
    }

    return {
      ...input,
      title: input.title?.trim(),
      message: input.message.trim(),
      cronExpression: input.cronExpression?.trim(),
      timezone: input.timezone?.trim(),
      sessionId: input.sessionId?.trim(),
      claudeSessionId: input.claudeSessionId?.trim(),
      workingDirectory: input.workingDirectory?.trim(),
      systemPrompt: input.systemPrompt?.trim(),
      model: input.model?.trim()
    };
  }

  private normalizeUpdateInput(current: StoredSchedule, input: UpdateScheduleRequest): StoredSchedule {
    const sourceType = input.sourceType || current.sourceType;
    const message = input.message?.trim() || current.message;
    const cronExpression = input.cronExpression?.trim() ?? current.cronExpression;
    const delayMs = input.delayMs ?? current.delayMs;

    if (!message) {
      throw new ValidationError('message is required');
    }

    if (sourceType === 'delay' && (!delayMs || delayMs <= 0)) {
      throw new ValidationError('delayMs is required for delay schedules');
    }

    if (sourceType === 'cron') {
      if (!cronExpression) {
        throw new ValidationError('cronExpression is required for cron schedules');
      }
      this.computeNextCronRun(cronExpression, new Date().toISOString(), input.timezone ?? current.timezone);
    }

    return {
      ...current,
      title: input.title?.trim() ?? current.title,
      message,
      sourceType,
      status: input.status ?? current.status,
      delayMs: sourceType === 'delay' ? delayMs : undefined,
      cronExpression: sourceType === 'cron' ? cronExpression : undefined,
      timezone: sourceType === 'cron' ? (input.timezone?.trim() ?? current.timezone) : undefined,
      sessionId: input.sessionId?.trim() ?? current.sessionId,
      claudeSessionId: input.claudeSessionId?.trim() ?? current.claudeSessionId,
      workingDirectory: input.workingDirectory?.trim() ?? current.workingDirectory,
      systemPrompt: input.systemPrompt?.trim() ?? current.systemPrompt,
      model: input.model?.trim() ?? current.model,
      claimedAt: undefined,
      lastError: current.lastError,
      lastResponseSummary: current.lastResponseSummary
    };
  }

  private shouldRecomputeNextRun(current: StoredSchedule, input: UpdateScheduleRequest): boolean {
    return Boolean(
      input.sourceType
      || input.delayMs !== undefined
      || input.cronExpression !== undefined
      || input.timezone !== undefined
      || input.status === 'active'
      || current.status !== 'active'
    );
  }

  private computeInitialNextRun(input: CreateScheduleRequest | StoredSchedule, baseTimeIso: string): string | undefined {
    if ((input as StoredSchedule).status && (input as StoredSchedule).status !== 'active') {
      return (input as StoredSchedule).nextRunAt;
    }

    if (input.sourceType === 'delay') {
      return new Date(Date.parse(baseTimeIso) + (input.delayMs || 0)).toISOString();
    }

    return this.computeNextCronRun(input.cronExpression, baseTimeIso, input.timezone);
  }

  private computeNextCronRun(cronExpression: string | undefined, baseTimeIso: string, timezone?: string): string {
    if (!cronExpression) {
      throw new ValidationError('cronExpression is required');
    }

    try {
      const interval = CronExpressionParser.parse(cronExpression, {
        currentDate: baseTimeIso,
        tz: timezone || 'UTC'
      });
      return interval.next().toDate().toISOString();
    } catch (error) {
      throw new ValidationError(`Invalid cron expression: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private isClaimExpired(claimedAt: string, now: Date): boolean {
    return now.getTime() - new Date(claimedAt).getTime() >= this.claimTimeoutMs;
  }

  private buildDefaultTitle(sourceType: ScheduleSourceType): string {
    return sourceType === 'cron' ? '周期任务' : '延迟任务';
  }

  private async readAll(): Promise<StoredSchedule[]> {
    const content = await readFile(this.filePath, 'utf-8');
    const payload = JSON.parse(content) as ScheduleFilePayload;
    return Array.isArray(payload.items) ? payload.items : [];
  }

  private async writeAll(items: StoredSchedule[]): Promise<void> {
    await writeFile(this.filePath, JSON.stringify({ items }, null, 2), 'utf-8');
  }
}