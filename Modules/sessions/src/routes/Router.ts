/**
 * 路由器
 *
 * 负责将 HTTP 请求路由到相应的控制器
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import type { SessionController } from '../controllers/SessionController.js';
import type { HealthController } from '../controllers/HealthController.js';
import type { MessageController } from '../controllers/MessageController.js';
import type { SessionModel } from '../models/Session.js';

/**
 * 路由选项
 */
export interface RouterOptions {
  /** 控制器 */
  sessionController: SessionController;
  healthController: HealthController;
  messageController: MessageController;
  sessionModel: SessionModel;
}

/**
 * 路由器类
 */
export class Router {
  private readonly sessionController: SessionController;
  private readonly healthController: HealthController;
  private readonly messageController: MessageController;
  private readonly sessionModel: SessionModel;
  private server: Server | null = null;

  constructor(options: RouterOptions) {
    this.sessionController = options.sessionController;
    this.healthController = options.healthController;
    this.messageController = options.messageController;
    this.sessionModel = options.sessionModel;
  }

  /**
   * 启动 HTTP 服务器
   */
  async listen(port: number, host: string = '0.0.0.0'): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => {
        this.handleRequest(req, res).catch((error) => {
          console.error('Request handling error:', error);
          if (!res.headersSent) {
            res.statusCode = 500;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ error: 'Internal server error', ok: false }));
          }
        });
      });

      this.server.on('error', reject);

      this.server.listen(port, host, () => {
        resolve();
      });
    });
  }

  /**
   * 关闭 HTTP 服务器
   */
  async close(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      this.server.close((error) => {
        if (error) {
          reject(error);
        } else {
          this.server = null;
          resolve();
        }
      });
    });
  }

  /**
   * 处理 HTTP 请求
   */
  private async handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const method = request.method?.toUpperCase() || 'GET';
    const path = url.pathname;

    // 设置 CORS 头
    response.setHeader('Access-Control-Allow-Origin', '*');
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    // 处理 OPTIONS 预检请求
    if (method === 'OPTIONS') {
      response.statusCode = 204;
      response.end();
      return;
    }

    try {
      // 路由分发
      if (path === '/health' && method === 'GET') {
        const stats = await this.sessionModel.getStats();
        await this.healthController.handleHealth(response, stats.active);
        return;
      }

      if (path === '/ready' && method === 'GET') {
        await this.healthController.handleReady(response);
        return;
      }

      if (path === '/messages' && method === 'POST') {
        // 注意：这里需要将 IncomingMessage 转换为 Request
        // 在实际使用中可能需要使用 body-parser 或类似库
        await this.handleMessageRequest(request, response);
        return;
      }

      // 会话相关路由
      if (path === '/sessions' || path.startsWith('/sessions/')) {
        await this.handleSessionRoute(method, path, request, response);
        return;
      }

      // 404
      this.sendJson(response, 404, {
        error: 'Not found',
        ok: false,
        path
      });

    } catch (error) {
      console.error('Route handling error:', error);
      this.sendJson(response, 500, {
        error: 'Internal server error',
        ok: false
      });
    }
  }

  /**
   * 处理会话路由
   */
  private async handleSessionRoute(
    method: string,
    path: string,
    request: IncomingMessage,
    response: ServerResponse
  ): Promise<void> {
    // POST /sessions - 创建会话
    if (path === '/sessions' && method === 'POST') {
      await this.sessionController.handleCreateSession(request, response);
      return;
    }

    // GET /sessions - 列出会话
    if (path === '/sessions' && method === 'GET') {
      await this.sessionController.handleListSessions(request, response);
      return;
    }

    // GET /sessions/:sessionId - 获取会话
    if (path.startsWith('/sessions/') && method === 'GET') {
      await this.sessionController.handleGetSession(request, response);
      return;
    }

    // DELETE /sessions/:sessionId - 删除会话
    if (path.startsWith('/sessions/') && method === 'DELETE') {
      await this.sessionController.handleDeleteSession(request, response);
      return;
    }

    // 其他方法返回 405
    this.sendJson(response, 405, {
      error: 'Method not allowed',
      ok: false
    });
  }

  /**
   * 处理消息请求
   */
  private async handleMessageRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    // 读取请求体
    const body = await this.readBody(request);
    const data = JSON.parse(body);

    // 创建一个伪 Request 对象
    const pseudoRequest = {
      json: async () => data
    } as unknown as Request;

    await this.messageController.handleMessage(pseudoRequest, response);
  }

  /**
   * 读取请求体
   */
  private readBody(request: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      let body = '';

      request.on('data', (chunk: Buffer) => {
        body += chunk.toString();
      });

      request.on('end', () => {
        resolve(body);
      });

      request.on('error', reject);
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
 * 创建路由器
 */
export function createRouter(options: RouterOptions): Router {
  return new Router(options);
}
