/**
 * Future Ashy tools must receive user context from the backend — never from the model.
 *
 * Example:
 *   await executeRegisteredTool('get_sales', createToolExecutionContext(req), input);
 */
export function createToolExecutionContext(req) {
	if (!req?.user?.id) {
		throw new Error('Authenticated user context is required for tool execution');
	}

	return {
		user: req.user,
	};
}

export function withToolInput(context, input) {
	return {
		...context,
		input,
	};
}
