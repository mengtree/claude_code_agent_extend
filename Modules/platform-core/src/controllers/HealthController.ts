/**
 * 健康检查控制器
 *
 * 负责处理健康检查和状态相关的 HTTP 请求
 */

import type { ServerResponse } from 'node:http';
import type { HealthCheckResponse } from '../types/index.js';

/**
 * 健康检查控制器类
 */
export class HealthController {
  private readonly startTime: Date;
  private readonly version: string;

  constructor(version: string = '0.1.0') {
    this.startTime = new Date();
    this.version = version;
  }

  /**
   * 处理健康检查请求（GET /health）
   */
  handleHealth(response: ServerResponse, activeSessions: number): void {
    const uptime = Math.floor((Date.now() - this.startTime.getTime()) / 1000);

    const healthResponse: HealthCheckResponse = {
      ok: true,
      uptime,
      activeSessions,
      version: this.version,
      startedAt: this.startTime.toISOString()
    };

    this.sendJson(response, 200, healthResponse);
  }

  /**
   * 处理就绪检查请求（GET /ready）
   */
  handleReady(response: ServerResponse): void {
    this.sendJson(response, 200, {
      ready: true,
      timestamp: new Date().toISOString()
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
