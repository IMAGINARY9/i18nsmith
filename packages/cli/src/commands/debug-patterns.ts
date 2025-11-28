import path from 'path';
import chalk from 'chalk';
import { Command } from 'commander';
import fg from 'fast-glob';
import { loadConfigWithMeta } from '@i18nsmith/core';

interface DebugPatternsOptions {
  config?: string;
  json?: boolean;
  verbose?: boolean;
}

interface PatternMatch {
  pattern: string;
  type: 'include' | 'exclude';
  matchedFiles: string[];
  matchCount: number;
}

interface DebugPatternsSummary {
  projectRoot: string;
  includePatterns: PatternMatch[];
  excludePatterns: PatternMatch[];
  totalIncluded: number;
  totalExcluded: number;
  effectiveFiles: string[];
  unmatchedSuggestions: string[];
}

export function registerDebugPatterns(program: Command) {
  program
    .command('debug-patterns')
    .description('Debug include/exclude glob patterns to understand file matching')
    .option('-c, --config <path>', 'Path to i18nsmith config file', 'i18n.config.json')
    .option('--json', 'Print raw JSON results', false)
    .option('--verbose', 'Show all matched files for each pattern', false)
    .action(async (options: DebugPatternsOptions) => {
      try {
        const { config, projectRoot, configPath } = await loadConfigWithMeta(options.config);
        
        console.log(chalk.blue('Debugging glob patterns...'));
        console.log(chalk.gray(`Config: ${path.relative(process.cwd(), configPath)}`));
        console.log(chalk.gray(`Project root: ${projectRoot}\n`));

        const includePatterns = config.include ?? ['**/*.tsx', '**/*.ts', '**/*.jsx', '**/*.js'];
        const excludePatterns = config.exclude ?? ['**/node_modules/**', '**/dist/**', '**/*.test.*', '**/*.spec.*'];

        const summary = await analyzePatterns(projectRoot, includePatterns, excludePatterns, options.verbose);

        if (options.json) {
          console.log(JSON.stringify(summary, null, 2));
          return;
        }

        printPatternAnalysis(summary, options.verbose);
      } catch (error) {
        console.error(chalk.red('Pattern debug failed:'), (error as Error).message);
        process.exitCode = 1;
      }
    });
}

async function analyzePatterns(
  projectRoot: string,
  includePatterns: string[],
  excludePatterns: string[],
  verbose?: boolean
): Promise<DebugPatternsSummary> {
  const includeMatches: PatternMatch[] = [];
  const excludeMatches: PatternMatch[] = [];

  // Analyze each include pattern individually
  for (const pattern of includePatterns) {
    const files = await fg(pattern, {
      cwd: projectRoot,
      ignore: ['**/node_modules/**'],
      onlyFiles: true,
      absolute: false,
    });
    includeMatches.push({
      pattern,
      type: 'include',
      matchedFiles: files.sort(),
      matchCount: files.length,
    });
  }

  // Analyze each exclude pattern individually
  for (const pattern of excludePatterns) {
    const files = await fg(pattern, {
      cwd: projectRoot,
      onlyFiles: true,
      absolute: false,
    });
    excludeMatches.push({
      pattern,
      type: 'exclude',
      matchedFiles: files.sort(),
      matchCount: files.length,
    });
  }

  // Calculate effective files (include - exclude)
  const allIncluded = new Set<string>();
  for (const match of includeMatches) {
    for (const file of match.matchedFiles) {
      allIncluded.add(file);
    }
  }

  const allExcluded = new Set<string>();
  for (const match of excludeMatches) {
    for (const file of match.matchedFiles) {
      allExcluded.add(file);
    }
  }

  const effectiveFiles = Array.from(allIncluded)
    .filter(file => !allExcluded.has(file))
    .sort();

  // Generate suggestions for unmatched patterns
  const suggestions = generateSuggestions(includeMatches, excludeMatches, projectRoot);

  return {
    projectRoot,
    includePatterns: includeMatches,
    excludePatterns: excludeMatches,
    totalIncluded: allIncluded.size,
    totalExcluded: allExcluded.size,
    effectiveFiles,
    unmatchedSuggestions: suggestions,
  };
}

function generateSuggestions(
  includeMatches: PatternMatch[],
  excludeMatches: PatternMatch[],
  projectRoot: string
): string[] {
  const suggestions: string[] = [];

  // Check for patterns with no matches
  for (const match of includeMatches) {
    if (match.matchCount === 0) {
      const suggestion = suggestPatternFix(match.pattern, projectRoot);
      if (suggestion) {
        suggestions.push(`Include pattern "${match.pattern}" matched 0 files. ${suggestion}`);
      } else {
        suggestions.push(`Include pattern "${match.pattern}" matched 0 files. Check if files exist or adjust the pattern.`);
      }
    }
  }

  // Check if excludes are too broad
  const totalIncluded = includeMatches.reduce((sum, m) => sum + m.matchCount, 0);
  const totalExcluded = excludeMatches.reduce((sum, m) => sum + m.matchCount, 0);
  
  if (totalExcluded > totalIncluded * 0.9 && totalIncluded > 0) {
    suggestions.push('Warning: Exclude patterns are filtering out most files. Consider narrowing exclusions.');
  }

  // Check for common pattern mistakes
  for (const match of includeMatches) {
    if (match.pattern.startsWith('/')) {
      suggestions.push(`Pattern "${match.pattern}" starts with "/" which may not match relative paths. Try "${match.pattern.slice(1)}".`);
    }
    if (match.pattern.includes('\\')) {
      suggestions.push(`Pattern "${match.pattern}" contains backslashes. Use forward slashes "/" for glob patterns.`);
    }
  }

  return suggestions;
}

function suggestPatternFix(pattern: string, projectRoot: string): string | null {
  // Common fixes for patterns that don't match
  
  // If pattern is like "src/**/*.tsx" but files are in "app/**/*.tsx"
  if (pattern.startsWith('src/')) {
    return 'Try "app/**/*" or check your source directory structure.';
  }
  
  // If pattern uses .tsx but project has .jsx
  if (pattern.includes('.tsx')) {
    return 'Try replacing ".tsx" with ".jsx" if using JavaScript.';
  }
  
  // If pattern uses double asterisk incorrectly
  if (pattern.includes('/**') && !pattern.includes('/**/')) {
    return 'Use "**/" for recursive matching (e.g., "src/**/*.tsx").';
  }

  return null;
}

function printPatternAnalysis(summary: DebugPatternsSummary, verbose?: boolean) {
  console.log(chalk.blue('📁 Include Patterns\n'));
  
  for (const match of summary.includePatterns) {
    const status = match.matchCount > 0 ? chalk.green('✓') : chalk.red('✗');
    console.log(`  ${status} ${chalk.cyan(match.pattern)} → ${match.matchCount} file(s)`);
    
    if (verbose && match.matchCount > 0) {
      const preview = match.matchedFiles.slice(0, 10);
      preview.forEach(file => console.log(chalk.gray(`      • ${file}`)));
      if (match.matchedFiles.length > 10) {
        console.log(chalk.gray(`      ... and ${match.matchedFiles.length - 10} more`));
      }
    }
  }

  console.log(chalk.blue('\n🚫 Exclude Patterns\n'));
  
  for (const match of summary.excludePatterns) {
    const status = match.matchCount > 0 ? chalk.yellow('⚠') : chalk.gray('○');
    console.log(`  ${status} ${chalk.cyan(match.pattern)} → ${match.matchCount} file(s)`);
    
    if (verbose && match.matchCount > 0) {
      const preview = match.matchedFiles.slice(0, 5);
      preview.forEach(file => console.log(chalk.gray(`      • ${file}`)));
      if (match.matchedFiles.length > 5) {
        console.log(chalk.gray(`      ... and ${match.matchedFiles.length - 5} more`));
      }
    }
  }

  console.log(chalk.blue('\n📊 Summary\n'));
  console.log(`  Total matched by include patterns: ${summary.totalIncluded}`);
  console.log(`  Total matched by exclude patterns: ${summary.totalExcluded}`);
  console.log(chalk.green(`  Effective files to scan: ${summary.effectiveFiles.length}`));

  if (verbose && summary.effectiveFiles.length > 0) {
    console.log(chalk.blue('\n📄 Effective Files (first 20)\n'));
    summary.effectiveFiles.slice(0, 20).forEach(file => {
      console.log(chalk.gray(`  • ${file}`));
    });
    if (summary.effectiveFiles.length > 20) {
      console.log(chalk.gray(`  ... and ${summary.effectiveFiles.length - 20} more`));
    }
  }

  if (summary.unmatchedSuggestions.length > 0) {
    console.log(chalk.yellow('\n💡 Suggestions\n'));
    summary.unmatchedSuggestions.forEach(suggestion => {
      console.log(chalk.yellow(`  • ${suggestion}`));
    });
  }

  if (summary.effectiveFiles.length === 0) {
    console.log(chalk.red('\n⚠️  No files will be scanned! Check your patterns.'));
    console.log(chalk.gray('  Common issues:'));
    console.log(chalk.gray('  • Include patterns don\'t match your source directory'));
    console.log(chalk.gray('  • Exclude patterns are too broad'));
    console.log(chalk.gray('  • File extensions don\'t match (.tsx vs .jsx, .ts vs .js)'));
  }
}
