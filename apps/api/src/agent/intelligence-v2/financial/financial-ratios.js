import { isFiniteNumber, roundMoney } from './financial-precision.js';

export const RATIO_REASON = Object.freeze({
	ZERO_DENOMINATOR: 'ZERO_DENOMINATOR',
	INVALID_INPUT: 'INVALID_INPUT',
});

export function computeProfitMargin(profit, revenue) {
	if (!isFiniteNumber(profit) || !isFiniteNumber(revenue)) {
		return { value: null, reason: RATIO_REASON.INVALID_INPUT };
	}
	if (revenue === 0) {
		return { value: null, reason: RATIO_REASON.ZERO_DENOMINATOR };
	}
	return { value: roundMoney((profit / revenue) * 100), reason: null };
}

export function computeExpenseToRevenueRatio(expenses, revenue) {
	if (!isFiniteNumber(expenses) || !isFiniteNumber(revenue)) {
		return { value: null, reason: RATIO_REASON.INVALID_INPUT };
	}
	if (revenue === 0) {
		return { value: null, reason: RATIO_REASON.ZERO_DENOMINATOR };
	}
	return { value: roundMoney((expenses / revenue) * 100), reason: null };
}
