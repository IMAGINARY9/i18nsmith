import {
  ArrowFunction,
  FunctionDeclaration,
  FunctionExpression,
  ImportDeclarationStructure,
  MethodDeclaration,
  Node,
  SourceFile,
  Statement,
  SyntaxKind,
} from 'ts-morph';

export type FunctionLike =
  | FunctionDeclaration
  | FunctionExpression
  | ArrowFunction
  | MethodDeclaration;

export interface TranslationImportConfig {
  moduleSpecifier: string;
  namedImport: string;
}

export interface DetectedImport {
  moduleSpecifier: string;
  namedImport: string;
  isDefault: boolean;
}

/**
 * Common translation hook names and their typical module sources.
 * Used to detect existing translation setups in the file.
 */
const KNOWN_TRANSLATION_HOOKS = [
  'useTranslation',
  'useTranslations',
  'useT',
  't',
];

const KNOWN_TRANSLATION_MODULES = [
  'react-i18next',
  'next-intl',
  'vue-i18n',
  '@lingui/react',
  'i18next',
];

/**
 * Detects existing translation imports in a source file.
 * Returns the first match found, prioritizing known modules.
 */
export function detectExistingTranslationImport(sourceFile: SourceFile): DetectedImport | null {
  const importDeclarations = sourceFile.getImportDeclarations();

  for (const importDecl of importDeclarations) {
    const moduleSpecifier = importDecl.getModuleSpecifierValue();

    // Check named imports for known translation hooks
    for (const namedImport of importDecl.getNamedImports()) {
      const name = namedImport.getName();
      if (KNOWN_TRANSLATION_HOOKS.includes(name)) {
        return {
          moduleSpecifier,
          namedImport: name,
          isDefault: false,
        };
      }
    }

    // Check if it's a known translation module with default import
    if (KNOWN_TRANSLATION_MODULES.some((mod) => moduleSpecifier.includes(mod))) {
      const defaultImport = importDecl.getDefaultImport();
      if (defaultImport) {
        return {
          moduleSpecifier,
          namedImport: defaultImport.getText(),
          isDefault: true,
        };
      }
    }
  }

  // Also check for relative imports that might be custom translation contexts
  for (const importDecl of importDeclarations) {
    const moduleSpecifier = importDecl.getModuleSpecifierValue();

    // Skip node_modules imports
    if (!moduleSpecifier.startsWith('.') && !moduleSpecifier.startsWith('@/')) {
      continue;
    }

    // Look for translation-related path names
    const isTranslationPath =
      moduleSpecifier.toLowerCase().includes('translation') ||
      moduleSpecifier.toLowerCase().includes('i18n') ||
      moduleSpecifier.toLowerCase().includes('locale') ||
      moduleSpecifier.toLowerCase().includes('intl');

    if (isTranslationPath) {
      for (const namedImport of importDecl.getNamedImports()) {
        const name = namedImport.getName();
        if (KNOWN_TRANSLATION_HOOKS.includes(name)) {
          return {
            moduleSpecifier,
            namedImport: name,
            isDefault: false,
          };
        }
      }
    }
  }

  return null;
}

export function ensureUseTranslationImport(sourceFile: SourceFile, adapter: TranslationImportConfig) {
  // First check if there's already a translation import we should reuse
  const existingTranslationImport = detectExistingTranslationImport(sourceFile);
  
  // If there's already an import for the same hook, don't add another
  if (existingTranslationImport && existingTranslationImport.namedImport === adapter.namedImport) {
    return;
  }

  const existing = sourceFile.getImportDeclaration(
    (decl) => decl.getModuleSpecifierValue() === adapter.moduleSpecifier
  );
  const insertIndex = countDirectiveStatements(sourceFile.getStatements());

  if (!existing) {
    sourceFile.insertImportDeclaration(insertIndex, {
      moduleSpecifier: adapter.moduleSpecifier,
      namedImports: [{ name: adapter.namedImport }],
    });
    return;
  }

  const hasNamed = existing
    .getNamedImports()
    .some((namedImport) => namedImport.getName() === adapter.namedImport);

  if (!hasNamed) {
    existing.addNamedImport({ name: adapter.namedImport });
  }

  if (existing.getChildIndex() < insertIndex) {
    const structure: ImportDeclarationStructure = existing.getStructure();
    existing.remove();
    sourceFile.insertImportDeclaration(insertIndex, structure);
  }
}

export function ensureUseTranslationBinding(fn: FunctionLike, hookName: string) {
  const body = fn.getBody();
  if (!body) {
    return;
  }

  if (!Node.isBlock(body)) {
    return;
  }

  const existing = body.getStatements().some((statement) => {
    return statement.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
      return call.getExpression().getText() === hookName;
    });
  });

  if (existing) {
    return;
  }

  body.insertStatements(0, `const { t } = ${hookName}();`);
}

export function ensureClientDirective(sourceFile: SourceFile) {
  const statements = sourceFile.getStatements();
  const hasClientDirective = statements.some((statement) => {
    if (isDirectiveStatement(statement)) {
      const text = statement.getText();
      return text.includes('use client');
    }
    return false;
  });

  if (!hasClientDirective) {
    sourceFile.insertStatements(0, "'use client';");
  }
}

export function findNearestFunctionScope(node: Node): FunctionLike | undefined {
  return node.getFirstAncestor((ancestor) =>
    Node.isFunctionDeclaration(ancestor) ||
    Node.isMethodDeclaration(ancestor) ||
    Node.isFunctionExpression(ancestor) ||
    Node.isArrowFunction(ancestor)
  ) as FunctionLike | undefined;
}

function isDirectiveStatement(statement: Statement): boolean {
  if (!Node.isExpressionStatement(statement)) {
    return false;
  }

  const expression = statement.getExpression();
  return (
    Node.isStringLiteral(expression) ||
    Node.isNoSubstitutionTemplateLiteral(expression)
  );
}

function countDirectiveStatements(statements: Statement[]): number {
  let count = 0;
  for (const statement of statements) {
    if (isDirectiveStatement(statement)) {
      count += 1;
      continue;
    }
    break;
  }
  return count;
}
