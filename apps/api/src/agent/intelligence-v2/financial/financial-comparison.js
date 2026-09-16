import { isFiniteNumber, roundMoney } from './financial-precision.js';

export const CHANGE_DIRECTION = Object.freeze({
	UP: 'UP',
	DOWN: 'DOWN',
	UNCHANGED: 'UNCHANGED',
	UNAVAILABLE: 'UNAVAILABLE',
});

export const PERCENTAGE_REASON = Object.freeze({
	NO_BASELINE: 'NO_BASELINE',
	INVALID_INPUT: 'INVALID_INPUT',
});

/**
 * Compare two numeric metrics across periods.
 * Never returns Infinity or NaN for percentageChange.
 */
export function compareMetric(current, previous) {
	if (!isFiniteNumber(current) || !isFiniteNumber(previous)) {
		return {
			current: isFiniteNumber(current) ? roundMoney(current) : null,
			previous: isFiniteNumber(previous) ? roundMoney(previous) : null,
			absoluteChange: null,
			percentageChange: null,
			direction: CHANGE_DIRECTION.UNAVAILABLE,
			percentageReason: PERCENTAGE_REASON.INVALID_INPUT,
		};
	}

	const roundedCurrent = roundMoney(current);
	const roundedPrevious = roundMoney(previous);
	const absoluteChange = roundMoney(roundedCurrent - roundedPrevious);

	if (roundedPrevious === 0) {
		return {
			current: roundedCurrent,
			previous: roundedPrevious,
			absoluteChange,
			percentageChange: null,
			direction: roundedCurrent > 0 ? CHANGE_DIRECTION.UP : CHANGE_DIRECTION.UNCHANGED,
			percentageReason: PERCENTAGE_REASON.NO_BASELINE,
		};
	}

	const percentageChange = roundMoney((absoluteChange / roundedPrevious) * 100);
	let direction = CHANGE_DIRECTION.UNCHANGED;
	if (absoluteChange > 0) direction = CHANGE_DIRECTION.UP;
	if (absoluteChange < 0) direction = CHANGE_DIRECTION.DOWN;

	return {
		current: roundedCurrent,
		previous: roundedPrevious,
		absoluteChange,
		percentageChange,
		direction,
		percentageReason: null,
	};
}
