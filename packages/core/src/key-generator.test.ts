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

  it('deduplicates by value when enabled', () => {
    const generator = new KeyGenerator({ 
      namespace: 'demo', 
      workspaceRoot: '/tmp',
      deduplicateByValue: true 
    });
    
    const context1 = {
      filePath: '/tmp/src/page1.tsx',
      kind: 'jsx-text' as CandidateKind,
      context: '<div>',
    };
    
    const context2 = {
      filePath: '/tmp/src/page2.tsx',
      kind: 'jsx-text' as CandidateKind,
      context: '<span>',
    };

    const key1 = generator.generate('Hello world', context1);
    const key2 = generator.generate('Hello world', context2);

    // Same text should produce same key when deduplicateByValue is true
    expect(key1.key).toBe(key2.key);
    expect(key1.hash).toBe(key2.hash);
  });

  it('does not deduplicate by value when disabled', () => {
    const generator = new KeyGenerator({ 
      namespace: 'demo', 
      workspaceRoot: '/tmp',
      deduplicateByValue: false 
    });
    
    const context1 = {
      filePath: '/tmp/src/page1.tsx',
      kind: 'jsx-text' as CandidateKind,
      context: '<div>',
    };
    
    const context2 = {
      filePath: '/tmp/src/page2.tsx',
      kind: 'jsx-text' as CandidateKind,
      context: '<span>',
    };

    const key1 = generator.generate('Hello world', context1);
    const key2 = generator.generate('Hello world', context2);

    // Same text should produce different keys when deduplicateByValue is false
    expect(key1.key).not.toBe(key2.key);
  });
});
