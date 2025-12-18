import chalk from 'chalk';

export class CliError extends Error {
  constructor(message: string, public exitCode = 1) {
    super(message);
    this.name = 'CliError';
  }
}

type MaybePromise<T> = T | Promise<T>;

export function withErrorHandling<A extends unknown[], R>(
  action: (...args: A) => MaybePromise<R>
): (...args: A) => Promise<R | undefined> {
  return async (...args: A): Promise<R | undefined> => {
    try {
      return (await action(...args)) as R;
    } catch (error) {
      if (error instanceof CliError) {
        console.error(chalk.red(error.message));
        process.exitCode = error.exitCode;
        return undefined;
      }

      const message = error instanceof Error ? error.message : String(error);
      console.error(chalk.red(`Unexpected error: ${message}`));
      if (error instanceof Error && error.stack) {
        console.error(chalk.gray(error.stack));
      }
      process.exitCode = 1;
      return undefined;
    }
  };
}
