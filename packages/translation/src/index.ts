export interface Translator {
	/**
	 * The human-readable name of the translator.
	 */
	name: string;
	/**
	 * Perform a batch translation.
	 */
	translate(texts: string[], sourceLanguage: string, targetLanguage: string): Promise<string[]>;
	/**
	 * Optional cost estimation hook.
	 */
	estimateCost?(characterCount: number, options?: { localeCount?: number }): Promise<string | number> | string | number;
	/**
	 * Optional cleanup hook invoked when the CLI exits.
	 */
	dispose?(): Promise<void> | void;
}

export interface TranslatorFactoryOptions {
	provider: string;
	apiKey?: string;
	secret?: string;
	concurrency?: number;
	batchSize?: number;
	config?: Record<string, unknown>;
}

export interface TranslatorLoadOptions extends TranslatorFactoryOptions {
	module?: string;
}

export interface TranslatorModule {
	createTranslator?: (options: TranslatorFactoryOptions) => Translator | Promise<Translator>;
	translator?: Translator;
	default?: unknown;
}

export class TranslatorLoadError extends Error {
	constructor(message: string, public readonly cause?: unknown) {
		super(message);
		this.name = 'TranslatorLoadError';
	}
}

export const buildTranslatorModuleSpecifier = (provider: string): string => {
	if (!provider || provider === '.') {
		throw new TranslatorLoadError('Translator provider name is required.');
	}

	if (provider.startsWith('.') || provider.startsWith('/') || provider.includes('/')) {
		return provider;
	}

	return `@i18nsmith/translator-${provider}`;
};

export async function loadTranslator(options: TranslatorLoadOptions): Promise<Translator> {
	const specifier = options.module && options.module.trim().length
		? options.module
		: buildTranslatorModuleSpecifier(options.provider);

	let mod: TranslatorModule;
	try {
		mod = (await import(specifier)) as TranslatorModule;
	} catch (error) {
		const cause = error instanceof Error ? error : undefined;
		const isBuiltIn = specifier === '@i18nsmith/translator-mock';
		const hint = isBuiltIn
			? 'The mock translator should be bundled with @i18nsmith/cli. If you installed the CLI globally, try: pnpm add @i18nsmith/translator-mock'
			: `Install the adapter: pnpm add ${specifier}`;
		throw new TranslatorLoadError(
			`Unable to load translator module "${specifier}". ${hint}`,
			cause
		);
	}

	const translator = await resolveTranslatorInstance(mod, options);
	if (!translator || typeof translator.translate !== 'function') {
		throw new TranslatorLoadError(`Translator module "${specifier}" did not export a valid translator.`);
	}

	return translator;
}

async function resolveTranslatorInstance(
	moduleExports: TranslatorModule,
	options: TranslatorFactoryOptions
): Promise<Translator | undefined> {
	if (typeof moduleExports.createTranslator === 'function') {
		return moduleExports.createTranslator(options);
	}

	const direct = moduleExports.translator ?? moduleExports.default;
	if (direct && typeof (direct as Translator).translate === 'function') {
		return direct as Translator;
	}

	return undefined;
}
