import Pocketbase from 'pocketbase';

const POCKETBASE_API_URL = '/hcgi/platform';

const pocketbaseClient = new Pocketbase(POCKETBASE_API_URL);

// Keep auth across tabs / PWA restarts; avoid cancelling refresh on navigation.
pocketbaseClient.autoCancellation(false);

export default pocketbaseClient;

export { pocketbaseClient };
