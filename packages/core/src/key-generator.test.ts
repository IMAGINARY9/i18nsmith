import { describe, expect, it } from 'vitest';
import { KeyGenerator } from './key-generator';
import { CandidateKind } from './scanner';

const baseContext = {
  filePath: '/tmp/src/App.tsx',
  kind: 'jsx-text' as CandidateKind,
  context: '<div>',
};

describe('KeyGenerator', () => {
  it('produces deterministic slug+hash keys', () => {
    const generator = new KeyGenerator({ namespace: 'demo' });
    const result = generator.generate('Hello world', baseContext);

    expect(result.key.startsWith('demo.app.div.')).toBe(true);
    expect(result.hash).toHaveLength(6);

    const second = generator.generate('Hello world', baseContext);
    expect(second.key).toBe(result.key);
    expect(second.hash).toBe(result.hash);
  });

  it('uses different hashes for different inputs', () => {
    const generator = new KeyGenerator({ namespace: 'demo' });
    const first = generator.generate('Checkout', baseContext);
    const second = generator.generate('Checkout now', baseContext);

    expect(first.key).not.toBe(second.key);
  });
});
