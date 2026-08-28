import { getEnv } from '../config/env.js';

export const PERIOD_IDS = Object.freeze([
	'today',
	'yesterday',
	'current_week',
	'previous_week',
	'current_month',
	'previous_month',
	'current_year',
]);

export function getLedgerTimezone() {
	return getEnv().ledgerTimezone;
}

function getZonedParts(date, timeZone) {
	const formatter = new Intl.DateTimeFormat('en-CA', {
		timeZone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		weekday: 'short',
	});

	const parts = formatter.formatToParts(date);
	const read = (type) => parts.find((part) => part.type === type)?.value;

	return {
		year: Number(read('year')),
		month: Number(read('month')),
		day: Number(read('day')),
		weekday: read('weekday'),
	};
}

function ymdKey({ year, month, day }) {
	return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function zonedDateFromYmd(ymd, timeZone) {
	const [year, month, day] = ymd.split('-').map(Number);
	const utcGuess = Date.UTC(year, month - 1, day, 12, 0, 0, 0);
	const inTz = new Date(new Date(utcGuess).toLocaleString('en-US', { timeZone: 'UTC' }));
	const inUtc = new Date(new Date(utcGuess).toLocaleString('en-US', { timeZone }));
	const offsetMs = inUtc.getTime() - inTz.getTime();
	return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0) + offsetMs);
}

function addDaysYmd(ymd, days, timeZone) {
	const base = zonedDateFromYmd(ymd, timeZone);
	base.setUTCDate(base.getUTCDate() + days);
	return getZonedParts(base, timeZone);
}

function startOfWeekYmd(reference, timeZone) {
	const current = getZonedParts(reference, timeZone);
	const weekdayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
	const dayIndex = weekdayMap[current.weekday] ?? 0;
	const mondayOffset = dayIndex === 0 ? -6 : 1 - dayIndex;
	const monday = addDaysYmd(ymdKey(current), mondayOffset, timeZone);
	return ymdKey(monday);
}

export function resolvePeriodBounds(period, referenceDate = new Date(), timeZone = getLedgerTimezone()) {
	if (!PERIOD_IDS.includes(period)) {
		const error = new Error(`Invalid period: ${period}`);
		error.code = 'INVALID_PERIOD';
		throw error;
	}

	const today = getZonedParts(referenceDate, timeZone);
	const todayYmd = ymdKey(today);

	let startYmd;
	let endYmd = todayYmd;

	switch (period) {
	case 'today':
		startYmd = todayYmd;
		break;
	case 'yesterday': {
		startYmd = ymdKey(addDaysYmd(todayYmd, -1, timeZone));
		endYmd = startYmd;
		break;
	}
	case 'current_week':
		startYmd = startOfWeekYmd(referenceDate, timeZone);
		break;
	case 'previous_week': {
		const currentWeekStart = startOfWeekYmd(referenceDate, timeZone);
		startYmd = ymdKey(addDaysYmd(currentWeekStart, -7, timeZone));
		endYmd = ymdKey(addDaysYmd(currentWeekStart, -1, timeZone));
		break;
	}
	case 'current_month':
		startYmd = `${today.year}-${String(today.month).padStart(2, '0')}-01`;
		break;
	case 'previous_month': {
		const month = today.month === 1 ? 12 : today.month - 1;
		const year = today.month === 1 ? today.year - 1 : today.year;
		startYmd = `${year}-${String(month).padStart(2, '0')}-01`;
		const lastDay = new Date(Date.UTC(today.month === 1 ? today.year - 1 : today.year, today.month === 1 ? 11 : today.month - 1, 0));
		endYmd = ymdKey(getZonedParts(lastDay, timeZone));
		break;
	}
	case 'current_year':
		startYmd = `${today.year}-01-01`;
		break;
	default:
		throw new Error(`Unsupported period: ${period}`);
	}

	const start = zonedDateFromYmd(startYmd, timeZone).toISOString();
	const endDate = zonedDateFromYmd(endYmd, timeZone);
	endDate.setUTCDate(endDate.getUTCDate() + 1);
	endDate.setUTCMilliseconds(endDate.getUTCMilliseconds() - 1);

	return {
		period,
		startDate: startYmd,
		endDate: endYmd,
		startIso: start,
		endIso: endDate.toISOString(),
		timeZone,
	};
}

export function resolveDateRange(input = {}, referenceDate = new Date(), timeZone = getLedgerTimezone()) {
	if (input.period) {
		return resolvePeriodBounds(input.period, referenceDate, timeZone);
	}

	if (input.startDate && input.endDate) {
		const startYmd = String(input.startDate).slice(0, 10);
		const endYmd = String(input.endDate).slice(0, 10);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(startYmd) || !/^\d{4}-\d{2}-\d{2}$/.test(endYmd)) {
			const error = new Error('startDate and endDate must use YYYY-MM-DD format');
			error.code = 'INVALID_DATE_RANGE';
			throw error;
		}
		if (startYmd > endYmd) {
			const error = new Error('startDate must be before or equal to endDate');
			error.code = 'INVALID_DATE_RANGE';
			throw error;
		}

		const start = zonedDateFromYmd(startYmd, timeZone).toISOString();
		const endDate = zonedDateFromYmd(endYmd, timeZone);
		endDate.setUTCDate(endDate.getUTCDate() + 1);
		endDate.setUTCMilliseconds(endDate.getUTCMilliseconds() - 1);

		return {
			period: null,
			startDate: startYmd,
			endDate: endYmd,
			startIso: start,
			endIso: endDate.toISOString(),
			timeZone,
		};
	}

	const error = new Error('Either period or startDate/endDate is required');
	error.code = 'INVALID_DATE_RANGE';
	throw error;
}
