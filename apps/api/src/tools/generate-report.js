import { generateActivityReport } from '../services/report-service.js';
import { errorToolResult, mapServiceError, successToolResult } from '../utils/tool-result.js';
import { assertNoIdentityParams } from './validation.js';

export const GENERATE_REPORT_TOOL = 'generate_report';

export function validateGenerateReportInput(input = {}) {
	return assertNoIdentityParams(input, GENERATE_REPORT_TOOL);
}

export async function runGenerateReport(context, input = {}, referenceDate = new Date()) {
	const tool = GENERATE_REPORT_TOOL;

	try {
		if (!context?.user?.id) {
			return errorToolResult(tool, 'UNAUTHENTICATED', 'Authenticated user context is required');
		}

		validateGenerateReportInput(input);
		const result = await generateActivityReport(context.user, input, referenceDate);

		return successToolResult(tool, {
			summary: result.summary,
			sections: result.sections,
		}, {
			period: result.input.period || null,
			startDate: result.range.startDate,
			endDate: result.range.endDate,
			reportType: result.summary.reportType,
			timeZone: result.range.timeZone,
		});
	} catch (err) {
		if (err?.code === 'FORBIDDEN_PARAMETER') {
			return errorToolResult(tool, 'FORBIDDEN_PARAMETER', err.message);
		}
		return mapServiceError(tool, err);
	}
}
