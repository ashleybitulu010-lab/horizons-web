export function successToolResult(tool, data, meta = {}) {
	return {
		success: true,
		tool,
		data,
		meta,
		error: null,
	};
}

export function errorToolResult(tool, code, message, meta = {}) {
	return {
		success: false,
		tool,
		data: null,
		meta,
		error: {
			code,
			message,
		},
	};
}

export function mapServiceError(tool, err) {
	if (err?.code === 'SUPABASE_CLIENT_SCOPE_MISSING') {
		return errorToolResult(tool, 'CLIENT_SCOPE_MISSING', 'No Supabase client scope is available for this user');
	}
	if (err?.code === 'INVALID_PERIOD') {
		return errorToolResult(tool, 'INVALID_PERIOD', err.message);
	}
	if (err?.code === 'INVALID_DATE_RANGE') {
		return errorToolResult(tool, 'INVALID_DATE_RANGE', err.message);
	}
	if (err?.code === 'SUPABASE_QUERY_FAILED') {
		return errorToolResult(tool, 'SUPABASE_ERROR', 'Unable to retrieve sales data');
	}
	return errorToolResult(tool, 'INTERNAL_ERROR', 'Unable to complete the sales request');
}
