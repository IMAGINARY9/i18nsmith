import { PassThrough } from 'stream';
import { EventEmitter } from 'events';
import type { ChildProcessWithoutNullStreams } from 'child_process';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { runResolvedCliCommand } from './cli-runner';

const spawnMock = vi.fn();

vi.mock('child_process', () => ({
  spawn: (...args: unknown[]) => spawnMock(...args),
}));

function createFakeChild() {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const stdin = new PassThrough();
  const emitter = new EventEmitter();
  const child = emitter as unknown as ChildProcessWithoutNullStreams;
  Object.assign(child, {
    stdout,
    stderr,
    stdin,
    kill: vi.fn(() => true),
  });
  return { child, stdout, stderr };
}

describe('runResolvedCliCommand', () => {
  beforeEach(() => {
    spawnMock.mockReset();
  });

  it('captures stdout/stderr and respects callbacks', async () => {
  const { child, stdout, stderr } = createFakeChild();
    spawnMock.mockReturnValue(child);

    const stdoutSpy = vi.fn();
    const stderrSpy = vi.fn();
    const resultPromise = runResolvedCliCommand(
      { command: 'node', args: ['script.js'], display: 'node script.js', source: 'external' },
      {
        cwd: '/tmp',
        onStdout: (chunk, proc) => stdoutSpy(chunk, proc),
        onStderr: (chunk, proc) => stderrSpy(chunk, proc),
      }
    );

    stdout.emit('data', 'hello');
    stderr.emit('data', 'warn');
  child.emit('close', 0, null);

    const result = await resultPromise;
    expect(result.stdout).toBe('hello');
    expect(result.stderr).toBe('warn');
    expect(stdoutSpy).toHaveBeenCalledWith('hello', child);
    expect(stderrSpy).toHaveBeenCalledWith('warn', child);
    expect(result.code).toBe(0);
    expect(result.timedOut).toBe(false);
  });

  it('kills the process when timeout is reached', async () => {
    vi.useFakeTimers();
  const { child } = createFakeChild();
    spawnMock.mockReturnValue(child);

    const promise = runResolvedCliCommand(
      { command: 'node', args: ['script.js'], display: 'node script.js', source: 'external' },
      {
        cwd: '/tmp',
        timeoutMs: 10,
      }
    );

    vi.advanceTimersByTime(15);
  child.emit('close', null, 'SIGTERM');
    const result = await promise;
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(result.timedOut).toBe(true);
    vi.useRealTimers();
  });
});
