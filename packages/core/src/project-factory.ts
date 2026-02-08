import { Project, type ProjectOptions } from 'ts-morph';
import { JsxEmit } from 'typescript';

const DEFAULT_OPTIONS: ProjectOptions = {
  skipAddingFilesFromTsConfig: true,
};

const SCANNER_OPTIONS: ProjectOptions = {
  ...DEFAULT_OPTIONS,
  skipFileDependencyResolution: true,
  compilerOptions: {
    allowJs: true,
    jsx: JsxEmit.Preserve,
  },
};

function buildOptions(base: ProjectOptions, overrides?: ProjectOptions): ProjectOptions {
  if (!overrides) {
    return {
      ...base,
      compilerOptions: base.compilerOptions ? { ...base.compilerOptions } : undefined,
    };
  }

  const { compilerOptions: baseCompiler } = base;
  const { compilerOptions: overrideCompiler, ...restOverrides } = overrides;

  return {
    ...base,
    ...restOverrides,
    compilerOptions: {
      ...(baseCompiler ?? {}),
      ...(overrideCompiler ?? {}),
    },
  };
}

export function createDefaultProject(overrides?: ProjectOptions): Project {
  return new Project(buildOptions(DEFAULT_OPTIONS, overrides));
}

export function createScannerProject(overrides?: ProjectOptions): Project {
  return new Project(buildOptions(SCANNER_OPTIONS, overrides));
}
