import path from "path";
import {
  Node,
  Project,
  JsxAttribute,
  JsxExpression,
  JsxText,
  SourceFile,
  SyntaxKind,
} from "ts-morph";
import fg from "fast-glob";
import { DEFAULT_EXCLUDE, DEFAULT_INCLUDE, I18nConfig } from "./config.js";
import { createScannerProject } from "./project-factory.js";
import { TypescriptParser } from "./parsers/TypescriptParser.js";
import type { FileParser } from "./parsers/FileParser.js";

export type CandidateKind =
  | "jsx-text"
  | "jsx-attribute"
  | "jsx-expression"
  | "call-expression";

export type SkipReason =
  | "non_literal"
  | "empty"
  | "below_min_length"
  | "denied_pattern"
  | "no_letters"
  | "insufficient_letters"
  | "non_sentence"
  | "directive_skip";

export interface SkippedCandidate {
  text?: string;
  reason: SkipReason;
  location?: {
    filePath: string;
    line: number;
    column: number;
  };
}

export interface ScanBuckets {
  highConfidence: ScanCandidate[];
  needsReview: ScanCandidate[];
  skipped: SkippedCandidate[];
}

export interface ScanCandidate {
  id: string;
  filePath: string;
  kind: CandidateKind;
  text: string;
  context?: string;
  forced?: boolean;
  /**
   * Optional fields populated by downstream tooling (e.g., transformer)
   * to keep key suggestions close to the source candidate.
   */
  suggestedKey?: string;
  hash?: string;
  position: {
    line: number;
    column: number;
  };
}

export interface ScanSummary {
  filesScanned: number;
  filesExamined: string[];
  candidates: ScanCandidate[];
  buckets: ScanBuckets;
}

type GlobPatterns = {
  include: string[];
  exclude: string[];
};

export interface ScannerNodeCandidate extends ScanCandidate {
  node: Node;
  sourceFile: SourceFile;
}

export interface DetailedScanSummary extends ScanSummary {
  detailedCandidates: ScannerNodeCandidate[];
}

export interface ScannerOptions {
  workspaceRoot?: string;
  project?: Project;
}

export interface ScanExecutionOptions {
  collectNodes?: boolean;
  targets?: string[];
  scanCalls?: boolean;
}

type CandidateRecorder = (
  candidate: ScanCandidate,
  node: Node,
  file: SourceFile
) => void;

export const DEFAULT_TRANSLATABLE_ATTRIBUTES = new Set([
  "alt",
  "aria-label",
  "aria-placeholder",
  "helperText",
  "label",
  "placeholder",
  "title",
  "tooltip",
  "value",
]);

const LETTER_REGEX_GLOBAL = /\p{L}/gu;
const MAX_DIRECTIVE_COMMENT_DEPTH = 4;
const HTML_ENTITY_PATTERN = /^&[a-z][a-z0-9-]*;$/i;
const REPEATED_SYMBOL_PATTERN = /^([^\p{L}\d\s])\1{1,}$/u;

export class Scanner {
  private project: Project;
  private config: I18nConfig;
  private workspaceRoot: string;
  private parsers: FileParser[];
  private readonly usesExternalProject: boolean;

  constructor(config: I18nConfig, options: ScannerOptions = {}) {
    this.config = config;
    this.workspaceRoot = options.workspaceRoot ?? process.cwd();
    this.project = options.project ?? this.createProject();
    this.usesExternalProject = Boolean(options.project);
    this.parsers = [
      new TypescriptParser(config, this.workspaceRoot),
    ];
  }

  public scan(): ScanSummary;
  public scan(
    options: ScanExecutionOptions & { collectNodes: true }
  ): DetailedScanSummary;
  public scan(options: ScanExecutionOptions): ScanSummary;
  public scan(
    options?: ScanExecutionOptions
  ): ScanSummary | DetailedScanSummary {
    const collectNodes = options?.collectNodes ?? false;
    const patterns = this.getGlobPatterns();
    const targetFiles = options?.targets?.length
      ? this.resolveTargetFiles(options.targets)
      : undefined;
    const filesExamined: string[] = [];
    let filesScanned = 0;

    const candidates: ScanCandidate[] = [];
    const detailedCandidates: ScannerNodeCandidate[] = [];
    const buckets: ScanBuckets = {
      highConfidence: [],
      needsReview: [],
      skipped: [],
    };

    const filePaths = targetFiles?.length
      ? targetFiles
      : this.resolveAllFiles(patterns);

    for (const filePath of filePaths) {
      const parser = this.parsers.find(p => p.canHandle(filePath));
      if (!parser) {
        continue; // Skip files that no parser can handle
      }

      try {
        const fileCandidates = parser.parse(filePath, '', this.project); // Pass the project for ts-morph based parsing
        candidates.push(...fileCandidates);
        filesExamined.push(this.getRelativePath(filePath));
        filesScanned += 1;

        // Apply confidence bucketing
        for (const candidate of fileCandidates) {
          const bucket = this.getConfidenceBucket(candidate);
          if (bucket === "high") {
            buckets.highConfidence.push(candidate);
          } else {
            buckets.needsReview.push(candidate);
          }
        }
      } catch (error) {
        console.warn(`Failed to parse ${filePath}: ${error}`);
      }
    }

    const summary: ScanSummary = {
      filesScanned,
      filesExamined,
      candidates,
      buckets,
    };

    if (filesScanned === 0) {
      console.warn(
        '⚠️  Scanner found 0 files. Check your "include" patterns in i18n.config.json.'
      );
      const includeList = patterns.include.length
        ? patterns.include.join(", ")
        : "(none)";
      const excludeList = patterns.exclude.length
        ? patterns.exclude.join(", ")
        : "(none)";
      console.warn(`   Include patterns: ${includeList}`);
      console.warn(`   Exclude patterns: ${excludeList}`);
    }

    if (collectNodes) {
      return {
        ...summary,
        detailedCandidates,
      };
    }

    return summary;
  }

  private getConfidenceBucket(candidate: ScanCandidate): "high" | "review" {
    if (candidate.forced) {
      return "review";
    }

    const letters = candidate.text.match(LETTER_REGEX_GLOBAL) || [];
    const letterCount = letters.length;
    const totalLength = candidate.text.length || 1;
    const letterRatio = letterCount / totalLength;

    const minLetterCount = this.config.extraction?.minLetterCount ?? 2;
    const minLetterRatio = this.config.extraction?.minLetterRatio ?? 0.25;

    const elevatedCountThreshold = Math.max(
      minLetterCount * 2,
      minLetterCount + 3
    );
    const elevatedRatioThreshold = Math.min(0.85, minLetterRatio + 0.35);

    if (letterCount >= elevatedCountThreshold) {
      return "high";
    }

    if (
      letterRatio >= elevatedRatioThreshold &&
      letterCount >= minLetterCount
    ) {
      return "high";
    }

    if (letterCount >= minLetterCount + 2 && letterRatio >= minLetterRatio) {
      return "high";
    }

    return "review";
  }

  private getGlobPatterns(): GlobPatterns {
    const include =
      Array.isArray(this.config.include) && this.config.include.length
        ? this.config.include
        : DEFAULT_INCLUDE;
    const exclude = Array.isArray(this.config.exclude)
      ? this.config.exclude
      : DEFAULT_EXCLUDE;
    return { include, exclude };
  }

  private resolveWorkspaceFiles(patterns: GlobPatterns): string[] {
    const includePatterns = patterns.include.length
      ? patterns.include
      : DEFAULT_INCLUDE;
    const excludePatterns = patterns.exclude.length ? patterns.exclude : [];

    const matches = fg.sync(includePatterns, {
      cwd: this.workspaceRoot,
      ignore: excludePatterns,
      onlyFiles: true,
      unique: true,
      absolute: true,
      followSymbolicLinks: true,
    }) as string[];

    return matches.sort((a, b) => a.localeCompare(b));
  }

  private resolveAllFiles(patterns: GlobPatterns): string[] {
    // First, get files from disk
    const diskFiles = this.resolveWorkspaceFiles(patterns);

    // Then, get in-memory source files from the project that match the patterns
    const projectFiles = this.project.getSourceFiles()
      .map(sf => sf.getFilePath())
      .filter(filePath => {
        const relativePath = this.getRelativePath(filePath);
        const includePatterns = patterns.include.length ? patterns.include : DEFAULT_INCLUDE;
        const excludePatterns = patterns.exclude.length ? patterns.exclude : [];

        // Check if file matches include patterns
        const matchesInclude = includePatterns.some(pattern => {
          // Simple glob matching for in-memory files
          if (pattern.includes('*')) {
            const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\//g, '\\/'));
            return regex.test(relativePath);
          }
          return relativePath === pattern;
        });

        // Check if file matches exclude patterns
        const matchesExclude = excludePatterns.some(pattern => {
          if (pattern.includes('*')) {
            const regex = new RegExp(pattern.replace(/\*/g, '.*').replace(/\//g, '\\/'));
            return regex.test(relativePath);
          }
          return relativePath === pattern;
        });

        return matchesInclude && !matchesExclude;
      });

    // Combine and deduplicate
    const allFiles = [...diskFiles, ...projectFiles];
    return [...new Set(allFiles)].sort((a, b) => a.localeCompare(b));
  }

  private resolveTargetFiles(targets: string[]): string[] {
    const normalizedPatterns = targets
      .flatMap((entry) => entry.split(",").map((token) => token.trim()))
      .filter(Boolean)
      .map((pattern) =>
        path.isAbsolute(pattern)
          ? pattern
          : path.join(this.workspaceRoot, pattern)
      );

    // Important: targets are still subject to config exclude globs.
    // Otherwise, running transforms/syncs on explicit targets could mutate files the
    // user intentionally excluded (e.g., legal pages).
    const patterns = this.getGlobPatterns();
    const diskMatches = fg.sync(normalizedPatterns, {
      onlyFiles: true,
      unique: true,
      followSymbolicLinks: true,
      ignore: patterns.exclude ?? [],
    }) as string[];

    // Also check for in-memory source files in the project
    const projectMatches = this.project.getSourceFiles()
      .map(sf => sf.getFilePath())
      .filter(filePath => {
        // Check if this file path matches any of the targets
        return targets.some(target => {
          const normalizedTarget = path.isAbsolute(target)
            ? target
            : path.join(this.workspaceRoot, target);
          return filePath === normalizedTarget || filePath === target;
        });
      });

    // Combine and deduplicate
    const allMatches = [...diskMatches, ...projectMatches];
    return [...new Set(allMatches)].sort((a, b) => a.localeCompare(b));
  }

  private getRelativePath(filePath: string): string {
    const relative = path.relative(this.workspaceRoot, filePath);
    return relative || filePath;
  }

  private createProject(): Project {
    return createScannerProject();
  }
}
