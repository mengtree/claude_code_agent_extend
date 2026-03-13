/**
 * 路由器
 *
 * 负责将 HTTP 请求路由到相应的控制器
 */

import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import type { Server } from 'node:http';
import { URL } from 'node:url';
import { QueryController } from '../controllers/QueryController.js';
import { SessionController } from '../controllers/SessionController.js';
import { HealthController } from '../controllers/HealthController.js';
import { MessageController } from '../controllers/MessageController.js';
import { SessionModel } from '../models/Session.js';

/**
 * 路由器类
 */
export class Router {
  private server?: Server;

  constructor(
    private readonly queryController: QueryController,
    private readonly sessionController: SessionController,
    private readonly healthController: HealthController,
    private readonly messageController: MessageController,
    private readonly sessionModel: SessionModel
  ) {}

  /**
   * 创建并启动 HTTP 服务器（非阻塞）
   *
   * 启动后立即返回，服务器在后台运行
   */
  async listen(port: number, host: string = '127.0.0.1'): Promise<void> {
    // 如果已有服务器在运行，先关闭它
    if (this.server) {
      await this.close();
    }

    this.server = createServer(async (request, response) => {
      await this.handle(request, response);
    });

    // 启动服务器并立即返回（不阻塞）
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', (err: Error) => {
        // 只在初始启动时处理错误，运行时的错误由其他机制处理
        if ((err as any).code === 'EADDRINUSE') {
          reject(err);
        }
      });
      this.server!.listen(port, host, () => {
        this.server!.off('error', reject);
        resolve();
      });
    });
  }

  /**
   * 停止服务器
   */
  async close(): Promise<void> {
    if (this.server) {
      await new Promise<void>((resolve) => {
        this.server!.close(() => resolve());
      });
      this.server = undefined;
    }
  }

  async handle(request: IncomingMessage, response: ServerResponse, rawUrl?: string): Promise<void> {
    try {
      await this.handleRequest(request, response, rawUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.sendJson(response, 500, { error: message, ok: false });
    }
  }

  /**
   * 处理请求
   */
  private async handleRequest(request: IncomingMessage, response: ServerResponse, rawUrl?: string): Promise<void> {
    const url = new URL(rawUrl || request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const method = (request.method || 'GET').toUpperCase();
    const pathSegments = url.pathname.split('/').filter(s => s.length > 0);

    // 健康检查
    if (method === 'GET' && url.pathname === '/health') {
      const stats = await this.sessionModel.getStats();
      this.healthController.handleHealth(response, stats.active);
      return;
    }

    // 就绪检查
    if (method === 'GET' && url.pathname === '/ready') {
      this.healthController.handleReady(response);
      return;
    }

    // 查询端点（非流式）
    if (method === 'POST' && url.pathname === '/query') {
      await this.queryController.handleQuery(request, response);
      return;
    }

    // 流式查询端点
    if (method === 'POST' && url.pathname === '/stream') {
      await this.queryController.handleStreamQuery(request, response);
      return;
    }

    // 事件流端点
    if (method === 'GET' && url.pathname === '/events') {
      await this.queryController.handleEvents(request, response);
      return;
    }

    // 通用消息端点
    if (method === 'POST' && url.pathname === '/messages') {
      await this.messageController.handleMessage(request, response);
      return;
    }

    // 创建会话
    if (method === 'POST' && url.pathname === '/sessions') {
      await this.sessionController.handleCreateSession(request, response);
      return;
    }

    // 获取会话
    if (method === 'GET' && pathSegments.length === 2 && pathSegments[0] === 'sessions') {
      await this.sessionController.handleGetSession(request, response);
      return;
    }

    // 删除会话
    if (method === 'DELETE' && pathSegments.length === 2 && pathSegments[0] === 'sessions') {
      await this.sessionController.handleDeleteSession(request, response);
      return;
    }

    // 列出会话
    if (method === 'GET' && url.pathname === '/sessions') {
      await this.sessionController.handleListSessions(request, response);
      return;
    }

    // 404
    this.sendJson(response, 404, {
      error: `Route ${method} ${url.pathname} not found`,
      ok: false
    });
  }

  /**
   * 发送 JSON 响应
   */
  private sendJson(response: ServerResponse, statusCode: number, data: unknown): void {
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(`${JSON.stringify(data, null, 2)}\n`);
  }
}

/**
 * 创建路由器实例
 */
export function createRouter(
  queryController: QueryController,
  sessionController: SessionController,
  healthController: HealthController,
  messageController: MessageController,
  sessionModel: SessionModel
): Router {
  return new Router(queryController, sessionController, healthController, messageController, sessionModel);
}
