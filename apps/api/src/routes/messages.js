import logger from '../utils/logger.js';

const AIRTABLE_API_KEY = process.env.AIRTABLE_API_KEY;
const AIRTABLE_BASE_ID = process.env.AIRTABLE_BASE_ID;
const AIRTABLE_TABLE_NAME = process.env.AIRTABLE_TABLE_NAME || 'messages';

function getAirtableHeaders() {
	if (!AIRTABLE_API_KEY) throw new Error('AIRTABLE_API_KEY is not set in apps/api/.env');
	if (!AIRTABLE_BASE_ID) throw new Error('AIRTABLE_BASE_ID is not set in apps/api/.env');
	return {
		'Authorization': `Bearer ${AIRTABLE_API_KEY}`,
		'Content-Type': 'application/json',
	};
}

function airtableUrl(params = '') {
	const encoded = encodeURIComponent(AIRTABLE_TABLE_NAME);
	return `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${encoded}${params}`;
}

export async function saveMessage(req, res) {
	const { userId, sessionId, message, sender, timestamp } = req.body ?? {};
	if (!userId || !message || !sender) {
		return res.status(422).json({ error: 'userId, message, and sender are required' });
	}

	const headers = getAirtableHeaders();
	const upstream = await fetch(airtableUrl(), {
		method: 'POST',
		headers,
		body: JSON.stringify({
			records: [{
				fields: {
					userId,
					sessionId: sessionId || userId,
					message,
					sender,
					timestamp: timestamp || new Date().toISOString(),
				},
			}],
		}),
	});

	if (!upstream.ok) {
		const errBody = await upstream.text();
		logger.error(`Airtable save error: ${upstream.status} ${upstream.statusText} — ${errBody}`);
		throw new Error(`Airtable save failed: ${upstream.status} ${upstream.statusText}`);
	}

	const data = await upstream.json();
	res.json({ success: true, id: data.records?.[0]?.id });
}

export async function getMessages(req, res) {
	const { userId } = req.params;
	if (!userId) {
		return res.status(422).json({ error: 'userId is required' });
	}

	const headers = getAirtableHeaders();
	const filterFormula = encodeURIComponent(`{userId} = "${userId}"`);
	const sortField = encodeURIComponent('timestamp');
	const url = airtableUrl(`?filterByFormula=${filterFormula}&sort[0][field]=${sortField}&sort[0][direction]=asc&pageSize=200`);

	const upstream = await fetch(url, { headers });

	if (!upstream.ok) {
		const errBody = await upstream.text();
		logger.error(`Airtable fetch error: ${upstream.status} ${upstream.statusText} — ${errBody}`);
		throw new Error(`Airtable fetch failed: ${upstream.status} ${upstream.statusText}`);
	}

	const data = await upstream.json();
	const messages = (data.records || []).map(r => ({
		id: r.id,
		userId: r.fields.userId,
		sessionId: r.fields.sessionId,
		message: r.fields.message,
		sender: r.fields.sender,
		timestamp: r.fields.timestamp,
	}));

	res.json({ messages });
}
