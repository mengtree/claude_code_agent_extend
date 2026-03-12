/**
 * Claude SDK 服务
 *
 * 负责与 Claude Agent SDK 的交互，提供流式和非流式查询能力
 */

import type { Options as ClaudeSdkOptions, Query as ClaudeSdkQuery, SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { randomUUID } from 'node:crypto';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import type {
  ClaudeQueryRequest,
  ClaudeQueryResponse,
  ClaudeSdkRawResult
} from '../types/index.js';
import { fileURLToPath } from 'node:url';

/**
 * SDK 动态导入类型
 */
type ClaudeSdkModule = typeof import('@anthropic-ai/claude-agent-sdk');

const dynamicImport = new Function(
  'specifier',
  'return import(specifier);'
) as (specifier: string) => Promise<ClaudeSdkModule>;

const defaultWorkingDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const skillsPromptHeader = [
  '你正在 AgentExtend 工作区中执行任务。',
  '在需要了解模块能力、模块接入规范或模块用途时，优先扫描工作区 Modules 目录下各模块的 skills 文件夹。'
].join('\n');

/**
 * 流式查询回调函数类型
 */
export interface StreamCallbacks {
  /** 当收到消息时调用 */
  onMessage?: (message: SDKMessage) => void | Promise<void>;
  /** 当收到最终结果时调用 */
  onResult?: (message: Extract<SDKMessage, { type: 'result' }>) => void | Promise<void>;
  /** 当发生错误时调用 */
  onError?: (error: Error) => void | Promise<void>;
}

/**
 * 流式查询选项
 */
export interface StreamQueryOptions extends StreamCallbacks {
  /** 取消信号 */
  abortSignal?: AbortSignal;
}

/**
 * Claude SDK 服务类
 */
export class ClaudeSdkService {
  private sdkModulePromise?: Promise<ClaudeSdkModule>;
  private activeQueries: Map<string, ClaudeSdkQuery> = new Map();

  /**
   * 执行查询（非流式）
   */
  async execute(request: ClaudeQueryRequest): Promise<ClaudeQueryResponse> {
    const queryId = randomUUID();
    const startTime = Date.now();
    const abortController = new AbortController();

    try {
      const sdk = await this.loadSdkModule();
      const options = this.buildSdkOptions(request, abortController);

      const query = sdk.query({
        prompt: request.prompt,
        options
      });

      this.activeQueries.set(queryId, query);

      let rawResult: ClaudeSdkRawResult | undefined;

      for await (const message of query) {
        if (this.isResultMessage(message)) {
          rawResult = this.extractRawResult(message);
        }
      }

      this.activeQueries.delete(queryId);

      if (!rawResult) {
        throw new Error('Claude SDK did not return a result message');
      }

      return this.buildResponse(rawResult, Date.now() - startTime);

    } catch (error) {
      this.activeQueries.delete(queryId);
      throw error;
    }
  }

  /**
   * 执行流式查询
   */
  async executeStream(
    request: ClaudeQueryRequest,
    callbacks: StreamQueryOptions
  ): Promise<ClaudeQueryResponse> {
    const queryId = randomUUID();
    const startTime = Date.now();
    const abortController = new AbortController();
    let rawResult: ClaudeSdkRawResult | undefined;

    try {
      const sdk = await this.loadSdkModule();
      const options = this.buildSdkOptions(request, abortController);

      const query = sdk.query({
        prompt: request.prompt,
        options
      });

      this.activeQueries.set(queryId, query);

      // 设置取消信号处理
      if (callbacks.abortSignal) {
        const handleAbort = () => {
          abortController.abort();
          this.cancelQuery(queryId);
        };

        if (callbacks.abortSignal.aborted) {
          handleAbort();
        } else {
          callbacks.abortSignal.addEventListener('abort', handleAbort, { once: true });
        }
      }

      // 流式处理消息
      for await (const message of query) {
        // 调用通用回调
        await callbacks.onMessage?.(message);

        // 调用特定类型回调
        if (message.type === 'result') {
          rawResult = this.extractRawResult(message as Extract<SDKMessage, { type: 'result' }>);
          await callbacks.onResult?.(message as Extract<SDKMessage, { type: 'result' }>);
        }
      }

      this.activeQueries.delete(queryId);

      if (!rawResult) {
        throw new Error('Claude SDK did not return a result message');
      }

      return this.buildResponse(rawResult, Date.now() - startTime);

    } catch (error) {
      this.activeQueries.delete(queryId);
      await callbacks.onError?.(error as Error);
      throw error;
    }
  }

  /**
   * 取消查询
   */
  cancelQuery(queryId: string): void {
    const query = this.activeQueries.get(queryId);
    if (query) {
      try {
        query.close();
      } catch (error) {
        console.error(`Error closing query ${queryId}:`, error);
      }
      this.activeQueries.delete(queryId);
    }
  }

  /**
   * 取消所有活动查询
   */
  cancelAllQueries(): void {
    for (const [queryId, query] of this.activeQueries.entries()) {
      try {
        query.close();
      } catch (error) {
        console.error(`Error closing query ${queryId}:`, error);
      }
    }
    this.activeQueries.clear();
  }

  /**
   * 获取活动查询数量
   */
  getActiveQueryCount(): number {
    return this.activeQueries.size;
  }

  /**
   * 构建 SDK 选项
   */
  private buildSdkOptions(
    request: ClaudeQueryRequest,
    abortController: AbortController
  ): ClaudeSdkOptions {
    const workingDirectory = request.workingDirectory || defaultWorkingDirectory;
    const options: ClaudeSdkOptions = {
      abortController,
      cwd: workingDirectory,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      persistSession: true,
      systemPrompt: this.buildSystemPrompt(request.systemPrompt, workingDirectory),
      model: request.model
    };

    // 如果有 JSON Schema，添加结构化输出选项
    if (request.jsonSchema) {
      options.outputFormat = {
        type: 'json_schema',
        schema: request.jsonSchema
      };
    }

    // 设置会话恢复
    if (request.claudeSessionId) {
      options.resume = request.claudeSessionId;
    }

    return options;
  }

  /**
   * 构建系统提示词
   */
  private buildSystemPrompt(systemPrompt: string | undefined, workingDirectory: string): string {
    const workspaceRoot = this.resolveWorkspaceRoot(workingDirectory);
    const moduleSkillsPattern = resolve(workspaceRoot, 'Modules', '*', 'skills', '*', 'SKILL.md');
    const discoveredSkillPaths = this.collectSkillDocumentPaths(workspaceRoot);

    const autoPromptLines = [
      skillsPromptHeader,
      `当前工作目录: ${workingDirectory}`,
      `工作区根目录: ${workspaceRoot}`,
      `模块 skill 扫描模式: ${moduleSkillsPattern}`,
      '优先读取各模块 skills 目录下的 SKILL.md 作为模块能力说明入口。'
    ];

    if (discoveredSkillPaths.length > 0) {
      autoPromptLines.push('当前已发现的 skill 文档路径:');
      autoPromptLines.push(...discoveredSkillPaths.map((skillPath) => `- ${skillPath}`));
    }

    const autoPrompt = autoPromptLines.join('\n');

    if (!systemPrompt || systemPrompt.trim().length === 0) {
      return autoPrompt;
    }

    return `${systemPrompt.trim()}\n\n${autoPrompt}`;
  }

  /**
   * 根据工作目录推断工作区根目录
   */
  private resolveWorkspaceRoot(workingDirectory: string): string {
    const normalized = workingDirectory.replace(/\\/g, '/');
    const modulesSegment = '/Modules/';
    const modulesIndex = normalized.lastIndexOf(modulesSegment);

    if (modulesIndex >= 0) {
      return workingDirectory.slice(0, modulesIndex);
    }

    if (existsSync(resolve(workingDirectory, 'Modules'))) {
      return workingDirectory;
    }

    return workingDirectory;
  }

  /**
   * 收集工作区下所有 skill 主文档路径
   */
  private collectSkillDocumentPaths(workspaceRoot: string): string[] {
    const modulesDir = resolve(workspaceRoot, 'Modules');
    if (!existsSync(modulesDir)) {
      return [];
    }

    const moduleEntries = readdirSync(modulesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));

    const skillPaths: string[] = [];

    for (const moduleName of moduleEntries) {
      const skillsDir = resolve(modulesDir, moduleName, 'skills');
      if (!existsSync(skillsDir)) {
        continue;
      }

      const skillEntries = readdirSync(skillsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort((left, right) => left.localeCompare(right));

      for (const skillEntry of skillEntries) {
        const skillDocumentPath = resolve(skillsDir, skillEntry, 'SKILL.md');
        if (!existsSync(skillDocumentPath)) {
          continue;
        }

        try {
          if (!statSync(skillDocumentPath).isFile()) {
            continue;
          }
        } catch {
          continue;
        }

        skillPaths.push(skillDocumentPath);
      }
    }

    return skillPaths;
  }

  /**
   * 动态加载 SDK 模块
   */
  private async loadSdkModule(): Promise<ClaudeSdkModule> {
    if (!this.sdkModulePromise) {
      this.sdkModulePromise = dynamicImport('@anthropic-ai/claude-agent-sdk');
    }
    return this.sdkModulePromise;
  }

  /**
   * 判断是否为结果消息
   */
  private isResultMessage(message: SDKMessage): message is Extract<SDKMessage, { type: 'result' }> {
    return message.type === 'result';
  }

  /**
   * 从结果消息中提取原始结果
   */
  private extractRawResult(message: Extract<SDKMessage, { type: 'result' }>): ClaudeSdkRawResult {
    const rawResult: ClaudeSdkRawResult = {
      type: message.type,
      subtype: message.subtype,
      is_error: message.is_error,
      duration_ms: message.duration_ms,
      session_id: message.session_id,
      total_cost_usd: message.total_cost_usd,
      stop_reason: message.stop_reason ?? undefined
    };

    // 处理结构化输出
    if ('structured_output' in message && message.structured_output !== undefined) {
      rawResult.result = JSON.stringify(message.structured_output);
      rawResult.structured_output = message.structured_output;
    }
    // 处理普通结果
    else if ('result' in message && typeof message.result === 'string') {
      rawResult.result = message.result;
    }
    // 处理错误
    else if ('errors' in message && Array.isArray(message.errors)) {
      rawResult.errors = message.errors;
      rawResult.result = message.errors.join('\n');
    }

    return rawResult;
  }

  /**
   * 构建响应
   */
  private buildResponse(
    rawResult: ClaudeSdkRawResult,
    durationMs: number
  ): ClaudeQueryResponse {
    const resultText = typeof rawResult.result === 'string'
      ? rawResult.result
      : JSON.stringify(rawResult);

    return {
      ok: !rawResult.is_error,
      result: resultText,
      sessionId: rawResult.session_id,
      claudeSessionId: rawResult.session_id,
      durationMs,
      costUsd: rawResult.total_cost_usd,
      stopReason: rawResult.stop_reason,
      raw: rawResult
    };
  }
}

/**
 * 创建 Claude SDK 服务实例
 */
export function createClaudeSdkService(): ClaudeSdkService {
  return new ClaudeSdkService();
}
