/**
 * 异步消息服务
 *
 * 负责处理异步消息队列，在后台处理消息并通过 SSE 推送结果给前端
 */

import { randomUUID } from 'node:crypto';
import type {
  AsyncMessageResult,
  SessionMessage,
  MessageStatus
} from '../types/index.js';
import type { PlatformCoreMessageClient } from './PlatformCoreMessageClient.js';
import type { SessionModel } from '../models/Session.js';
import type { SSEManager } from './SSEManager.js';

// SessionMessage 通过 AsyncMessageResult 间接使用
// 这里保留导入以确保类型正确性
void 0 as unknown as SessionMessage;

// SessionMessage 通过 AsyncMessageResult 间接使用
// 这里保留导入以确保类型正确性
void 0 as unknown as SessionMessage;

/**
 * 异步消息任务
 */
interface AsyncMessageTask {
  /** 任务 ID */
  taskId: string;
  /** 会话 ID */
  sessionId: string;
  /** Claude 会话 ID */
  claudeSessionId?: string;
  /** 消息 ID */
  messageId: string;
  /** 用户消息内容 */
  userMessage: string;
  /** 创建时间 */
  createdAt: Date;
}

/**
 * 异步消息服务配置
 */
export interface AsyncMessageServiceConfig {
  /** 最大并发任务数 */
  maxConcurrentTasks?: number;
  /** 任务超时时间（毫秒） */
  taskTimeoutMs?: number;
  /** 重试最大次数 */
  maxRetries?: number;
}

/**
 * 异步消息服务类
 */
export class AsyncMessageService {
  private readonly taskQueue = new Map<string, AsyncMessageTask>();
  private readonly processingTasks = new Set<string>();
  private readonly maxConcurrentTasks: number;
  private readonly taskTimeoutMs: number;
  private readonly maxRetries: number;
  private isProcessing = false;
  private sseManager?: SSEManager;

  constructor(
    private readonly sessionModel: SessionModel,
    private readonly platformCoreClient: PlatformCoreMessageClient,
    config: AsyncMessageServiceConfig = {}
  ) {
    this.maxConcurrentTasks = config.maxConcurrentTasks ?? 10;
    this.taskTimeoutMs = config.taskTimeoutMs ?? 300000; // 5 分钟
    this.maxRetries = config.maxRetries ?? 2;

    // 启动队列处理
    this.startQueueProcessor();
  }

  /**
   * 设置 SSE 管理器
   */
  setSSEManager(sseManager: SSEManager): void {
    this.sseManager = sseManager;
  }

  /**
   * 提交异步消息任务
   */
  async submitTask(task: Omit<AsyncMessageTask, 'taskId' | 'createdAt'>): Promise<string> {
    const fullTask: AsyncMessageTask = {
      ...task,
      taskId: randomUUID(),
      createdAt: new Date()
    };

    this.taskQueue.set(fullTask.taskId, fullTask);

    // 触发队列处理
    this.processQueue();

    return fullTask.taskId;
  }

  /**
   * 提交异步消息任务（简化接口）
   */
  async submitMessage(sessionId: string, messageId: string, message: string, claudeSessionId?: string): Promise<string> {
    return this.submitTask({
      sessionId,
      messageId,
      userMessage: message,
      claudeSessionId
    });
  }

  /**
   * 获取任务状态
   */
  getTaskStatus(taskId: string): { status: 'queued' | 'processing' | 'not-found' } {
    if (this.taskQueue.has(taskId)) {
      return { status: 'queued' };
    }
    if (this.processingTasks.has(taskId)) {
      return { status: 'processing' };
    }
    return { status: 'not-found' };
  }

  /**
   * 启动队列处理器
   */
  private startQueueProcessor(): void {
    // 定期检查队列
    setInterval(() => {
      this.processQueue();
    }, 1000);

    // 定期清理超时任务
    setInterval(() => {
      this.cleanupTimeoutTasks();
    }, 30000);
  }

  /**
   * 处理队列
   */
  private processQueue(): void {
    if (this.isProcessing) {
      return;
    }

    // 检查是否还有空闲的处理槽位
    if (this.processingTasks.size >= this.maxConcurrentTasks) {
      return;
    }

    // 获取下一个待处理任务
    const nextTask = this.getNextTask();
    if (!nextTask) {
      return;
    }

    // 标记为处理中
    this.processingTasks.add(nextTask.taskId);
    this.taskQueue.delete(nextTask.taskId);

    // 异步处理任务
    this.processTask(nextTask).catch((error) => {
      console.error('[AsyncMessageService] Task processing error:', error);
    });
  }

  /**
   * 获取下一个待处理任务
   */
  private getNextTask(): AsyncMessageTask | null {
    for (const task of this.taskQueue.values()) {
      return task;
    }
    return null;
  }

  /**
   * 处理单个任务
   */
  private async processTask(task: AsyncMessageTask, retryCount = 0): Promise<void> {
    const startTime = Date.now();

    try {
      console.log(`[AsyncMessageService] Processing task ${task.taskId} for session ${task.sessionId}`);

      // 更新消息状态为 processing
      await this.updateMessageStatus(task.sessionId, task.messageId, 'processing');

      // 发送消息到 platform-core
      const coreReply = await this.platformCoreClient.sendUserMessage({
        sessionId: task.sessionId,
        message: task.userMessage,
        claudeSessionId: task.claudeSessionId,
        timeoutMs: this.taskTimeoutMs
      });

      // 更新 claudeSessionId
      if (coreReply.claudeSessionId) {
        await this.sessionModel.update(task.sessionId, {
          claudeSessionId: coreReply.claudeSessionId
        });
      }

      // 保存消息轮次
      const result = await this.sessionModel.appendMessageTurn(
        task.sessionId,
        task.userMessage,
        coreReply.response
      );

      // 更新消息状态为 completed
      await this.updateMessageStatus(task.sessionId, task.messageId, 'completed');

      // 推送结果
      await this.pushResult(task, {
        sessionId: task.sessionId,
        messageId: task.messageId,
        userMessage: result.userMessage,
        reply: result.assistantMessage,
        ok: true
      });

      const duration = Date.now() - startTime;
      console.log(`[AsyncMessageService] Task ${task.taskId} completed in ${duration}ms`);

    } catch (error) {
      console.error(`[AsyncMessageService] Task ${task.taskId} failed:`, error);

      // 检查是否需要重试
      if (retryCount < this.maxRetries) {
        console.log(`[AsyncMessageService] Retrying task ${task.taskId} (${retryCount + 1}/${this.maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, 1000 * (retryCount + 1)));
        return this.processTask(task, retryCount + 1);
      }

      // 更新消息状态为 failed
      await this.updateMessageStatus(task.sessionId, task.messageId, 'failed', String(error));

      // 推送错误结果
      await this.pushResult(task, {
        sessionId: task.sessionId,
        messageId: task.messageId,
        userMessage: {
          id: task.messageId,
          sessionId: task.sessionId,
          role: 'user',
          content: task.userMessage,
          createdAt: task.createdAt.toISOString(),
          status: 'failed',
          error: String(error)
        },
        reply: {
          id: randomUUID(),
          sessionId: task.sessionId,
          role: 'assistant',
          content: '',
          createdAt: new Date().toISOString()
        },
        ok: false,
        error: String(error)
      });
    } finally {
      // 从处理中集合移除
      this.processingTasks.delete(task.taskId);

      // 触发下一个任务处理
      this.processQueue();
    }
  }

  /**
   * 更新消息状态
   */
  private async updateMessageStatus(
    _sessionId: string,
    _messageId: string,
    _status: MessageStatus,
    _error?: string
  ): Promise<void> {
    // TODO: 需要SessionModel支持更新单个消息状态
    // 当前消息模型不支持状态更新，这里保留接口以便后续扩展
  }

  /**
   * 推送结果
   */
  private async pushResult(task: AsyncMessageTask, result: AsyncMessageResult): Promise<void> {
    // 通过 SSE 推送给前端
    if (this.sseManager) {
      this.sseManager.pushToSession(task.sessionId, {
        type: 'message_result',
        data: result
      });
    }

    console.log(`[AsyncMessageService] Result pushed for session ${task.sessionId}, message ${task.messageId}`);
  }

  /**
   * 清理超时任务
   */
  private cleanupTimeoutTasks(): void {
    const now = Date.now();

    for (const [taskId, task] of this.taskQueue) {
      const age = now - task.createdAt.getTime();

      if (age > this.taskTimeoutMs) {
        console.warn(`[AsyncMessageService] Task ${taskId} timed out, removing from queue`);

        // 标记为失败
        this.updateMessageStatus(task.sessionId, task.messageId, 'failed', 'Task timeout');

        // 从队列移除
        this.taskQueue.delete(taskId);

        // 推送超时结果
        this.pushResult(task, {
          sessionId: task.sessionId,
          messageId: task.messageId,
          userMessage: {
            id: task.messageId,
            sessionId: task.sessionId,
            role: 'user',
            content: task.userMessage,
            createdAt: task.createdAt.toISOString(),
            status: 'failed',
            error: 'Task timeout'
          },
          reply: {
            id: randomUUID(),
            sessionId: task.sessionId,
            role: 'assistant',
            content: '',
            createdAt: new Date().toISOString()
          },
          ok: false,
          error: 'Task timeout'
        }).catch(console.error);
      }
    }
  }

  /**
   * 获取服务状态
   */
  getStatus(): {
    queuedTasks: number;
    processingTasks: number;
    maxConcurrentTasks: number;
  } {
    return {
      queuedTasks: this.taskQueue.size,
      processingTasks: this.processingTasks.size,
      maxConcurrentTasks: this.maxConcurrentTasks
    };
  }

  /**
   * 关闭服务
   */
  shutdown(): void {
    // 取消所有排队的任务
    for (const task of this.taskQueue.values()) {
      this.pushResult(task, {
        sessionId: task.sessionId,
        messageId: task.messageId,
        userMessage: {
          id: task.messageId,
          sessionId: task.sessionId,
          role: 'user',
          content: task.userMessage,
          createdAt: task.createdAt.toISOString(),
          status: 'failed',
          error: 'Service shutdown'
        },
        reply: {
          id: randomUUID(),
          sessionId: task.sessionId,
          role: 'assistant',
          content: '',
          createdAt: new Date().toISOString()
        },
        ok: false,
        error: 'Service shutdown'
      }).catch(console.error);
    }

    this.taskQueue.clear();
  }
}
