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

export interface UseTranslationBindingOptions {
  allowAncestorScope?: boolean;
  allowExpressionBody?: boolean;
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
  return ensureUseTranslationBindingInternal(fn, hookName, {
    allowAncestorScope: true,
    allowExpressionBody: false,
  });
}

export function hasUseTranslationBinding(
  fn: FunctionLike,
  hookName: string,
  includeAncestors = false
): boolean {
  let current: FunctionLike | undefined = fn;

  while (current) {
    const body = current.getBody();
    if (body && Node.isBlock(body)) {
      const existing = body.getStatements().some((statement) => {
        return statement.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
          return call.getExpression().getText() === hookName;
        });
      });

      if (existing) {
        return true;
      }
    } else if (body) {
      const text = body.getText();
      if (text.includes(`${hookName}(`)) {
        return true;
      }
    }

    if (!includeAncestors) {
      return false;
    }

    const next = (current as Node).getFirstAncestor((ancestor) =>
      Node.isFunctionDeclaration(ancestor) ||
      Node.isMethodDeclaration(ancestor) ||
      Node.isFunctionExpression(ancestor) ||
      Node.isArrowFunction(ancestor)
    ) as FunctionLike | undefined;
    current = next;
  }

  return false;
}

export function ensureUseTranslationBindingWithOptions(
  fn: FunctionLike,
  hookName: string,
  options: UseTranslationBindingOptions = {}
): boolean {
  return ensureUseTranslationBindingInternal(fn, hookName, options);
}

export function isComponentLikeFunction(fn: FunctionLike): boolean {
  if (Node.isFunctionDeclaration(fn)) {
    const name = fn.getName();
    return Boolean(name && name[0] === name[0]?.toUpperCase());
  }

  if (Node.isArrowFunction(fn) || Node.isFunctionExpression(fn)) {
    const parent = fn.getParent();
    if (Node.isVariableDeclaration(parent)) {
      const name = parent.getName();
      return Boolean(name && name[0] === name[0]?.toUpperCase());
    }
    if (Node.isExportAssignment(parent)) {
      return true;
    }
  }

  return false;
}

function ensureUseTranslationBindingInternal(
  fn: FunctionLike,
  hookName: string,
  options: UseTranslationBindingOptions
): boolean {
  const body = fn.getBody();
  if (!body) {
    return false;
  }

  if (options.allowAncestorScope ?? true) {
    if (hasUseTranslationBinding(fn, hookName, true)) {
      return true;
    }
  }

  if (Node.isBlock(body)) {
    const existing = body.getStatements().some((statement) => {
      return statement.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
        return call.getExpression().getText() === hookName;
      });
    });

    if (existing) {
      return true;
    }

    body.insertStatements(0, `const { t } = ${hookName}();`);
    return true;
  }

  if (Node.isArrowFunction(fn) && (options.allowExpressionBody ?? false)) {
    const expressionText = body.getText();
    body.replaceWithText(`{ const { t } = ${hookName}(); return ${expressionText}; }`);
    return true;
  }

  return false;
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
