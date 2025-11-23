import {
  ArrowFunction,
  FunctionDeclaration,
  FunctionExpression,
  MethodDeclaration,
  Node,
  SourceFile,
  SyntaxKind,
} from 'ts-morph';

export type FunctionLike =
  | FunctionDeclaration
  | FunctionExpression
  | ArrowFunction
  | MethodDeclaration;

export function ensureUseTranslationImport(sourceFile: SourceFile) {
  const existing = sourceFile.getImportDeclaration((decl) => decl.getModuleSpecifierValue() === 'react-i18next');
  if (!existing) {
    sourceFile.insertImportDeclaration(0, {
      moduleSpecifier: 'react-i18next',
      namedImports: [{ name: 'useTranslation' }],
    });
    return;
  }

  const hasNamed = existing
    .getNamedImports()
    .some((namedImport) => namedImport.getName() === 'useTranslation');

  if (!hasNamed) {
    existing.addNamedImport({ name: 'useTranslation' });
  }
}

export function ensureUseTranslationBinding(fn: FunctionLike) {
  const body = fn.getBody();
  if (!body) {
    return;
  }

  if (!Node.isBlock(body)) {
    return;
  }

  const existing = body.getStatements().some((statement) => {
    return statement.getDescendantsOfKind(SyntaxKind.CallExpression).some((call) => {
      return call.getExpression().getText() === 'useTranslation';
    });
  });

  if (existing) {
    return;
  }

  body.insertStatements(0, "const { t } = useTranslation();");
}

export function findNearestFunctionScope(node: Node): FunctionLike | undefined {
  return node.getFirstAncestor((ancestor) =>
    Node.isFunctionDeclaration(ancestor) ||
    Node.isMethodDeclaration(ancestor) ||
    Node.isFunctionExpression(ancestor) ||
    Node.isArrowFunction(ancestor)
  ) as FunctionLike | undefined;
}
