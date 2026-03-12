/**
 * SSE 连接管理器
 *
 * 管理前端 SSE 连接，推送异步消息结果
 */

import type { ServerResponse } from 'node:http';

/**
 * SSE 连接信息
 */
interface SSEConnection {
  /** 连接 ID */
  connectionId: string;
  /** 会话 ID */
  sessionId: string;
  /** HTTP 响应对象 */
  response: ServerResponse;
  /** 连接时间 */
  connectedAt: Date;
}

/**
 * SSE 管理器类
 */
export class SSEManager {
  private readonly connections = new Map<string, SSEConnection>();
  private readonly connectionsBySession = new Map<string, Set<string>>();
  private heartbeatInterval?: NodeJS.Timeout;

  constructor() {
    // 启动心跳，保持连接活跃
    this.startHeartbeat();
  }

  /**
   * 添加 SSE 连接
   */
  addConnection(connectionId: string, sessionId: string, response: ServerResponse): void {
    // 设置 SSE 响应头
    response.statusCode = 200;
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no'); // 禁用 Nginx 缓冲
    response.flushHeaders();

    const connection: SSEConnection = {
      connectionId,
      sessionId,
      response,
      connectedAt: new Date()
    };

    this.connections.set(connectionId, connection);

    // 按会话分组
    if (!this.connectionsBySession.has(sessionId)) {
      this.connectionsBySession.set(sessionId, new Set());
    }
    this.connectionsBySession.get(sessionId)!.add(connectionId);

    // 发送连接成功消息
    this.sendToConnection(connection, {
      type: 'connected',
      connectionId,
      sessionId
    });

    console.log(`[SSEManager] Connection ${connectionId} added for session ${sessionId}`);
  }

  /**
   * 移除 SSE 连接
   */
  removeConnection(connectionId: string): void {
    const connection = this.connections.get(connectionId);
    if (!connection) {
      return;
    }

    // 从会话分组中移除
    const sessionConnections = this.connectionsBySession.get(connection.sessionId);
    if (sessionConnections) {
      sessionConnections.delete(connectionId);
      if (sessionConnections.size === 0) {
        this.connectionsBySession.delete(connection.sessionId);
      }
    }

    // 关闭响应
    try {
      connection.response.end();
    } catch {
      // 忽略错误
    }

    this.connections.delete(connectionId);
    console.log(`[SSEManager] Connection ${connectionId} removed`);
  }

  /**
   * 向指定会话的所有连接推送消息
   */
  pushToSession(sessionId: string, data: unknown): void {
    const sessionConnections = this.connectionsBySession.get(sessionId);
    if (!sessionConnections || sessionConnections.size === 0) {
      return;
    }

    let successCount = 0;
    sessionConnections.forEach((connectionId) => {
      const connection = this.connections.get(connectionId);
      if (connection) {
        this.sendToConnection(connection, data);
        successCount++;
      }
    });

    console.log(`[SSEManager] Pushed to ${successCount} connections for session ${sessionId}`);
  }

  /**
   * 向单个连接发送消息
   */
  private sendToConnection(connection: SSEConnection, data: unknown): void {
    try {
      const message = `data: ${JSON.stringify(data)}\n\n`;
      connection.response.write(message);
    } catch (error) {
      console.error(`[SSEManager] Failed to send to connection ${connection.connectionId}:`, error);
      // 移除失效的连接
      this.removeConnection(connection.connectionId);
    }
  }

  /**
   * 启动心跳
   */
  private startHeartbeat(): void {
    this.heartbeatInterval = setInterval(() => {
      const now = Date.now();
      const toRemove: string[] = [];

      this.connections.forEach((connection, connectionId) => {
        try {
          // 发送心跳注释
          connection.response.write(': heartbeat\n\n');

          // 检查连接是否超时（30分钟）
          const age = now - connection.connectedAt.getTime();
          if (age > 30 * 60 * 1000) {
            toRemove.push(connectionId);
          }
        } catch {
          toRemove.push(connectionId);
        }
      });

      // 移除超时或失效的连接
      toRemove.forEach((connectionId) => {
        this.removeConnection(connectionId);
      });
    }, 30000); // 每30秒发送一次心跳
  }

  /**
   * 获取连接统计
   */
  getStats(): {
    totalConnections: number;
    connectionsBySession: Record<string, number>;
  } {
    const connectionsBySession: Record<string, number> = {};
    this.connectionsBySession.forEach((connections, sessionId) => {
      connectionsBySession[sessionId] = connections.size;
    });

    return {
      totalConnections: this.connections.size,
      connectionsBySession
    };
  }

  /**
   * 关闭所有连接
   */
  shutdown(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
    }

    this.connections.forEach((_, connectionId) => {
      this.removeConnection(connectionId);
    });
  }
}
