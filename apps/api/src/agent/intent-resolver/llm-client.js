import { getEnv } from '../../config/env.js';

export function getLlmResolverConfig(env = getEnv()) {
	return {
		enabled: env.ashyLlmEnabled,
		apiKey: env.openAiApiKey,
		model: env.ashyLlmModel,
		baseUrl: env.ashyLlmBaseUrl,
		timeoutMs: env.ashyLlmTimeoutMs,
	};
}

export function isLlmResolverEnabled(config = getLlmResolverConfig()) {
	return Boolean(config.enabled && config.apiKey);
}

let chatCompletionImpl = null;

export function setChatCompletionImplForTests(impl) {
	chatCompletionImpl = impl;
}

export function resetChatCompletionImplForTests() {
	chatCompletionImpl = null;
}

export async function createChatCompletion({ messages, config = getLlmResolverConfig() }) {
	if (chatCompletionImpl) {
		return chatCompletionImpl({ messages, config });
	}

	if (!config.apiKey) {
		const error = new Error('OPENAI_API_KEY missing');
		error.code = 'LLM_NOT_CONFIGURED';
		throw error;
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), config.timeoutMs);

	try {
		const response = await fetch(`${config.baseUrl}/chat/completions`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${config.apiKey}`,
			},
			body: JSON.stringify({
				model: config.model,
				temperature: 0,
				response_format: { type: 'json_object' },
				messages,
			}),
			signal: controller.signal,
		});

		if (!response.ok) {
			const error = new Error(`LLM HTTP ${response.status}`);
			error.code = 'LLM_HTTP_ERROR';
			throw error;
		}

		const payload = await response.json();
		const content = payload?.choices?.[0]?.message?.content;
		if (!content) {
			const error = new Error('LLM empty response');
			error.code = 'LLM_EMPTY_RESPONSE';
			throw error;
		}

		return content;
	} catch (err) {
		if (err.name === 'AbortError') {
			const timeoutError = new Error('LLM timeout');
			timeoutError.code = 'LLM_TIMEOUT';
			throw timeoutError;
		}
		throw err;
	} finally {
		clearTimeout(timeout);
	}
}
