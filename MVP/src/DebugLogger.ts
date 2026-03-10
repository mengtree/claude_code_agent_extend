export class DebugLogger {
  static info(event: string, payload?: Record<string, unknown>): void {
    this.write('info', event, payload);
  }

  static warn(event: string, payload?: Record<string, unknown>): void {
    this.write('warn', event, payload);
  }

  static error(event: string, payload?: Record<string, unknown>): void {
    this.write('error', event, payload);
  }

  private static write(level: 'info' | 'warn' | 'error', event: string, payload?: Record<string, unknown>): void {
    const timestamp = new Date().toISOString();
    const serializedPayload = payload ? ` ${this.safeStringify(payload)}` : '';
    const line = `[debug][${timestamp}][${level}][${event}]${serializedPayload}\n`;

    if (level === 'error') {
      process.stderr.write(line);
      return;
    }

    process.stdout.write(line);
  }

  private static safeStringify(payload: Record<string, unknown>): string {
    try {
      return JSON.stringify(payload);
    } catch {
      return '{"error":"failed_to_serialize_payload"}';
    }
  }
}