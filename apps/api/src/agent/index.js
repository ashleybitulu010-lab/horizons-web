import { assertAshyContract } from './contract.js';
import { listToolDefinitions } from '../tools/registry.js';

/**
 * Future Ashy orchestrator entry point (phase 0 — stub only).
 * Chat still flows through n8n via POST /chat.
 */
export function createAshyAgentStub() {
	const contract = assertAshyContract();

	return {
		contract,
		availableTools: listToolDefinitions().map((tool) => tool.name),
		async run() {
			throw new Error('Ashy agent orchestration is not implemented yet. Use POST /chat (n8n proxy).');
		},
	};
}
