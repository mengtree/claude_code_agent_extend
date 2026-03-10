import assert from 'node:assert/strict';
import { rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ScheduleService } from './ScheduleService';
import { Storage } from './Storage';
import { ScheduleTask } from './types';

async function testOneTimeScheduleDeletesAfterTaskCompletion(): Promise<void> {
  const workspacePath = join(process.cwd(), '.tmp-schedule-service-one-time');
  await rm(workspacePath, { recursive: true, force: true });

  try {
    const storage = new Storage(workspacePath);
    const scheduleService = new ScheduleService(storage);
    const schedule: ScheduleTask = {
      id: 'schedule-one-time',
      sessionId: 'session-a',
      content: '提醒我检查日报',
      summary: '检查日报',
      sourceType: 'one_time',
      status: 'active',
      createdAt: '2026-03-10T08:00:00.000Z',
      updatedAt: '2026-03-10T08:00:00.000Z',
      nextRunAt: '2026-03-10T08:01:00.000Z'
    };

    await storage.saveSchedule(schedule.sessionId, schedule);
    const claimed = await scheduleService.claimDueSchedules(new Date('2026-03-10T08:01:00.000Z'));

    assert.equal(claimed.length, 1);
    await scheduleService.completeTriggeredSchedule(claimed[0], 'task-one-time');

    const dispatched = await storage.loadSchedule(schedule.sessionId, schedule.id);
    assert.ok(dispatched);
    assert.equal(dispatched?.status, 'dispatched');
    assert.equal(dispatched?.lastDispatchedTaskId, 'task-one-time');

    await scheduleService.settleTriggeredTask(
      {
        id: 'task-one-time',
        sessionId: schedule.sessionId,
        sourceScheduleId: schedule.id
      },
      'completed'
    );

    const reloaded = await storage.loadSchedule(schedule.sessionId, schedule.id);
    assert.equal(reloaded, undefined);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
}

async function testCronScheduleKeepsFileAndMovesNextRun(): Promise<void> {
  const workspacePath = join(process.cwd(), '.tmp-schedule-service-cron');
  await rm(workspacePath, { recursive: true, force: true });

  try {
    const storage = new Storage(workspacePath);
    const scheduleService = new ScheduleService(storage);
    const schedule: ScheduleTask = {
      id: 'schedule-cron',
      sessionId: 'session-b',
      content: '每日汇总昨天的问题清单',
      summary: '问题清单汇总',
      sourceType: 'cron',
      status: 'active',
      createdAt: '2026-03-10T08:00:00.000Z',
      updatedAt: '2026-03-10T08:00:00.000Z',
      nextRunAt: '2026-03-10T08:01:00.000Z',
      cronExpression: '2 8 * * *',
      timezone: 'UTC'
    };

    await storage.saveSchedule(schedule.sessionId, schedule);
    const claimed = await scheduleService.claimDueSchedules(new Date('2026-03-10T08:01:00.000Z'));

    assert.equal(claimed.length, 1);
    await scheduleService.completeTriggeredSchedule(claimed[0], 'task-cron');

    const dispatched = await storage.loadSchedule(schedule.sessionId, schedule.id);
    assert.ok(dispatched);
    assert.equal(dispatched?.status, 'dispatched');
    assert.equal(dispatched?.lastTriggeredAt, '2026-03-10T08:01:00.000Z');
    assert.equal(dispatched?.nextRunAt, '2026-03-10T08:01:00.000Z');

    await scheduleService.settleTriggeredTask(
      {
        id: 'task-cron',
        sessionId: schedule.sessionId,
        sourceScheduleId: schedule.id,
        sourceScheduleTriggerAt: '2026-03-10T08:01:00.000Z'
      },
      'completed'
    );

    const reloaded = await storage.loadSchedule(schedule.sessionId, schedule.id);
    assert.ok(reloaded);
    assert.equal(reloaded?.status, 'active');
    assert.equal(reloaded?.lastTriggeredAt, '2026-03-10T08:01:00.000Z');
    assert.equal(reloaded?.nextRunAt, '2026-03-10T08:02:00.000Z');
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
}

async function testOneTimeSchedulePausesAfterTaskFailure(): Promise<void> {
  const workspacePath = join(process.cwd(), '.tmp-schedule-service-failure');
  await rm(workspacePath, { recursive: true, force: true });

  try {
    const storage = new Storage(workspacePath);
    const scheduleService = new ScheduleService(storage);
    const schedule: ScheduleTask = {
      id: 'schedule-failed',
      sessionId: 'session-d',
      content: '提醒我处理失败任务',
      summary: '失败任务验证',
      sourceType: 'one_time',
      status: 'active',
      createdAt: '2026-03-10T08:00:00.000Z',
      updatedAt: '2026-03-10T08:00:00.000Z',
      nextRunAt: '2026-03-10T08:01:00.000Z'
    };

    await storage.saveSchedule(schedule.sessionId, schedule);
    const claimed = await scheduleService.claimDueSchedules(new Date('2026-03-10T08:01:00.000Z'));

    assert.equal(claimed.length, 1);
    await scheduleService.completeTriggeredSchedule(claimed[0], 'task-failed');
    await scheduleService.settleTriggeredTask(
      {
        id: 'task-failed',
        sessionId: schedule.sessionId,
        sourceScheduleId: schedule.id
      },
      'failed',
      'mock failure'
    );

    const reloaded = await storage.loadSchedule(schedule.sessionId, schedule.id);
    assert.ok(reloaded);
    assert.equal(reloaded?.status, 'paused');
    assert.equal(reloaded?.lastError, 'mock failure');
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
}

async function testRejectsAmbiguousAbsoluteTimeWithoutTimezone(): Promise<void> {
  const workspacePath = join(process.cwd(), '.tmp-schedule-service-ambiguous-time');
  await rm(workspacePath, { recursive: true, force: true });

  try {
    const storage = new Storage(workspacePath);
    const scheduleService = new ScheduleService(storage);
    const schedule: ScheduleTask = {
      id: 'schedule-ambiguous',
      sessionId: 'session-c',
      content: '提醒我处理模糊时间',
      summary: '模糊时间验证',
      sourceType: 'one_time',
      status: 'active',
      createdAt: '2026-03-10T08:00:00.000Z',
      updatedAt: '2026-03-10T08:00:00.000Z',
      nextRunAt: '2026-03-10T08:01:00'
    };

    await storage.saveSchedule(schedule.sessionId, schedule);
    const listed = await scheduleService.list(schedule.sessionId);
    const claimed = await scheduleService.claimDueSchedules(new Date('2026-03-10T08:02:00.000Z'));

    assert.equal(listed.length, 0);
    assert.equal(claimed.length, 0);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  await testOneTimeScheduleDeletesAfterTaskCompletion();
  await testCronScheduleKeepsFileAndMovesNextRun();
  await testRejectsAmbiguousAbsoluteTimeWithoutTimezone();
  await testOneTimeSchedulePausesAfterTaskFailure();
  console.log('ScheduleService tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});