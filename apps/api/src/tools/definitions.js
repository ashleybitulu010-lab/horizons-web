/** Tool names reserved for future Ashy migrations from n8n. */
export const TOOL_NAMES = Object.freeze([
	'get_sales',
	'get_expenses',
	'get_stock',
	'get_products',
	'get_debts',
	'create_sale',
	'create_expense',
	'update_sale',
	'update_expense',
	'adjust_stock',
	'generate_report',
]);

/**
 * @typedef {Object} AshToolDefinition
 * @property {string} name
 * @property {string} description
 * @property {'read'|'write'} access
 * @property {boolean} implemented
 */

/** @type {AshToolDefinition[]} */
export const TOOL_DEFINITIONS = TOOL_NAMES.map((name) => ({
	name,
	description: `Stub for ${name} — migrate from n8n in a later phase`,
	access: name.startsWith('get_') || name === 'generate_report' ? 'read' : 'write',
	implemented: false,
}));
