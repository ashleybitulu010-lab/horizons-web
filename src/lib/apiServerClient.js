export const API_SERVER_URL = '/hcgi/api';

const apiServerClient = {
    fetch: async (url, options = {}) => {
        const headers = new Headers(options.headers || {});
        if (!headers.has('Accept')) {
            headers.set('Accept', 'application/json; charset=UTF-8');
        }
        if (options.body && !headers.has('Content-Type')) {
            headers.set('Content-Type', 'application/json; charset=UTF-8');
        }
        return await window.fetch(API_SERVER_URL + url, { ...options, headers });
    }
};

export default apiServerClient;

export { apiServerClient };
