import * as path from 'path';
import {
  loadConfigWithMeta,
  Syncer,
  type SyncSummary,
  type SyncSelection,
} from '@i18nsmith/core';

interface SyncRunOptions {
  write?: boolean;
  prune?: boolean;
  diff?: boolean;
  selection?: SyncSelection;
  targets?: string[];
  invalidateCache?: boolean;
}

interface SyncRunResult {
  summary: SyncSummary;
  projectRoot: string;
}

export class SyncIntegration {
  async run(workspaceRoot: string, options: SyncRunOptions = {}): Promise<SyncRunResult> {
    const { config, projectRoot } = await loadConfigWithMeta(undefined, { cwd: workspaceRoot });
    const syncer = new Syncer(config, { workspaceRoot: projectRoot });

    const summary = await syncer.run({
      write: options.write ?? false,
      prune: options.prune ?? false,
      diff: options.diff ?? !options.write,
      selection: options.selection,
      targets: this.normalizeTargets(options.targets, projectRoot),
      invalidateCache: options.invalidateCache ?? false,
    });

    return { summary, projectRoot };
  }

  private normalizeTargets(targets: string[] | undefined, projectRoot: string): string[] | undefined {
    if (!targets?.length) {
      return undefined;
    }

    return targets
      .map((target) => target?.trim())
      .filter((target): target is string => Boolean(target))
      .map((target) => (path.isAbsolute(target) ? path.relative(projectRoot, target) : target));
  }
}
