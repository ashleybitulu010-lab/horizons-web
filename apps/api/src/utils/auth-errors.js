export function sendUnauthenticated(res, message = 'Authentication required') {
	return res.status(401).json({
		error: {
			code: 'UNAUTHENTICATED',
			message,
		},
	});
}

export function sendForbidden(res, message = 'Forbidden') {
	return res.status(403).json({
		error: {
			code: 'FORBIDDEN',
			message,
		},
	});
}
