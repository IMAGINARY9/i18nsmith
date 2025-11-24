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

export function ensureUseTranslationImport(sourceFile: SourceFile, adapter: TranslationImportConfig) {
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
