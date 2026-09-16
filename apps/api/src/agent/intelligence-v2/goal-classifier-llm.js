import { createChatCompletion, getLlmResolverConfig } from '../intent-resolver/llm-client.js';
import { GOAL_DOMAINS, GOAL_OBJECTIVES, GOAL_TYPES, PERIOD_SPEC_TYPES } from './constants.js';
import { normalizeGoal } from './goal-contract.js';

const SYSTEM_PROMPT = `You are Ashy's goal classifier for Ash Ledger.
Return ONLY valid JSON describing the user's goal.

Allowed goal.type: ${GOAL_TYPES.join(', ')}
Allowed goal.domain: ${GOAL_DOMAINS.join(', ')}
Allowed goal.objective: ${GOAL_OBJECTIVES.join(', ')}
Allowed period.type: ${PERIOD_SPEC_TYPES.join(', ')}

Rules:
- Never output userId, clientId, activityId, tenantId, SQL, tool names, or credentials.
- activityReference may be a human-readable activity name only — never a UUID.
- Do not invent financial numbers.
- QUESTION = simple data retrieval.
- ANALYSIS = explain, compare, or summarize trends.
- ACTION = create/update/adjust (intent only — no execution).
- MIXED = multiple goals in one message.
- "pourquoi" + profit/benefit → ANALYSIS / PROFIT / EXPLAIN with comparison when implied.
- "ajoute une dépense" → ACTION / EXPENSES / CREATE with amount/label in parameters when present.
- "ajoute ... vendu" → ACTION / SALES / CREATE.

Return JSON:
{
  "type": "QUESTION",
  "domain": "SALES",
  "objective": "RETRIEVE",
  "period": { "type": "CURRENT_MONTH", "start": "YYYY-MM-DD", "end": "YYYY-MM-DD" },
  "comparison": null,
  "activityReference": null,
  "parameters": {}
}`;

export function buildGoalClassifierMessages(message, conversationContext = {}) {
	return [
		{ role: 'system', content: SYSTEM_PROMPT },
		{
			role: 'user',
			content: JSON.stringify({
				message: String(message || ''),
				conversationContext: {
					topic: conversationContext.topic || null,
					filters: conversationContext.filters || {},
					references: conversationContext.references || {},
					pendingWrite: conversationContext.pendingWrite
						? { tool: conversationContext.pendingWrite.tool }
						: null,
				},
			}),
		},
	];
}

export function parseGoalJsonContent(content) {
	const text = String(content || '').trim();
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidate = fenced ? fenced[1].trim() : text;
	return JSON.parse(candidate);
}

export async function classifyGoalLlm(message, conversationContext = {}, options = {}) {
	const config = options.config || getLlmResolverConfig();
	const startedAt = Date.now();

	const content = await createChatCompletion({
		messages: buildGoalClassifierMessages(message, conversationContext),
		config,
	});

	let parsed;
	try {
		parsed = parseGoalJsonContent(content);
	} catch {
		const error = new Error('Goal LLM invalid JSON');
		error.code = 'GOAL_LLM_INVALID_JSON';
		throw error;
	}

	const validated = normalizeGoal(parsed, {
		referenceDate: options.referenceDate || new Date(),
		rejectWriteExecution: true,
	});

	if (!validated.valid) {
		const error = new Error('Goal LLM invalid structure');
		error.code = 'GOAL_LLM_INVALID';
		error.details = validated.error;
		throw error;
	}

	return {
		goal: validated.value,
		source: 'llm',
		meta: {
			durationMs: Date.now() - startedAt,
		},
	};
}
