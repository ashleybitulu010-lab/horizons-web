const PERIOD_LABELS = {
	today: 'aujourd’hui',
	yesterday: 'hier',
	current_week: 'cette semaine',
	previous_week: 'la semaine dernière',
	current_month: 'ce mois-ci',
	previous_month: 'le mois dernier',
	current_year: 'cette année',
};

export function formatMoneyV2(value, currency = '$') {
	if (value == null || !Number.isFinite(Number(value))) return null;
	return `${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} ${currency}`;
}

export function formatPercentV2(value) {
	if (value == null || !Number.isFinite(Number(value))) return null;
	return `${Number(value).toLocaleString('fr-FR', { maximumFractionDigits: 2 })} %`;
}

export function formatPeriodLabel(period) {
	if (!period) return 'sur la période demandée';
	if (period.label && PERIOD_LABELS[period.label]) {
		return PERIOD_LABELS[period.label];
	}
	if (period.start && period.end) {
		return `du ${period.start} au ${period.end}`;
	}
	return 'sur la période demandée';
}

export function directionVerb(direction, positive = 'augmenté', negative = 'baissé', neutral = 'stagné') {
	if (direction === 'UP') return positive;
	if (direction === 'DOWN') return negative;
	return neutral;
}

export function directionNoun(direction, positive = 'augmentation', negative = 'baisse', neutral = 'stagnation') {
	if (direction === 'UP') return positive;
	if (direction === 'DOWN') return negative;
	return neutral;
}
