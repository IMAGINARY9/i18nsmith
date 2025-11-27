export type LocalePersistenceFormat = 'flat' | 'nested';

const DEFAULT_DELIMITER = '.';

export function flattenLocaleTree(
	input: unknown,
	delimiter: string = DEFAULT_DELIMITER
): Record<string, string> {
	if (!isPlainRecord(input)) {
		return {};
	}

	const result: Record<string, string> = {};

	const visit = (node: unknown, currentKey: string) => {
		if (Array.isArray(node)) {
			throw new Error('Locale values cannot be arrays');
		}

		if (node === null || typeof node === 'undefined') {
			result[currentKey] = '';
			return;
		}

		if (typeof node === 'object') {
			const entries = Object.entries(node as Record<string, unknown>);
			if (!entries.length) {
				return;
			}

			for (const [childKey, value] of entries) {
				const nextKey = currentKey ? `${currentKey}${delimiter}${childKey}` : childKey;
				visit(value, nextKey);
			}
			return;
		}

		result[currentKey] = String(node);
	};

	for (const [key, value] of Object.entries(input)) {
		visit(value, key);
	}

	return result;
}

export function expandLocaleTree(
	flat: Record<string, string>,
	delimiter: string = DEFAULT_DELIMITER
): Record<string, unknown> {
	const root: Record<string, unknown> = {};

	for (const key of Object.keys(flat)) {
		const segments = key.split(delimiter).filter((segment) => segment.length > 0);
		if (!segments.length) {
			continue;
		}

		let node: Record<string, unknown> = root;
		segments.forEach((segment, index) => {
			if (index === segments.length - 1) {
				node[segment] = flat[key];
				return;
			}

			if (!isPlainRecord(node[segment])) {
				node[segment] = {};
			}

			node = node[segment] as Record<string, unknown>;
		});
	}

	return sortNestedObject(root);
}

export function detectLocaleFormat(input: unknown): LocalePersistenceFormat {
	if (!isPlainRecord(input)) {
		return 'flat';
	}

	const values = Object.values(input);
	return values.some((value) => isPlainRecord(value) || Array.isArray(value)) ? 'nested' : 'flat';
}

export function sortNestedObject(input: Record<string, unknown>): Record<string, unknown> {
	const sortedKeys = Object.keys(input).sort((a, b) => a.localeCompare(b));
	return sortedKeys.reduce<Record<string, unknown>>((acc, key) => {
		const value = input[key];
		if (isPlainRecord(value)) {
			acc[key] = sortNestedObject(value as Record<string, unknown>);
			return acc;
		}

		acc[key] = value;
		return acc;
	}, {});
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}