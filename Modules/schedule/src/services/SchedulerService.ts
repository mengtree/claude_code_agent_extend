import type { Logger } from '../utils/Logger.js';
import { ScheduleStore } from '../models/ScheduleStore.js';
import type { ScheduleExecutionResult } from '../types/index.js';

interface DispatchResult {
  success: boolean;
  result?: ScheduleExecutionResult;
  error?: string;
}

export class SchedulerService {
  private timer?: NodeJS.Timeout;
  private isTickRunning = false;

  constructor(
    private readonly scheduleStore: ScheduleStore,
    private readonly dispatchToBus: (schedule: {
      id: string;
      title: string;
      message: string;
      systemPrompt?: string;
      model?: string;
      claudeSessionId?: string;
      workingDirectory?: string;
      sessionId?: string;
      sourceType: 'delay' | 'cron';
    }) => Promise<DispatchResult>,
    private readonly logger: Logger,
    private readonly scanIntervalMs: number
  ) {}

  start(): void {
    if (this.timer) {
      return;
    }

    this.timer = setInterval(() => {
      void this.tick();
    }, this.scanIntervalMs);

    void this.tick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async tick(): Promise<void> {
    if (this.isTickRunning) {
      return;
    }

    this.isTickRunning = true;

    try {
      const dueSchedules = await this.scheduleStore.claimDueSchedules(new Date());
      for (const schedule of dueSchedules) {
        const triggerAt = schedule.claimedAt || new Date().toISOString();
        try {
          const result = await this.dispatchToBus(schedule);
          if (!result.success) {
            throw new Error(result.error || 'Failed to dispatch schedule to message bus');
          }

          if (!result.result?.ok) {
            throw new Error(result.result?.error || 'platform-core returned an unsuccessful result');
          }

          const summary = result.result.response?.slice(0, 300) || 'platform-core returned an empty response';
          await this.scheduleStore.markExecutionSucceeded(
            schedule.id,
            triggerAt,
            summary,
            result.result.claudeSessionId
          );
          this.logger.info(`[schedule] Completed ${schedule.id} successfully`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          await this.scheduleStore.markExecutionFailed(schedule.id, triggerAt, message);
          this.logger.error(`[schedule] Failed to complete ${schedule.id}:`, message);
        }
      }
    } catch (error) {
      this.logger.error('[schedule] Tick failed:', error);
    } finally {
      this.isTickRunning = false;
    }
  }
}