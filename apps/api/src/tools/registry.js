import { TOOL_DEFINITIONS, TOOL_METADATA, TOOL_NAMES } from './definitions.js';
import { runGetDebts } from './get-debts.js';
import { runGetExpenses } from './get-expenses.js';
import { runGetSales } from './get-sales.js';
import { runGetStock } from './get-stock.js';

const IMPLEMENTED = new Set(['get_sales', 'get_expenses', 'get_stock', 'get_debts']);

/** @type {Record<string, Function>} */
const executors = {
	get_sales: runGetSales,
	get_expenses: runGetExpenses,
	get_stock: runGetStock,
	get_debts: runGetDebts,
};

const registry = new Map(
	TOOL_NAMES.map((name) => [name, {
		...TOOL_METADATA[name],
		implemented: IMPLEMENTED.has(name),
	}]),
);

export { TOOL_DEFINITIONS, TOOL_NAMES };

export function listToolDefinitions() {
	return [...registry.values()];
}

export function getToolDefinition(name) {
	return registry.get(name) || null;
}

export function isWriteTool(name) {
	const def = getToolDefinition(name);
	return def?.access === 'write';
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
