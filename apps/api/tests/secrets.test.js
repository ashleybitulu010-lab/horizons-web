import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcRoot = path.join(__dirname, '..', 'src');

const FORBIDDEN_PATTERNS = [
	/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
	/SUPABASE_SERVICE_ROLE_KEY\s*=\s*['"][^'"]{20,}['"]/,
];

async function walk(dir) {
	const entries = await readdir(dir, { withFileTypes: true });
	const files = [];

	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			files.push(...await walk(fullPath));
		} else if (entry.isFile() && entry.name.endsWith('.js')) {
			files.push(fullPath);
		}
	}

	return files;
}

test('source files do not embed Supabase service role secrets', async () => {
	const files = await walk(srcRoot);

	for (const file of files) {
		const content = await readFile(file, 'utf8');
		for (const pattern of FORBIDDEN_PATTERNS) {
			assert.ok(
				!pattern.test(content),
				`Forbidden secret pattern in ${path.relative(srcRoot, file)}`,
			);
		}
	}
});
