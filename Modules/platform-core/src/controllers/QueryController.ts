/**
 * 查询控制器
 *
 * 负责处理查询相关的 HTTP 请求
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import type { ClaudeQueryRequest } from '../types/index.js';
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeSdkService } from '../services/ClaudeSdkService.js';
import { ValidationError } from '../types/index.js';

/**
 * 查询控制器类
 */
export class QueryController {
  constructor(
    private readonly sdkService: ClaudeSdkService,
    private readonly getDefaultSessionId: () => string | undefined
  ) {}

  /**
   * 处理查询请求（POST /query）
   */
  async handleQuery(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const body = await this.readJsonBody(request);
      const queryRequest = this.validateQueryRequest(body);

      // 执行查询
      const result = await this.sdkService.execute(queryRequest);

      this.sendJson(response, 200, result);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  /**
   * 处理流式查询请求（POST /stream）
   */
  async handleStreamQuery(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const body = await this.readJsonBody(request);
      const queryRequest = this.validateQueryRequest(body);

      // 设置 SSE 响应头
      this.setupSseHeaders(response);

      // 发送连接成功消息
      this.writeSseEvent(response, 'connected', {
        message: 'Stream connection established',
        timestamp: new Date().toISOString()
      });

      // 执行流式查询
      const self = this;
      await this.sdkService.executeStream(
        queryRequest,
        {
          async onMessage(message: SDKMessage) {
            self.writeSseEvent(response, 'message', message);
          },
          async onResult(message) {
            self.writeSseEvent(response, 'result', message);
          },
          onError(error: Error) {
            self.writeSseEvent(response, 'error', {
              error: error.message,
              timestamp: new Date().toISOString()
            });
          },
          abortSignal: request.aborted
            ? AbortSignal.abort()
            : undefined
        }
      );

      // 发送完成消息
      this.writeSseEvent(response, 'done', {
        timestamp: new Date().toISOString()
      });

    } catch (error) {
      this.writeSseEvent(response, 'error', {
        error: error instanceof Error ? error.message : String(error),
        timestamp: new Date().toISOString()
      });
    }
  }

  /**
   * 处理 SSE 事件流请求（GET /events）
   */
  async handleEvents(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url || '/', 'http://localhost');
    const sessionId = url.searchParams.get('sessionId') || undefined;

    // 设置 SSE 响应头
    this.setupSseHeaders(response);

    // 发送连接成功消息
    this.writeSseEvent(response, 'connected', {
      message: 'Event stream connected',
      sessionId,
      timestamp: new Date().toISOString()
    });

    // 设置心跳
    const heartbeatInterval = setInterval(() => {
      this.writeSseEvent(response, 'heartbeat', {
        timestamp: new Date().toISOString()
      });
    }, 15000);

    // 清理连接
    request.on('close', () => {
      clearInterval(heartbeatInterval);
    });
  }

  /**
   * 验证查询请求
   */
  private validateQueryRequest(body: unknown): ClaudeQueryRequest {
    if (!body || typeof body !== 'object') {
      throw new ValidationError('Request body must be a valid object');
    }

    const req = body as Record<string, unknown>;

    if (typeof req.prompt !== 'string' || req.prompt.trim().length === 0) {
      throw new ValidationError('prompt is required and must be a non-empty string');
    }

    const queryRequest: ClaudeQueryRequest = {
      prompt: req.prompt.trim()
    };

    // 可选参数
    if (typeof req.sessionId === 'string' && req.sessionId.trim().length > 0) {
      queryRequest.sessionId = req.sessionId.trim();
    } else {
      // 使用默认会话 ID
      const defaultSessionId = this.getDefaultSessionId();
      if (defaultSessionId) {
        queryRequest.sessionId = defaultSessionId;
      }
    }

    if (typeof req.systemPrompt === 'string' && req.systemPrompt.trim().length > 0) {
      queryRequest.systemPrompt = req.systemPrompt.trim();
    }

    if (typeof req.model === 'string' && req.model.trim().length > 0) {
      queryRequest.model = req.model.trim();
    }

    if (typeof req.timeoutMs === 'number' && req.timeoutMs > 0) {
      queryRequest.timeoutMs = req.timeoutMs;
    }

    if (req.jsonSchema && typeof req.jsonSchema === 'object') {
      queryRequest.jsonSchema = req.jsonSchema as Record<string, unknown>;
    }

    if (typeof req.stream === 'boolean') {
      queryRequest.stream = req.stream;
    }

    return queryRequest;
  }

  /**
   * 读取 JSON 请求体
   */
  private async readJsonBody(request: IncomingMessage): Promise<unknown> {
    const bodyText = await new Promise<string>((resolve, reject) => {
      let body = '';

      request.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });

      request.on('end', () => {
        resolve(body);
      });

      request.on('error', reject);
    });

    if (!bodyText.trim()) {
      return {};
    }

    try {
      return JSON.parse(bodyText);
    } catch (error) {
      throw new ValidationError('Invalid JSON in request body');
    }
  }

  /**
   * 设置 SSE 响应头
   */
  private setupSseHeaders(response: ServerResponse): void {
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    response.setHeader('Cache-Control', 'no-cache, no-transform');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');
  }

  /**
   * 写入 SSE 事件
   */
  private writeSseEvent(response: ServerResponse, event: string, data: unknown): void {
    try {
      response.write(`event: ${event}\n`);
      response.write(`data: ${JSON.stringify(data)}\n\n`);
    } catch (error) {
      // 连接可能已关闭，忽略错误
      console.debug('Failed to write SSE event:', error);
    }
  }

  /**
   * 发送 JSON 响应
   */
  private sendJson(response: ServerResponse, statusCode: number, data: unknown): void {
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(`${JSON.stringify(data, null, 2)}\n`);
  }

  /**
   * 处理错误
   */
  private handleError(response: ServerResponse, error: unknown): void {
    const statusCode = error instanceof ValidationError
      ? 400
      : error instanceof Error && 'statusCode' in error
        ? (error as { statusCode: number }).statusCode
        : 500;

    const message = error instanceof Error ? error.message : String(error);

    this.sendJson(response, statusCode, {
      error: message,
      ok: false
    });
  }
}
