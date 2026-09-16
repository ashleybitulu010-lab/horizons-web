import { FINANCIAL_ANALYSIS_STATUS, FINANCIAL_ANALYSIS_TYPES } from '../financial/financial-contract.js';
import {
	createEmptyGeneratedResponse,
	RESPONSE_SOURCE,
	RESPONSE_STATUS,
	RESPONSE_STRATEGY,
	validateGeneratedResponse,
} from './response-contract.js';
import {
	formulateResponseWithLlm,
	isResponseLlmEnabled,
} from './response-llm.js';
import { sanitizeResponseText } from './response-sanitizer.js';
import { buildActionResponseText } from '../action/action-response-bridge.js';
import { selectTemplate } from './response-templates.js';
import { validateGeneratedResponseText } from './response-validator.js';

export function selectResponseStrategy(goal, analysis, options = {}) {
	if (goal?.type === 'ACTION') {
		return RESPONSE_STRATEGY.DETERMINISTIC;
	}

	if (!analysis) {
		return RESPONSE_STRATEGY.DETERMINISTIC;
	}

	if (analysis.status === FINANCIAL_ANALYSIS_STATUS.NO_DATA
		|| analysis.status === FINANCIAL_ANALYSIS_STATUS.UNAVAILABLE
		|| analysis.status === FINANCIAL_ANALYSIS_STATUS.INVALID_INPUT) {
		return RESPONSE_STRATEGY.DETERMINISTIC;
	}

	if (analysis.partial || analysis.status === FINANCIAL_ANALYSIS_STATUS.PARTIAL) {
		return RESPONSE_STRATEGY.DETERMINISTIC;
	}

	if (goal?.objective === 'RETRIEVE') {
		return RESPONSE_STRATEGY.DETERMINISTIC;
	}

	if (goal?.domain === 'EXPENSES' && goal?.objective === 'COMPARE') {
		return RESPONSE_STRATEGY.DETERMINISTIC;
	}

	if (analysis.analysisType === FINANCIAL_ANALYSIS_TYPES.EXPLANATION
		&& (analysis.drivers?.length || 0) >= 2
		&& options.useLlm === true
		&& isResponseLlmEnabled(options.env)) {
		return RESPONSE_STRATEGY.LLM;
	}

	return RESPONSE_STRATEGY.DETERMINISTIC;
}

function resolveResponseStatus(analysis) {
	if (!analysis) return RESPONSE_STATUS.ERROR;
	if (analysis.partial || analysis.status === FINANCIAL_ANALYSIS_STATUS.PARTIAL) {
		return RESPONSE_STATUS.PARTIAL;
	}
	if (analysis.status === FINANCIAL_ANALYSIS_STATUS.NO_DATA) {
		return RESPONSE_STATUS.NO_DATA;
	}
	if (analysis.status === FINANCIAL_ANALYSIS_STATUS.UNAVAILABLE
		|| analysis.status === FINANCIAL_ANALYSIS_STATUS.INVALID_INPUT) {
		return RESPONSE_STATUS.ERROR;
	}
	return RESPONSE_STATUS.COMPLETE;
}

function buildFactsUsed(analysis) {
	return (analysis?.facts || []).map((f) => f.key).filter(Boolean);
}

function buildMetricsUsed(analysis) {
	return Object.keys(analysis?.metrics || {});
}

function buildDriverIds(analysis) {
	return (analysis?.drivers || []).map((d) => d.type).filter(Boolean);
}

/**
 * Generate a natural language response from FinancialAnalysisResult.
 * FinancialAnalysisResult is the sole source of financial truth.
 */
export async function generateResponse({
	goal = null,
	financialAnalysis = null,
	actionProposal = null,
	context = {},
	options = {},
}) {
	const startedAt = Date.now();
	const base = createEmptyGeneratedResponse();
	const strategy = selectResponseStrategy(goal, financialAnalysis, options);
	base.diagnostics.responseStrategy = strategy;

	if (goal?.type === 'ACTION' && actionProposal) {
		const text = buildActionResponseText(actionProposal, context);
		const result = {
			text,
			source: RESPONSE_SOURCE.TEMPLATE,
			status: RESPONSE_STATUS.COMPLETE,
			analysisType: null,
			factsUsed: [],
			metricsUsed: [],
			driverIds: [],
			warnings: actionProposal.warnings || [],
			diagnostics: {
				responseStrategy: strategy,
				responseDurationMs: Date.now() - startedAt,
				validationStatus: 'ACTION_PROPOSAL',
				fallbackReason: null,
			},
		};
		const validated = validateGeneratedResponse(result);
		return validated.valid ? validated.value : result;
	}

	if (!financialAnalysis && goal?.type !== 'ACTION') {
		base.text = selectTemplate(null, goal, context);
		base.status = RESPONSE_STATUS.ERROR;
		base.diagnostics.responseDurationMs = Date.now() - startedAt;
		base.diagnostics.validationStatus = 'NO_ANALYSIS';
		return validateGeneratedResponse(base).value;
	}

	let text = '';
	let source = RESPONSE_SOURCE.TEMPLATE;
	let fallbackReason = null;

	const templateText = selectTemplate(financialAnalysis, goal, context);

	if (strategy === RESPONSE_STRATEGY.LLM) {
		try {
			const llmText = await formulateResponseWithLlm(goal, financialAnalysis, context, options);
			const sanitized = sanitizeResponseText(llmText);
			const validation = validateGeneratedResponseText(sanitized, financialAnalysis);

			if (sanitized && validation.valid) {
				text = sanitized;
				source = RESPONSE_SOURCE.LLM;
			} else {
				fallbackReason = validation.error || 'LLM_VALIDATION_FAILED';
				text = templateText;
				source = RESPONSE_SOURCE.TEMPLATE;
			}
		} catch (err) {
			fallbackReason = err?.code || 'LLM_UNAVAILABLE';
			text = templateText;
			source = RESPONSE_SOURCE.TEMPLATE;
		}
	} else {
		text = templateText;
		source = RESPONSE_SOURCE.TEMPLATE;
	}

	const sanitizedTemplate = sanitizeResponseText(text) || templateText;
	text = sanitizedTemplate;

	const finalValidation = validateGeneratedResponseText(text, financialAnalysis);

	if (!finalValidation.valid && source === RESPONSE_SOURCE.LLM) {
		fallbackReason = finalValidation.error;
		text = templateText;
		source = RESPONSE_SOURCE.TEMPLATE;
	}

	const status = fallbackReason
		? RESPONSE_STATUS.FALLBACK
		: resolveResponseStatus(financialAnalysis);

	const result = {
		text,
		source,
		status: goal?.type === 'ACTION' ? RESPONSE_STATUS.COMPLETE : status,
		analysisType: financialAnalysis?.analysisType || null,
		factsUsed: buildFactsUsed(financialAnalysis),
		metricsUsed: buildMetricsUsed(financialAnalysis),
		driverIds: buildDriverIds(financialAnalysis),
		warnings: financialAnalysis?.limitations || [],
		diagnostics: {
			responseStrategy: strategy,
			responseDurationMs: Date.now() - startedAt,
			validationStatus: finalValidation.valid ? 'OK' : finalValidation.error,
			fallbackReason,
		},
	};

	const validated = validateGeneratedResponse(result);
	return validated.valid ? validated.value : {
		...createEmptyGeneratedResponse(),
		text: selectTemplate(financialAnalysis, goal, context),
		status: RESPONSE_STATUS.FALLBACK,
		diagnostics: {
			responseStrategy: strategy,
			responseDurationMs: Date.now() - startedAt,
			validationStatus: validated.error,
			fallbackReason: validated.error,
		},
	};
}

export function sanitizeResponseForLog(response) {
	if (!response) return null;
	return {
		source: response.source,
		status: response.status,
		analysisType: response.analysisType,
		textLength: response.text?.length ?? 0,
		factsUsedCount: response.factsUsed?.length ?? 0,
		driverIds: response.driverIds || [],
		diagnostics: response.diagnostics || {},
	};
}
