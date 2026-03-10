import { randomUUID } from 'node:crypto';
import { SessionTask, TaskPriority } from './types';
import { Storage } from './Storage';
import { DebugLogger } from './DebugLogger';

export class TaskQueueService {
  constructor(private readonly storage: Storage) {}

  async list(sessionId: string): Promise<SessionTask[]> {
    const tasks = await this.storage.loadQueue(sessionId);
    return tasks.sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async enqueue(sessionId: string, content: string, summary: string, priority: TaskPriority): Promise<SessionTask> {
    return this.storage.withQueueLock(sessionId, async (tasks) => {
      const now = new Date().toISOString();
      const task: SessionTask = {
        id: randomUUID(),
        sessionId,
        content,
        summary,
        status: 'queued',
        priority,
        createdAt: now,
        updatedAt: now
      };

      tasks.push(task);
      await this.storage.writeQueueUnsafe(sessionId, this.sortTasks(tasks));
      DebugLogger.info('queue.enqueued', {
        sessionId,
        taskId: task.id,
        priority: task.priority,
        summary: task.summary,
        queueLength: tasks.length
      });
      return task;
    });
  }

  async removeQueuedTask(sessionId: string, taskId: string): Promise<SessionTask | undefined> {
    return this.storage.withQueueLock(sessionId, async (tasks) => {
      const taskIndex = tasks.findIndex((task) => task.id === taskId && task.status === 'queued');

      if (taskIndex < 0) {
        return undefined;
      }

      const [removedTask] = tasks.splice(taskIndex, 1);
      await this.storage.writeQueueUnsafe(sessionId, tasks);
      DebugLogger.info('queue.removed', {
        sessionId,
        taskId: removedTask.id,
        summary: removedTask.summary,
        queueLength: tasks.length
      });
      return removedTask;
    });
  }

  async claimNextQueuedTask(sessionId: string): Promise<SessionTask | undefined> {
    return this.storage.withQueueLock(sessionId, async (tasks) => {
      const sortedTasks = this.sortTasks(tasks);
      const queuedTask = sortedTasks.find((task) => task.status === 'queued');

      if (!queuedTask) {
        return undefined;
      }

      const updatedTask: SessionTask = {
        ...queuedTask,
        status: 'running',
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      const taskIndex = sortedTasks.findIndex((task) => task.id === updatedTask.id);
      sortedTasks[taskIndex] = updatedTask;
      await this.storage.writeQueueUnsafe(sessionId, this.sortTasks(sortedTasks));
      DebugLogger.info('queue.claimed', {
        sessionId,
        taskId: updatedTask.id,
        priority: updatedTask.priority,
        summary: updatedTask.summary
      });
      return updatedTask;
    });
  }

  async markCompleted(sessionId: string, taskId: string, result: string): Promise<SessionTask> {
    const completedTask = await this.completeAndRemoveTask(sessionId, taskId, result, false);

    if (!completedTask) {
      throw new Error(`Task ${taskId} was not found in session ${sessionId}.`);
    }

    return completedTask;
  }

  async tryMarkCompleted(sessionId: string, taskId: string, result: string): Promise<SessionTask | undefined> {
    return this.completeAndRemoveTask(sessionId, taskId, result, true);
  }

  async markFailed(sessionId: string, taskId: string, error: string): Promise<SessionTask> {
    return this.updateTask(sessionId, taskId, (task) => ({
      ...task,
      status: 'failed',
      error,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));
  }

  async tryMarkFailed(sessionId: string, taskId: string, error: string): Promise<SessionTask | undefined> {
    return this.tryUpdateTask(sessionId, taskId, (task) => ({
      ...task,
      status: 'failed',
      error,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));
  }

  async markCancelled(sessionId: string, taskId: string, reason: string): Promise<SessionTask> {
    return this.updateTask(sessionId, taskId, (task) => ({
      ...task,
      status: 'cancelled',
      error: reason,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));
  }

  async tryMarkCancelled(sessionId: string, taskId: string, reason: string): Promise<SessionTask | undefined> {
    return this.tryUpdateTask(sessionId, taskId, (task) => ({
      ...task,
      status: 'cancelled',
      error: reason,
      completedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    }));
  }

  private async updateTask(
    sessionId: string,
    taskId: string,
    update: (task: SessionTask) => SessionTask
  ): Promise<SessionTask> {
    return this.storage.withQueueLock(sessionId, async (tasks) => {
      const taskIndex = tasks.findIndex((task) => task.id === taskId);

      if (taskIndex < 0) {
        throw new Error(`Task ${taskId} was not found in session ${sessionId}.`);
      }

      const updatedTask = update(tasks[taskIndex]);
      tasks[taskIndex] = updatedTask;
      await this.storage.writeQueueUnsafe(sessionId, this.sortTasks(tasks));
      DebugLogger.info('queue.updated', {
        sessionId,
        taskId: updatedTask.id,
        status: updatedTask.status,
        summary: updatedTask.summary
      });
      return updatedTask;
    });
  }

  private async tryUpdateTask(
    sessionId: string,
    taskId: string,
    update: (task: SessionTask) => SessionTask
  ): Promise<SessionTask | undefined> {
    return this.storage.withQueueLock(sessionId, async (tasks) => {
      const taskIndex = tasks.findIndex((task) => task.id === taskId);

      if (taskIndex < 0) {
        return undefined;
      }

      const updatedTask = update(tasks[taskIndex]);
      tasks[taskIndex] = updatedTask;
      await this.storage.writeQueueUnsafe(sessionId, this.sortTasks(tasks));
      return updatedTask;
    });
  }

  private async completeAndRemoveTask(
    sessionId: string,
    taskId: string,
    result: string,
    suppressMissingTaskError: boolean
  ): Promise<SessionTask | undefined> {
    return this.storage.withQueueLock(sessionId, async (tasks) => {
      const taskIndex = tasks.findIndex((task) => task.id === taskId);

      if (taskIndex < 0) {
        if (suppressMissingTaskError) {
          return undefined;
        }

        throw new Error(`Task ${taskId} was not found in session ${sessionId}.`);
      }

      const now = new Date().toISOString();
      const completedTask: SessionTask = {
        ...tasks[taskIndex],
        status: 'completed',
        result,
        completedAt: now,
        updatedAt: now
      };

      tasks.splice(taskIndex, 1);
      await this.storage.writeQueueUnsafe(sessionId, this.sortTasks(tasks));
      DebugLogger.info('queue.completed_removed', {
        sessionId,
        taskId: completedTask.id,
        summary: completedTask.summary,
        queueLength: tasks.length
      });
      return completedTask;
    });
  }

  private sortTasks(tasks: SessionTask[]): SessionTask[] {
    return [...tasks].sort((left, right) => {
      if (left.status === 'queued' && right.status === 'queued' && left.priority !== right.priority) {
        return left.priority === 'urgent' ? -1 : 1;
      }

      return left.createdAt.localeCompare(right.createdAt);
    });
  }
}