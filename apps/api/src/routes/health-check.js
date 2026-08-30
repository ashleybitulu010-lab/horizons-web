export default async (req, res) => {
	res.json({
		ok: true,
		status: 'ok',
		service: 'ash-ledger-api',
	});
};
