import { describe, expect, it } from 'vitest';
import { KeyGenerator } from './key-generator';
import { CandidateKind } from './scanner';

const baseContext = {
  filePath: '/tmp/src/app/activity/page.tsx',
  kind: 'jsx-text' as CandidateKind,
  context: '<div>',
};

describe('KeyGenerator', () => {
  it('produces deterministic slug+hash keys', () => {
  const generator = new KeyGenerator({ namespace: 'demo', workspaceRoot: '/tmp' });
    const result = generator.generate('Hello world', baseContext);

  expect(result.key.startsWith('demo.app.activity.page.div.')).toBe(true);
    expect(result.hash).toHaveLength(6);

    const second = generator.generate('Hello world', baseContext);
    expect(second.key).toBe(result.key);
    expect(second.hash).toBe(result.hash);
  });

  it('uses different hashes for different inputs', () => {
    const generator = new KeyGenerator({ namespace: 'demo', workspaceRoot: '/tmp' });
    const first = generator.generate('Checkout', baseContext);
    const second = generator.generate('Checkout now', baseContext);

    expect(first.key).not.toBe(second.key);
  });

  it('derives scope from relative paths when no workspace root provided', () => {
    const generator = new KeyGenerator({ namespace: 'demo' });
    const context = {
      filePath: 'src/dashboard/index.tsx',
      kind: 'jsx-text' as CandidateKind,
    };

    const key = generator.generate('Dashboard title', context).key;
    expect(key.startsWith('demo.dashboard.')).toBe(true);
  });
});
