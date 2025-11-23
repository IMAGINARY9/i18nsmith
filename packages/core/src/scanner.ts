import { Project } from 'ts-morph';
import { I18nConfig } from './config';

export class Scanner {
  private project: Project;
  private config: I18nConfig;

  constructor(config: I18nConfig) {
    this.config = config;
    this.project = new Project({
      // We might want to make this configurable or optional in the future
      skipAddingFilesFromTsConfig: true,
    });
  }

  public async scan() {
    console.log('Scanning files...');
    const files = this.project.addSourceFilesAtPaths(this.config.include);
    console.log(`Found ${files.length} files.`);
    
    // Placeholder for AST traversal
    for (const file of files) {
        // Visitor pattern implementation will go here
        // We will look for StringLiterals and TemplateExpressions
    }
    
    return files;
  }
}
