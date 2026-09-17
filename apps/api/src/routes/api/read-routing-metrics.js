import { getReadRoutingMetricsSnapshot } from '../../observability/read-routing-observability.js';

export default async function readRoutingMetrics(req, res) {
	res.json(getReadRoutingMetricsSnapshot());
}
