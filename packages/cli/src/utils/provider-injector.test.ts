import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { maybeInjectProvider } from './provider-injector.js';

const providerComponentPath = 'src/components/i18n-provider.tsx';
const providerTemplate = `'use client';

export default function Providers({ children }: { children: React.ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}
`;

describe('provider injector', () => {
  let workspaceRoot: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'i18nsmith-inject-'));
    cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(workspaceRoot);
    await fs.mkdir(path.join(workspaceRoot, 'app'), { recursive: true });
  });

  afterEach(async () => {
    cwdSpy.mockRestore();
    await fs.rm(workspaceRoot, { recursive: true, force: true });
  });

  it('injects the provider when children expression exists', async () => {
    const providerFile = path.join(workspaceRoot, 'app/providers.tsx');
    await fs.writeFile(providerFile, providerTemplate, 'utf8');

    const result = await maybeInjectProvider({ providerComponentPath });
    expect(result.status).toBe('injected');
    if (result.status !== 'injected') return;

    const contents = await fs.readFile(providerFile, 'utf8');
  expect(contents).toMatch(/import \{ I18nProvider \} from ['"].+i18n-provider['"];?/);
    expect(contents).toContain('<I18nProvider>{children}</I18nProvider>');
  });

  it('previews changes without touching files when dryRun is true', async () => {
    const providerFile = path.join(workspaceRoot, 'app/providers.tsx');
    await fs.writeFile(providerFile, providerTemplate, 'utf8');

    const result = await maybeInjectProvider({ providerComponentPath, dryRun: true });
    expect(result.status).toBe('preview');
    if (result.status !== 'preview') return;
    expect(result.diff).toContain('I18nProvider');

    const contents = await fs.readFile(providerFile, 'utf8');
    expect(contents).toBe(providerTemplate);
  });

  it('fails gracefully when multiple children expressions exist', async () => {
    const providerFile = path.join(workspaceRoot, 'app/providers.tsx');
    await fs.writeFile(
      providerFile,
      `'use client';

export default function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ThemeProvider>
      {children}
      <div>{children}</div>
    </ThemeProvider>
  );
}
`,
      'utf8'
    );

    const result = await maybeInjectProvider({ providerComponentPath });
    expect(result.status).toBe('failed');
    if (result.status !== 'failed') return;
    expect(result.reason).toMatch(/Multiple/);
  });
});
