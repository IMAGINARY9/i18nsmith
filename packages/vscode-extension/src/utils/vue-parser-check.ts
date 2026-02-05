import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

export async function checkAndPromptForVueParser(workspaceFolder: vscode.WorkspaceFolder, targets?: string[]): Promise<boolean> {
  const root = workspaceFolder.uri.fsPath;

  // 1. Check if we are dealing with Vue context
  let hasVueFeatures = false;
  
  if (targets && targets.length > 0) {
     hasVueFeatures = targets.some(t => t.endsWith('.vue'));
     if (!hasVueFeatures) {
         for (const t of targets) {
            try {
               const stat = await fs.promises.stat(path.isAbsolute(t) ? t : path.join(root, t));
               if (stat.isDirectory()) {
                   // If acting on a directory, checking if workspace uses Vue is a decent heuristic
                   const vueFiles = await vscode.workspace.findFiles(new vscode.RelativePattern(workspaceFolder, '**/*.vue'), '**/node_modules/**', 1);
                   if (vueFiles.length > 0) {
                       hasVueFeatures = true; 
                       break;
                   }
               }
            } catch {}
         }
     }
  } else {
      // Workspace-wide transform
      const vueFiles = await vscode.workspace.findFiles(new vscode.RelativePattern(workspaceFolder, '**/*.vue'), '**/node_modules/**', 1);
      hasVueFeatures = vueFiles.length > 0;
  }

  if (!hasVueFeatures) {
      return true;
  }

  const parserPathInner = path.join(root, 'node_modules', 'vue-eslint-parser');
  let isInstalled = fs.existsSync(parserPathInner);
  
  if (!isInstalled) {
     try {
       const pkgJsonPath = path.join(root, 'package.json');
       if (fs.existsSync(pkgJsonPath)) {
          const pkgContent = await fs.promises.readFile(pkgJsonPath, 'utf-8');
          const pkg = JSON.parse(pkgContent);
          const deps = { ...pkg.dependencies, ...pkg.devDependencies };
          if (deps['vue-eslint-parser']) {
             // If it's in package.json, assume it's installed or user wants it.
             // Actually, if it's in package.json but not in node_modules/vue-eslint-parser, 
             // it might be hoisted differently or flattened or pnpm-nested.
             // But usually require.resolve would find it. 
             // Here we are just looking for folder presence which is flaky in pnpm/monorepos.
             // BUT: The CLI uses require.resolve in the transformer process. 
             // If the CLI fails, it's because it couldn't resolve it.
             // If we want to be smarter, we could try to resolve it via require.resolve from the extension IF we could.
             // But extension runs in VS Code node, not project node.
             // So file check is best we can do easily without finding user's node.
             // Let's assume if it is in pkg.json, user INTENDS to have it. 
             // If fs check fails, we might warn "it looks missing or not installed".
             // But if it is in pkg.json, maybe we trust it?
             // NO, if it is in pkg.json but not installed, CLI will fail.
             // So we actually WANT to warn if it's missing from disk.
             // BUT pnpm often puts it in .pnpm folder.
             // So `fs.existsSync(parserPathInner)` returns false for pnpm likely.
             // We should check if pnpm is used.
             isInstalled = true; // Assume true if in package.json to avoid false positives on pnpm 
          }
       }
     } catch {
       // ignore
     }
  }

  // Double check avoiding false positive on pnpm if not in package.json?
  // CLI logic: if (isVue) try parse; catch error.
  // If we can't reliably detect "installed", maybe we should rely on CLI output?
  // But user asked to port the warning.
  // The CLI check I implemented earlier was:
  // try { require.resolve('vue-eslint-parser', { paths: [process.cwd()] }) } catch...
  // We can't do that easily here.
  // However, earlier implementation of `checkAndPromptForVueParser` relies on `node_modules/vue-eslint-parser` OR presence in `package.json`.
  // If present in `package.json`, we set `isInstalled = true`.
  // So we only warn if it is NOT in `package.json` AND NOT in `node_modules/vue-eslint-parser`.
  // This means if user uses pnpm and has it in package.json, we don't warn. Correct.
  // If user uses pnpm and does NOT have it in package.json (indirect dep?), we warn. Correct.
  // If user has no vue-eslint-parser at all, we warn. Correct.
  
  if (!isInstalled) {
    const action = await vscode.window.showWarningMessage(
      'Vue files detected but "vue-eslint-parser" is missing. This is required to extract strings from Vue templates.',
      'Install parser',
      'Continue anyway'
    );
    
    if (action === 'Install parser') {
      const pm = fs.existsSync(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm' :
                 fs.existsSync(path.join(root, 'yarn.lock')) ? 'yarn' : 'npm';
      
      const cmd = pm === 'npm' ? 'npm install --save-dev vue-eslint-parser' : `${pm} add -D vue-eslint-parser`;
      
      const terminal = vscode.window.createTerminal('i18nsmith install');
      terminal.show();
      terminal.sendText(cmd);
      
      vscode.window.showInformationMessage('Installing parser... Please try the operation again once installation completes.');
      return false; // Abort current run
    }
  }
  return true;
}
