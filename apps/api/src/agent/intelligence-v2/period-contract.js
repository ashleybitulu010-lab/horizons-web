import { PERIOD_IDS, resolvePeriodBounds } from '../../utils/periods.js';
import {
	LEGACY_PERIOD_TO_SPEC_TYPE,
	PERIOD_SPEC_TYPES,
	SPEC_TYPE_TO_LEGACY_PERIOD,
} from './constants.js';

const DATE_YMD_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function legacyPeriodIdToSpecType(legacyPeriodId) {
	return LEGACY_PERIOD_TO_SPEC_TYPE[legacyPeriodId] || null;
}

export function specTypeToLegacyPeriodId(specType) {
	return SPEC_TYPE_TO_LEGACY_PERIOD[specType] || null;
}

/**
 * Build a normalized PeriodSpec from a legacy period ID (periods.js).
 * Reuses resolvePeriodBounds — no duplicate calendar logic.
 */
export function buildPeriodSpecFromLegacyId(legacyPeriodId, referenceDate = new Date()) {
	const specType = legacyPeriodIdToSpecType(legacyPeriodId);
	if (!specType) {
		return null;
	}

	const bounds = resolvePeriodBounds(legacyPeriodId, referenceDate);
	return {
		type: specType,
		start: bounds.startDate,
		end: bounds.endDate,
		legacyPeriodId: bounds.period,
	};
}

/**
 * Build a CUSTOM PeriodSpec from explicit YYYY-MM-DD bounds.
 */
export function buildCustomPeriodSpec(start, end) {
	const startYmd = String(start || '').slice(0, 10);
	const endYmd = String(end || '').slice(0, 10);
	if (!DATE_YMD_PATTERN.test(startYmd) || !DATE_YMD_PATTERN.test(endYmd)) {
		return null;
	}
	if (startYmd > endYmd) {
		return null;
	}

	return {
		type: 'CUSTOM',
		start: startYmd,
		end: endYmd,
		legacyPeriodId: null,
	};
}

export function validatePeriodSpec(raw) {
	if (!raw || typeof raw !== 'object') {
		return { valid: false, error: 'PERIOD_INVALID' };
	}

	const type = String(raw.type || '');
	if (!PERIOD_SPEC_TYPES.includes(type)) {
		return { valid: false, error: 'PERIOD_TYPE_INVALID' };
	}

	const start = raw.start == null ? null : String(raw.start).slice(0, 10);
	const end = raw.end == null ? null : String(raw.end).slice(0, 10);

	if (!start || !end || !DATE_YMD_PATTERN.test(start) || !DATE_YMD_PATTERN.test(end)) {
		return { valid: false, error: 'PERIOD_BOUNDS_INVALID' };
	}

	if (start > end) {
		return { valid: false, error: 'PERIOD_RANGE_INVALID' };
	}

	if (type !== 'CUSTOM') {
		const legacyId = specTypeToLegacyPeriodId(type);
		if (!legacyId || !PERIOD_IDS.includes(legacyId)) {
			return { valid: false, error: 'PERIOD_LEGACY_MAPPING_INVALID' };
		}
	}

	return {
		valid: true,
		value: {
			type,
			start,
			end,
			legacyPeriodId: raw.legacyPeriodId ?? specTypeToLegacyPeriodId(type),
		},
	};
}

export function normalizePeriodSpec(raw, referenceDate = new Date()) {
	if (!raw) {
		return null;
	}

	if (typeof raw === 'string' && PERIOD_IDS.includes(raw)) {
		return buildPeriodSpecFromLegacyId(raw, referenceDate);
	}

	if (raw.legacyPeriodId && PERIOD_IDS.includes(raw.legacyPeriodId)) {
		return buildPeriodSpecFromLegacyId(raw.legacyPeriodId, referenceDate);
	}

	const validated = validatePeriodSpec(raw);
	return validated.valid ? validated.value : null;
}
