import type { ServerResponse } from 'node:http';
import type { HealthCheckResponse } from '../types/index.js';

export class HealthController {
  private readonly startTime = new Date();

  constructor(private readonly version: string = '0.1.0') {}

  async handleHealth(response: ServerResponse, activeSchedules: number): Promise<void> {
    const healthResponse: HealthCheckResponse = {
      ok: true,
      uptime: Math.floor((Date.now() - this.startTime.getTime()) / 1000),
      activeSchedules,
      version: this.version,
      startedAt: this.startTime.toISOString()
    };

    this.sendJson(response, 200, healthResponse);
  }

  async handleReady(response: ServerResponse): Promise<void> {
    this.sendJson(response, 200, {
      ready: true,
      timestamp: new Date().toISOString()
    });
  }

  private sendJson(response: ServerResponse, statusCode: number, data: unknown): void {
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(`${JSON.stringify(data, null, 2)}\n`);
  }
}