export default async function me(req, res) {
	res.json({
		user: {
			id: req.user.id,
			email: req.user.email,
			firstName: req.user.firstName,
			lastName: req.user.lastName,
			airtableId: req.user.airtableId,
			businessUserId: req.user.businessUserId,
			clientId: req.user.clientId,
			activeActivityId: req.user.activeActivityId || null,
		},
	});
}
