/**
 * Deterministic reference dataset for golden tests and harness.
 * Not production data.
 */
export const GOLDEN_SCENARIO_A = Object.freeze({
	name: 'profit_explain_central',
	current: {
		revenue: 1200,
		collected: 1200,
		expenses: 800,
		salesCount: 10,
		expenseCount: 5,
	},
	previous: {
		revenue: 900,
		collected: 900,
		expenses: 400,
		salesCount: 8,
		expenseCount: 3,
	},
	expected: {
		currentProfit: 400,
		previousProfit: 500,
		revenueChange: 300,
		revenueChangePercent: 33.33,
		expenseChange: 400,
		expenseChangePercent: 100,
		profitChange: -100,
		profitChangePercent: -20,
	},
});

export function buildGoldenStepResults(scenario = GOLDEN_SCENARIO_A) {
	return [
		{
			stepId: 'sales_current',
			tool: 'get_sales',
			status: 'SUCCESS',
			arguments: { period: 'current_month' },
			summary: {
				count: scenario.current.salesCount,
				totalRevenue: scenario.current.revenue,
				totalCollected: scenario.current.collected,
			},
			toolResult: {
				success: true,
				tool: 'get_sales',
				meta: { period: 'current_month', startDate: '2026-09-01', endDate: '2026-09-30' },
				data: {
					summary: {
						count: scenario.current.salesCount,
						totalRevenue: scenario.current.revenue,
						totalCollected: scenario.current.collected,
					},
				},
			},
		},
		{
			stepId: 'sales_previous',
			tool: 'get_sales',
			status: 'SUCCESS',
			arguments: { period: 'previous_month' },
			summary: {
				count: scenario.previous.salesCount,
				totalRevenue: scenario.previous.revenue,
				totalCollected: scenario.previous.collected,
			},
			toolResult: {
				success: true,
				tool: 'get_sales',
				meta: { period: 'previous_month', startDate: '2026-08-01', endDate: '2026-08-31' },
				data: {
					summary: {
						count: scenario.previous.salesCount,
						totalRevenue: scenario.previous.revenue,
						totalCollected: scenario.previous.collected,
					},
				},
			},
		},
		{
			stepId: 'expenses_current',
			tool: 'get_expenses',
			status: 'SUCCESS',
			arguments: { period: 'current_month' },
			summary: {
				count: scenario.current.expenseCount,
				totalAmount: scenario.current.expenses,
			},
			toolResult: {
				success: true,
				tool: 'get_expenses',
				meta: { period: 'current_month', startDate: '2026-09-01', endDate: '2026-09-30' },
				data: {
					summary: {
						count: scenario.current.expenseCount,
						totalAmount: scenario.current.expenses,
					},
				},
			},
		},
		{
			stepId: 'expenses_previous',
			tool: 'get_expenses',
			status: 'SUCCESS',
			arguments: { period: 'previous_month' },
			summary: {
				count: scenario.previous.expenseCount,
				totalAmount: scenario.previous.expenses,
			},
			toolResult: {
				success: true,
				tool: 'get_expenses',
				meta: { period: 'previous_month', startDate: '2026-08-01', endDate: '2026-08-31' },
				data: {
					summary: {
						count: scenario.previous.expenseCount,
						totalAmount: scenario.previous.expenses,
					},
				},
			},
		},
	];
}
