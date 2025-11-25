import path from 'path';
import { promises as fs } from 'fs';
import { createTwoFilesPatch } from 'diff';
import {
  ImportDeclaration,
  ImportSpecifier,
  JsxExpression,
  JsxOpeningElement,
  JsxSelfClosingElement,
  Node,
  Project,
  SourceFile,
  SyntaxKind,
} from 'ts-morph';

export type ProviderInjectionResult =
  | { status: 'injected'; file: string; diff?: string }
  | { status: 'preview'; file: string; diff: string }
  | { status: 'skipped'; file: string }
  | { status: 'failed'; file: string; reason: string }
  | { status: 'not-found' };

export interface ProviderInjectionOptions {
  providerComponentPath: string;
  candidates?: string[];
  dryRun?: boolean;
}

const DEFAULT_PROVIDER_CANDIDATES = [
  'app/providers.tsx',
  'app/providers.ts',
  'app/providers.jsx',
  'app/providers.js',
  'src/app/providers.tsx',
  'src/app/providers.ts',
  'src/app/providers.jsx',
  'src/app/providers.js',
];

export async function maybeInjectProvider(
  options: ProviderInjectionOptions
): Promise<ProviderInjectionResult> {
  const { providerComponentPath, candidates = DEFAULT_PROVIDER_CANDIDATES, dryRun = false } = options;
  const workspaceRoot = process.cwd();
  const providerAbsolute = path.resolve(providerComponentPath);

  for (const candidate of candidates) {
    const absoluteCandidate = path.resolve(workspaceRoot, candidate);
    if (!(await fileExists(absoluteCandidate))) {
      continue;
    }

    const injection = await injectIntoCandidate({
      candidateRelativePath: candidate,
      candidateAbsolutePath: absoluteCandidate,
      providerAbsolutePath: providerAbsolute,
      dryRun,
    });

    if (injection.status === 'not-found') {
      // Should never happen because we only call when file exists, but keep for safety
      continue;
    }

    return injection;
  }

  return { status: 'not-found' };
}

interface CandidateInjectionInput {
  candidateRelativePath: string;
  candidateAbsolutePath: string;
  providerAbsolutePath: string;
  dryRun: boolean;
}

async function injectIntoCandidate({
  candidateRelativePath,
  candidateAbsolutePath,
  providerAbsolutePath,
  dryRun,
}: CandidateInjectionInput): Promise<ProviderInjectionResult> {
  const originalContents = await fs.readFile(candidateAbsolutePath, 'utf8');

  const project = new Project({
    useInMemoryFileSystem: false,
    skipAddingFilesFromTsConfig: true,
  });

  const sourceFile = project.createSourceFile(candidateAbsolutePath, originalContents, { overwrite: true });

  if (usesI18nProvider(sourceFile)) {
    return { status: 'skipped', file: candidateRelativePath };
  }

  const childrenExpressions = findChildrenExpressions(sourceFile);
  if (childrenExpressions.length === 0) {
    return {
      status: 'failed',
      file: candidateRelativePath,
      reason: 'No `{children}` expression found to wrap with <I18nProvider>.',
    };
  }

  if (childrenExpressions.length > 1) {
    return {
      status: 'failed',
      file: candidateRelativePath,
      reason: 'Multiple `{children}` expressions detected; unsure which one to wrap.',
    };
  }

  const providerImportPath = toRelativeImport(path.dirname(candidateAbsolutePath), providerAbsolutePath);
  ensureProviderImport(sourceFile, providerImportPath);

  const expression = childrenExpressions[0];
  expression.replaceWithText(`<I18nProvider>${expression.getText()}</I18nProvider>`);

  const updatedContents = sourceFile.getFullText();

  if (updatedContents === originalContents) {
    return { status: 'skipped', file: candidateRelativePath };
  }

  const diff = createTwoFilesPatch(
    candidateRelativePath,
    candidateRelativePath,
    originalContents,
    updatedContents,
    '',
    ''
  );

  if (dryRun) {
    return { status: 'preview', file: candidateRelativePath, diff };
  }

  await fs.writeFile(candidateAbsolutePath, updatedContents, 'utf8');
  return { status: 'injected', file: candidateRelativePath, diff };
}

function usesI18nProvider(sourceFile: SourceFile) {
  return (
    sourceFile
      .getDescendantsOfKind(SyntaxKind.JsxOpeningElement)
      .some((element: JsxOpeningElement) => getTagName(element) === 'I18nProvider') ||
    sourceFile
      .getDescendantsOfKind(SyntaxKind.JsxSelfClosingElement)
      .some((element: JsxSelfClosingElement) => getTagName(element) === 'I18nProvider')
  );
}

function getTagName(element: JsxOpeningElement | JsxSelfClosingElement) {
  return element.getTagNameNode().getText();
}

function findChildrenExpressions(sourceFile: SourceFile) {
  return sourceFile
    .getDescendantsOfKind(SyntaxKind.JsxExpression)
    .filter((expression: JsxExpression) => {
      const inner = expression.getExpression();
      return inner && Node.isIdentifier(inner) && inner.getText() === 'children';
    });
}

function ensureProviderImport(sourceFile: SourceFile, moduleSpecifier: string) {
  const providerIdentifier = 'I18nProvider';
  const existing = sourceFile.getImportDeclaration((declaration: ImportDeclaration) => {
    const spec = declaration.getModuleSpecifierSourceFile();
    if (spec && spec.getFilePath() === moduleSpecifier) {
      return true;
    }
    return declaration.getModuleSpecifierValue() === moduleSpecifier;
  });

  if (existing) {
    const hasNamed = existing
      .getNamedImports()
      .some((namedImport: ImportSpecifier) => namedImport.getName() === providerIdentifier);
    if (!hasNamed) {
      existing.addNamedImport(providerIdentifier);
    }
    return;
  }

  const statements = sourceFile.getStatements();
  let insertIndex = 0;
  for (const statement of statements) {
    if (Node.isExpressionStatement(statement)) {
      const expression = statement.getExpression();
      if (Node.isStringLiteral(expression)) {
        const literal = expression.getLiteralText();
        if (literal.startsWith('use ')) {
          insertIndex += 1;
          continue;
        }
      }
    }
    break;
  }

  sourceFile.insertImportDeclaration(insertIndex, {
    moduleSpecifier,
    namedImports: [{ name: providerIdentifier }],
  });
}

async function fileExists(target: string) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

function toRelativeImport(fromDir: string, targetAbsolute: string) {
  let relative = path.relative(fromDir, targetAbsolute).replace(/\\/g, '/');
  if (!relative.startsWith('.')) {
    relative = `./${relative}`;
  }
  return relative.replace(/\.(ts|tsx|js|jsx)$/i, '');
}
