import type { IncomingMessage, ServerResponse } from 'node:http';
import { URL } from 'node:url';
import { ScheduleStore } from '../models/ScheduleStore.js';
import type { CreateScheduleRequest, UpdateScheduleRequest } from '../types/index.js';
import { ValidationError } from '../types/index.js';

export class ScheduleController {
  constructor(private readonly scheduleStore: ScheduleStore) {}

  async handleList(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
    const items = await this.scheduleStore.list({
      status: (url.searchParams.get('status') || undefined) as any,
      sourceType: (url.searchParams.get('sourceType') || undefined) as any
    });
    this.sendJson(response, 200, { ok: true, items });
  }

  async handleGet(scheduleId: string, response: ServerResponse): Promise<void> {
    const schedule = await this.scheduleStore.getById(scheduleId);
    if (!schedule) {
      this.sendJson(response, 404, { ok: false, error: 'Schedule not found' });
      return;
    }

    this.sendJson(response, 200, { ok: true, item: schedule });
  }

  async handleCreate(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const body = await this.readJsonBody(request) as CreateScheduleRequest;
      const schedule = await this.scheduleStore.create(body);
      this.sendJson(response, 201, { ok: true, item: schedule });
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async handleUpdate(scheduleId: string, request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const body = await this.readJsonBody(request) as Partial<UpdateScheduleRequest>;
      const schedule = await this.scheduleStore.update({
        ...body,
        scheduleId
      });
      if (!schedule) {
        this.sendJson(response, 404, { ok: false, error: 'Schedule not found' });
        return;
      }

      this.sendJson(response, 200, { ok: true, item: schedule });
    } catch (error) {
      this.handleError(response, error);
    }
  }

  async handleDelete(scheduleId: string, response: ServerResponse): Promise<void> {
    const deleted = await this.scheduleStore.delete(scheduleId);
    if (!deleted) {
      this.sendJson(response, 404, { ok: false, error: 'Schedule not found' });
      return;
    }

    this.sendJson(response, 200, { ok: true, deleted, scheduleId });
  }

  private async readJsonBody(request: IncomingMessage): Promise<unknown> {
    const body = await new Promise<string>((resolve, reject) => {
      let chunks = '';
      request.on('data', (chunk: Buffer) => {
        chunks += chunk.toString();
      });
      request.on('end', () => resolve(chunks));
      request.on('error', reject);
    });

    if (!body.trim()) {
      return {};
    }

    try {
      return JSON.parse(body);
    } catch {
      throw new ValidationError('Invalid JSON in request body');
    }
  }

  private handleError(response: ServerResponse, error: unknown): void {
    const statusCode = error instanceof ValidationError ? error.statusCode : 500;
    this.sendJson(response, statusCode, {
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  }

  private sendJson(response: ServerResponse, statusCode: number, data: unknown): void {
    response.statusCode = statusCode;
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.end(`${JSON.stringify(data, null, 2)}\n`);
  }
}