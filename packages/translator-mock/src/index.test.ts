import { describe, expect, it } from 'vitest';
import { createTranslator } from './index';

describe('translator-mock', () => {
  it('pseudo-localizes translated strings', async () => {
    const translator = createTranslator({ provider: 'mock' });
    const [translated] = await translator.translate(['Hello, world'], 'en', 'es');
    expect(translated).toContain('[es]');
    expect(translated).toContain('Hélló');
  });

  it('estimates cost based on characters and locale count', () => {
    const translator = createTranslator({ provider: 'mock' });
    const estimate = translator.estimateCost?.(10, { localeCount: 2 });
    expect(estimate).toBe('20 mock-chars');
  });
});
