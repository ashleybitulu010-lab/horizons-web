import { createChatCompletion, getLlmResolverConfig } from '../../intent-resolver/llm-client.js';
import { getEnv } from '../../../config/env.js';

const SYSTEM_PROMPT = `Tu es le générateur de formulation d'Ashy.

Règles strictes :
- Tu ne calcules aucun chiffre.
- Tu ne modifies aucun chiffre.
- Tu n'ajoutes aucune donnée.
- Tu ne supprimes aucune limitation importante.
- Tu utilises uniquement les facts, metrics, drivers et comparisons fournis.
- Si une donnée est absente, tu ne l'inventes pas.
- Si l'analyse est partielle, tu dois le signaler.
- Tu réponds en français clair, naturel et professionnel.
- Tu ne mentionnes jamais les outils internes, SQL, Supabase, planner ou LLM.
- Tu ne prétends jamais avoir effectué une écriture financière.
- Préfère "le principal facteur observé" plutôt que "la cause certaine".

Retourne UNIQUEMENT un JSON :
{ "text": "..." }`;

export function buildResponsePayload(goal, analysis, context = {}) {
	return {
		responseContext: {
			goalType: goal?.type || null,
			domain: goal?.domain || analysis?.domain || null,
			objective: goal?.objective || null,
			analysisType: analysis?.analysisType || null,
			activityName: context.activityName || null,
		},
		analysis: {
			status: analysis?.status || null,
			partial: analysis?.partial ?? false,
			facts: analysis?.facts || [],
			metrics: analysis?.metrics || {},
			comparisons: analysis?.comparisons || {},
			drivers: (analysis?.drivers || []).map((d) => ({
				type: d.type,
				label: d.label,
				direction: d.direction,
				absoluteImpact: d.absoluteImpact,
				currentValue: d.currentValue,
				previousValue: d.previousValue,
			})),
			interpretations: analysis?.interpretations || [],
			limitations: analysis?.limitations || [],
		},
		responsePreferences: {
			language: context.language || 'fr',
			currencyDisplay: context.currencyDisplay || '$',
		},
	};
}

export function parseLlmResponseJson(content) {
	const text = String(content || '').trim();
	const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
	const candidate = fenced ? fenced[1].trim() : text;
	const parsed = JSON.parse(candidate);
	if (!parsed?.text || !String(parsed.text).trim()) {
		const error = new Error('LLM response missing text');
		error.code = 'LLM_INVALID_JSON';
		throw error;
	}
	return String(parsed.text).trim();
}

let llmFormulateImpl = null;

export function setLlmFormulateImplForTests(impl) {
	llmFormulateImpl = impl;
}

export function resetLlmFormulateImplForTests() {
	llmFormulateImpl = null;
}

export function isResponseLlmEnabled(env = getEnv()) {
	return env.ashyIntelligenceV2Llm === true && Boolean(env.openAiApiKey);
}

export async function formulateResponseWithLlm(goal, analysis, context = {}, options = {}) {
	if (llmFormulateImpl) {
		return llmFormulateImpl({ goal, analysis, context, options });
	}

	const payload = buildResponsePayload(goal, analysis, context);
	const messages = [
		{ role: 'system', content: SYSTEM_PROMPT },
		{
			role: 'user',
			content: JSON.stringify(payload),
		},
	];

	const config = options.llmConfig || getLlmResolverConfig(options.env || getEnv());
	const content = await createChatCompletion({ messages, config });
	return parseLlmResponseJson(content);
}
