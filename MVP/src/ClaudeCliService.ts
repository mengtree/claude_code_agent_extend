import { cwd as getCurrentWorkingDirectory } from 'node:process';
import type { Options as ClaudeSdkOptions, Query as ClaudeSdkQuery, SDKMessage, SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';
import { ClaudeCliRawResult, ClaudeCliRequest, ClaudeCliResponse } from './types';

type ClaudeSdkModule = typeof import('@anthropic-ai/claude-agent-sdk');

const dynamicImport = new Function(
  'specifier',
  'return import(specifier);'
) as (specifier: string) => Promise<ClaudeSdkModule>;

export interface ClaudeCliExecution {
  completion: Promise<ClaudeCliResponse>;
  cancel: () => void;
}

export class ClaudeCliService {
  private sdkModulePromise?: Promise<ClaudeSdkModule>;

  async execute(request: ClaudeCliRequest): Promise<ClaudeCliResponse> {
    return this.startExecution(request).completion;
  }

  startExecution(request: ClaudeCliRequest): ClaudeCliExecution {
    if (!request.task.trim()) {
      throw new Error('Task must not be empty.');
    }

    const workingDirectory = request.workingDirectory || getCurrentWorkingDirectory();
    const timeoutMs = request.timeoutMs ?? 120000;

    return this.runClaudeQuery(request, workingDirectory, timeoutMs);
  }

  private runClaudeQuery(request: ClaudeCliRequest, workingDirectory: string, timeoutMs: number): ClaudeCliExecution {
    const abortController = new AbortController();
    let query: ClaudeSdkQuery | undefined;
    let cancellationError: Error | undefined;
    let isCancelled = false;

    const cancel = (reason?: Error): void => {
      if (isCancelled) {
        return;
      }

      isCancelled = true;
      cancellationError = reason ?? new Error('Claude SDK call was cancelled.');
      abortController.abort();

      if (query) {
        query.close();
      }
    };

    const handleAbort = (): void => {
      cancel(new Error('Claude SDK call was cancelled.'));
    };

    if (request.abortSignal) {
      if (request.abortSignal.aborted) {
        handleAbort();
      } else {
        request.abortSignal.addEventListener('abort', handleAbort, { once: true });
      }
    }

    const completion = (async (): Promise<ClaudeCliResponse> => {
      const timeoutHandle = setTimeout(() => {
        cancel(new Error(`Claude SDK call timed out after ${timeoutMs}ms.`));
      }, timeoutMs);

      try {
        const sdk = await this.loadSdkModule();
        query = sdk.query({
          prompt: request.task,
          options: this.buildSdkOptions(request, workingDirectory, abortController)
        });

        let rawResult: ClaudeCliRawResult | undefined;

        for await (const message of query) {
          if (this.isResultMessage(message)) {
            rawResult = this.mapSdkResultToRaw(message, request.jsonSchema);
          }
        }

        if (cancellationError) {
          throw cancellationError;
        }

        if (!rawResult) {
          throw new Error('Claude SDK did not return a result message.');
        }

        return this.mapRawResultToResponse(rawResult);
      } catch (error) {
        if (cancellationError) {
          throw cancellationError;
        }

        throw error;
      } finally {
        clearTimeout(timeoutHandle);

        if (request.abortSignal) {
          request.abortSignal.removeEventListener('abort', handleAbort);
        }
      }
    })();

    return {
      completion,
      cancel: () => cancel()
    };
  }

  private buildSdkOptions(
    request: ClaudeCliRequest,
    workingDirectory: string,
    abortController: AbortController
  ): ClaudeSdkOptions {
    const options: ClaudeSdkOptions = {
      abortController,
      cwd: workingDirectory,
      permissionMode: 'bypassPermissions',
      allowDangerouslySkipPermissions: true,
      persistSession: !request.noSessionPersistence,
      systemPrompt: request.systemPrompt,
      model: request.model,
      resume: request.resumeSessionId,
      outputFormat: request.jsonSchema
        ? {
            type: 'json_schema',
            schema: request.jsonSchema
          }
        : undefined
    };

    return options;
  }

  private async loadSdkModule(): Promise<ClaudeSdkModule> {
    if (!this.sdkModulePromise) {
      this.sdkModulePromise = dynamicImport('@anthropic-ai/claude-agent-sdk');
    }

    return this.sdkModulePromise;
  }

  private isResultMessage(message: SDKMessage): message is SDKResultMessage {
    return message.type === 'result';
  }

  private mapSdkResultToRaw(message: SDKResultMessage, jsonSchema?: Record<string, unknown>): ClaudeCliRawResult {
    const rawResult = { ...message } as ClaudeCliRawResult;

    if ('structured_output' in message && message.structured_output !== undefined) {
      rawResult.result = JSON.stringify(message.structured_output);
      return rawResult;
    }

    if ('result' in message && typeof message.result === 'string') {
      rawResult.result = message.result;
      return rawResult;
    }

    if (jsonSchema) {
      rawResult.result = JSON.stringify({ errors: 'errors' in message ? message.errors : [] });
      return rawResult;
    }

    rawResult.result = 'errors' in message ? message.errors.join('\n') : '';
    return rawResult;
  }

  private mapRawResultToResponse(rawResult: ClaudeCliRawResult): ClaudeCliResponse {
    const resultText = typeof rawResult.result === 'string' ? rawResult.result : JSON.stringify(rawResult);

    return {
      ok: !rawResult.is_error,
      sessionId: rawResult.session_id,
      result: resultText,
      durationMs: rawResult.duration_ms,
      costUsd: rawResult.total_cost_usd,
      stopReason: rawResult.stop_reason,
      raw: rawResult
    };
  }
}