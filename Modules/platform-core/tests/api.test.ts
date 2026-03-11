/**
 * 平台核心模块 API 测试
 *
 * 测试 HTTP API 的基本功能
 */

import { strict as assert } from 'node:assert';
import { test, describe, before, after } from 'node:test';
import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { request } from 'node:https';
import { PlatformCoreApp } from '../src/index.js';

/**
 * 测试配置
 */
const TEST_CONFIG = {
  port: 13000,
  host: '127.0.0.1',
  defaultModel: 'claude-sonnet-4-6',
  defaultTimeoutMs: 30000,
  maxConcurrentSessions: 10,
  sessionPersistence: true,
  logLevel: 'error' as const
};

/**
 * HTTP 请求辅助函数
 */
async function httpRequest(
  method: string,
  path: string,
  body?: unknown,
  port: number = TEST_CONFIG.port
): Promise<{ statusCode: number; data: unknown }> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: TEST_CONFIG.host,
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    const req = request('http://' + TEST_CONFIG.host, options, (res) => {
      let data = '';

      res.on('data', (chunk) => {
        data += chunk;
      });

      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ statusCode: res.statusCode || 200, data: parsed });
        } catch {
          resolve({ statusCode: res.statusCode || 200, data });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

/**
 * 测试套件
 */
describe('Platform Core API Tests', () => {
  let app: PlatformCoreApp;

  before(async () => {
    // 启动应用
    app = new PlatformCoreApp(TEST_CONFIG as any);
    await app.start();

    // 等待服务器就绪
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  after(async () => {
    // 停止应用
    if (app) {
      await app.stop();
    }
  });

  describe('Health Check', () => {
    test('GET /health should return health status', async () => {
      const result = await httpRequest('GET', '/health');

      assert.equal(result.statusCode, 200);
      assert.ok((result.data as any).ok);
      assert.ok(typeof (result.data as any).uptime === 'number');
      assert.ok(typeof (result.data as any).version === 'string');
    });

    test('GET /ready should return ready status', async () => {
      const result = await httpRequest('GET', '/ready');

      assert.equal(result.statusCode, 200);
      assert.ok((result.data as any).ready);
    });
  });

  describe('Session Management', () => {
    test('POST /sessions should create a new session', async () => {
      const result = await httpRequest('POST', '/sessions', {
        externalSource: 'test',
        externalConversationId: 'test_conv_001'
      });

      assert.equal(result.statusCode, 201);
      assert.ok((result.data as any).sessionId);
      assert.ok(typeof (result.data as any).createdAt === 'string');
    });

    test('GET /sessions should list sessions', async () => {
      const result = await httpRequest('GET', '/sessions');

      assert.equal(result.statusCode, 200);
      assert.ok(Array.isArray(result.data));
    });

    test('DELETE /sessions/:id should delete session', async () => {
      // 先创建会话
      const createResult = await httpRequest('POST', '/sessions');
      const sessionId = (createResult.data as any).sessionId;

      // 删除会话
      const deleteResult = await httpRequest('DELETE', `/sessions/${sessionId}`);

      assert.equal(deleteResult.statusCode, 200);
      assert.ok((deleteResult.data as any).deleted);
    });
  });

  describe('Query API', () => {
    test('POST /query should execute a query', async () => {
      const result = await httpRequest('POST', '/query', {
        prompt: 'Hello, please respond with "OK"',
        systemPrompt: 'You are a helpful assistant'
      });

      assert.equal(result.statusCode, 200);
      assert.ok((result.data as any).ok !== undefined);
      assert.ok(typeof (result.data as any).result === 'string');
    });

    test('POST /query with sessionId should maintain context', async () => {
      // 创建会话
      const sessionResult = await httpRequest('POST', '/sessions');
      const sessionId = (sessionResult.data as any).sessionId;

      // 使用会话 ID 进行查询
      const result = await httpRequest('POST', '/query', {
        prompt: 'What is 2+2?',
        sessionId
      });

      assert.equal(result.statusCode, 200);
      assert.equal((result.data as any).sessionId, sessionId);
    });

    test('POST /query should validate required fields', async () => {
      const result = await httpRequest('POST', '/query', {});

      assert.equal(result.statusCode, 400);
      assert.ok((result.data as any).error);
    });
  });

  describe('Stream API', () => {
    test('POST /stream should establish SSE connection', async () => {
      // 注意：完整的 SSE 测试需要更复杂的客户端
      // 这里只验证连接建立
      const result = await httpRequest('POST', '/stream', {
        prompt: 'Count to 5'
      });

      // 流式请求不会立即返回完整响应
      // 实际测试需要使用 SSE 客户端
      assert.ok(result.statusCode >= 200 && result.statusCode < 300);
    });
  });

  describe('Error Handling', () => {
    test('GET /nonexistent should return 404', async () => {
      const result = await httpRequest('GET', '/nonexistent');

      assert.equal(result.statusCode, 404);
    });

    test('DELETE /sessions/nonexistent should return 404', async () => {
      const result = await httpRequest('DELETE', '/sessions/nonexistent-id');

      assert.equal(result.statusCode, 404);
    });
  });
});
