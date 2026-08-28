import { TOOL_DEFINITIONS } from './definitions.js';

const registry = new Map(TOOL_DEFINITIONS.map((def) => [def.name, def]));

export function listToolDefinitions() {
	return [...registry.values()];
}

export function getToolDefinition(name) {
	return registry.get(name) || null;
}

/**
 * Future: execute a registered tool with Supabase-backed services.
 */
export async function executeTool(name, _context, _input) {
	const def = getToolDefinition(name);
	if (!def) {
		throw new Error(`Unknown tool: ${name}`);
	}
	if (!def.implemented) {
		throw new Error(`Tool not implemented yet: ${name}`);
	}
	throw new Error('Tool execution pipeline is not wired yet.');
}
