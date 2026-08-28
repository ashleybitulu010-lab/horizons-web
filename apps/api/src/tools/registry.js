import { TOOL_NAMES } from './definitions.js';
import { runGetSales } from './get-sales.js';

const IMPLEMENTED = new Set(['get_sales']);

/** @type {Record<string, Function>} */
const executors = {
	get_sales: runGetSales,
};

export const TOOL_DEFINITIONS = TOOL_NAMES.map((name) => ({
	name,
	description: name === 'get_sales'
		? 'Read authenticated sales from Supabase ventes table'
		: `Stub for ${name} — migrate from n8n in a later phase`,
	access: name.startsWith('get_') || name === 'generate_report' ? 'read' : 'write',
	implemented: IMPLEMENTED.has(name),
}));

const registry = new Map(TOOL_DEFINITIONS.map((def) => [def.name, def]));

export function listToolDefinitions() {
	return [...registry.values()];
}

export function getToolDefinition(name) {
	return registry.get(name) || null;
}

export async function executeTool(name, context, input = {}, referenceDate = new Date()) {
	const def = getToolDefinition(name);
	if (!def) {
		throw new Error(`Unknown tool: ${name}`);
	}
	if (!def.implemented) {
		throw new Error(`Tool not implemented yet: ${name}`);
	}

	const executor = executors[name];
	if (!executor) {
		throw new Error(`Tool executor missing: ${name}`);
	}

	return executor(context, input, referenceDate);
}
