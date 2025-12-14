import { spawn, type ChildProcessWithoutNullStreams } from 'child_process';
import type { ResolvedCliCommand } from './cli-utils';

export interface CliExecutionOptions {
  cwd: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  onStdout?: (text: string, child: ChildProcessWithoutNullStreams) => void;
  onStderr?: (text: string, child: ChildProcessWithoutNullStreams) => void;
}

export interface CliExecutionResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
  error?: Error;
  timedOut: boolean;
}

export async function runResolvedCliCommand(
  resolved: ResolvedCliCommand,
  options: CliExecutionOptions
): Promise<CliExecutionResult> {
  if (!resolved.command) {
    return {
      code: null,
      signal: null,
      stdout: '',
      stderr: '',
      error: new Error('No command provided'),
      timedOut: false,
    };
  }

  return await new Promise<CliExecutionResult>((resolve) => {
    const child = spawn(resolved.command, resolved.args, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : process.env,
      stdio: 'pipe',
    });

    let stdout = '';
    let stderr = '';
    let childError: Error | undefined;
    let timedOut = false;
    let timeoutHandle: NodeJS.Timeout | null = null;

    if (options.timeoutMs && options.timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true;
        child.kill('SIGTERM');
      }, options.timeoutMs);
    }

    const finalize = (code: number | null, signal: NodeJS.Signals | null) => {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }
      resolve({
        code,
        signal,
        stdout,
        stderr,
        error: childError ?? (timedOut ? new Error(`Command timed out after ${options.timeoutMs}ms`) : undefined),
        timedOut,
      });
    };

    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      stdout += chunk;
      options.onStdout?.(chunk, child);
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string) => {
      stderr += chunk;
      options.onStderr?.(chunk, child);
    });

    child.once('error', (error) => {
      childError = error instanceof Error ? error : new Error(String(error));
    });

    child.once('close', (code, signal) => {
      finalize(code, signal);
    });
  });
}
