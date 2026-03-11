/**
 * 会话控制器
 *
 * 负责处理会话相关的 HTTP 请求
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import type {
  CreateSessionRequest,
  CreateSessionResponse,
  SessionInfo,
  ListSessionsRequest,
  SendSessionMessageRequest,
  SendSessionMessageResponse,
  StoredSession
} from '../types/index.js';
import { SessionModel } from '../models/Session.js';
import { ValidationError, SessionNotFoundError } from '../types/index.js';

/**
 * 会话控制器类
 */
export class SessionController {
  constructor(private readonly sessionModel: SessionModel) {}

  /**
   * 处理创建会话请求（POST /sessions）
   */
  async handleCreateSession(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const body = await this.readJsonBody(request);
      const createRequest = this.validateCreateSessionRequest(body);

      const session = await this.sessionModel.create(createRequest);

      const sessionResponse: CreateSessionResponse = {
        sessionId: session.id,
        claudeSessionId: session.claudeSessionId,
        createdAt: session.createdAt
      };

      this.sendJson(response, 201, sessionResponse);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  /**
   * 处理获取会话请求（GET /sessions/:sessionId）
   */
  async handleGetSession(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const sessionId = this.extractSessionId(request);
      const session = await this.sessionModel.findById(sessionId);

      if (!session) {
        throw new SessionNotFoundError(sessionId);
      }

      const sessionInfo = this.toSessionInfo(session);

      this.sendJson(response, 200, sessionInfo);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  /**
   * 处理列出会话请求（GET /sessions）
   */
  async handleListSessions(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const url = new URL(request.url || '/', 'http://localhost');

      const limit = this.parseOptionalNumber(url.searchParams.get('limit'));
      const status = this.parseOptionalStatus(url.searchParams.get('status'));

      const listRequest: ListSessionsRequest = {
        limit: limit ?? undefined,
        status
      };

      const sessions = await this.sessionModel.list(listRequest);

      const sessionInfos: SessionInfo[] = sessions.map(session => this.toSessionInfo(session));

      this.sendJson(response, 200, sessionInfos);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  /**
   * 处理获取会话消息请求（GET /sessions/:sessionId/messages）
   */
  async handleGetMessages(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const sessionId = this.extractSessionId(request);
      const session = await this.sessionModel.findById(sessionId);

      if (!session) {
        throw new SessionNotFoundError(sessionId);
      }

      const messages = await this.sessionModel.listMessages(sessionId);

      this.sendJson(response, 200, {
        sessionId,
        messages
      });
    } catch (error) {
      this.handleError(response, error);
    }
  }

  /**
   * 处理发送会话消息请求（POST /sessions/:sessionId/messages）
   */
  async handleSendMessage(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const sessionId = this.extractSessionId(request);
      const session = await this.sessionModel.findById(sessionId);

      if (!session) {
        throw new SessionNotFoundError(sessionId);
      }

      if (session.status !== 'active') {
        throw new ValidationError('Cannot send messages to a deleted session');
      }

      const body = await this.readJsonBody(request);
      const sendRequest = this.validateSendMessageRequest(body);
      const result = await this.sessionModel.submitMessage(sessionId, sendRequest.message);

      const payload: SendSessionMessageResponse = {
        sessionId,
        userMessage: result.userMessage,
        reply: result.assistantMessage,
        messages: result.messages
      };

      this.sendJson(response, 200, payload);
    } catch (error) {
      this.handleError(response, error);
    }
  }

  /**
   * 处理删除会话请求（DELETE /sessions/:sessionId）
   */
  async handleDeleteSession(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const sessionId = this.extractSessionId(request);

      const deleted = await this.sessionModel.delete(sessionId);

      if (!deleted) {
        throw new SessionNotFoundError(sessionId);
      }

      this.sendJson(response, 200, {
        deleted: true,
        sessionId
      });
    } catch (error) {
      this.handleError(response, error);
    }
  }

  /**
   * 从请求中提取会话 ID
   */
  private extractSessionId(request: IncomingMessage): string {
    const url = new URL(request.url || '/', 'http://localhost');
    const pathSegments = url.pathname.split('/').filter(s => s.length > 0);

    if (pathSegments.length < 2 || pathSegments[0] !== 'sessions') {
      throw new ValidationError('Invalid session endpoint');
    }

    return pathSegments[1];
  }

  /**
   * 验证创建会话请求
   */
  private validateCreateSessionRequest(body: unknown): CreateSessionRequest {
    if (!body || typeof body !== 'object') {
      throw new ValidationError('Request body must be a valid object');
    }

    const req = body as Record<string, unknown>;
    const createRequest: CreateSessionRequest = {};

    if (typeof req.externalSource === 'string' && req.externalSource.trim().length > 0) {
      createRequest.externalSource = req.externalSource.trim();
    }

    if (typeof req.externalConversationId === 'string' && req.externalConversationId.trim().length > 0) {
      createRequest.externalConversationId = req.externalConversationId.trim();
    }

    return createRequest;
  }

  /**
   * 验证发送消息请求
   */
  private validateSendMessageRequest(body: unknown): SendSessionMessageRequest {
    if (!body || typeof body !== 'object') {
      throw new ValidationError('Request body must be a valid object');
    }

    const req = body as Record<string, unknown>;
    const message = typeof req.message === 'string' ? req.message.trim() : '';

    if (!message) {
      throw new ValidationError('message is required');
    }

    return { message };
  }

  /**
   * 解析可选数字参数
   */
  private parseOptionalNumber(value: string | null): number | null {
    if (!value) return null;
    const parsed = parseInt(value, 10);
    return isNaN(parsed) ? null : parsed;
  }

  /**
   * 解析可选状态参数
   */
  private parseOptionalStatus(value: string | null): 'active' | 'deleted' | undefined {
    if (!value) return undefined;
    if (value === 'active' || value === 'deleted') {
      return value;
    }
    return undefined;
  }

  /**
   * 转换会话模型为 API 响应
   */
  private toSessionInfo(session: StoredSession): SessionInfo {
    return {
      sessionId: session.id,
      claudeSessionId: session.claudeSessionId,
      status: session.status,
      createdAt: session.createdAt,
      lastActiveAt: session.lastActiveAt,
      externalMappings: session.externalMappings
    };
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
      : error instanceof SessionNotFoundError
        ? 404
        : 500;

    const message = error instanceof Error ? error.message : String(error);

    this.sendJson(response, statusCode, {
      error: message,
      ok: false
    });
  }
}
