/**
 * Maps a resolved intent to a generic tool execution plan.
 * The agent executes plans — it is not hard-coded around get_sales only.
 */

export function planToolExecution(resolved) {
	switch (resolved.intent) {
	case 'query_sales':
		return {
			steps: [{
				tool: 'get_sales',
				input: {
					period: resolved.filters?.period || 'current_month',
					...(resolved.filters?.product ? { product: resolved.filters.product } : {}),
				},
			}],
			responseKind: 'query_sales',
		};

	case 'compare_sales':
		return {
			steps: (resolved.filters?.periods || ['current_month', 'previous_month']).map((period) => ({
				tool: 'get_sales',
				input: { period },
			})),
			responseKind: 'compare_sales',
		};

	case 'best_product':
		return {
			steps: [{
				tool: 'get_sales',
				input: {
					period: resolved.filters?.period || 'current_month',
				},
				postProcess: 'best_product',
			}],
			responseKind: 'best_product',
		};

	case 'query_expenses':
		return {
			steps: [],
			responseKind: 'unimplemented_topic',
			unimplementedTool: 'get_expenses',
		};

	default:
		return {
			steps: [],
			responseKind: 'unknown',
		};
	}
}
