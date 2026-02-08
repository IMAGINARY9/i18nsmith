import { describe, it, expect } from 'vitest';
import { JsxEmit } from 'typescript';
import { createDefaultProject, createScannerProject } from './project-factory.js';

describe('projectFactory', () => {
  it('creates scanner projects with jsx/allowJs enabled', () => {
    const project = createScannerProject();
    const options = project.getCompilerOptions();
    expect(options.allowJs).toBe(true);
    expect(options.jsx).toBe(JsxEmit.Preserve);
  });

  it('merges override options shallowly', () => {
    const project = createScannerProject({
      skipFileDependencyResolution: false,
      compilerOptions: {
        jsx: 2,
        allowJs: false,
      },
    });
    const options = project.getCompilerOptions();
    expect(options.allowJs).toBe(false);
    expect(options.jsx).toBe(2);
  });

  it('creates default project instances when overrides provided', () => {
    const project = createDefaultProject({ compilerOptions: { declaration: true } });
    expect(project.getCompilerOptions().declaration).toBe(true);
  });
});
