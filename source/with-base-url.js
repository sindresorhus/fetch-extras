import {copyFetchMetadata, resolveRequestUrlSymbol} from './utilities.js';

/**
Wraps a fetch function to resolve relative URLs against a base URL. Only string-based relative URLs are resolved; absolute URLs and URL objects are passed through unchanged. Protocol-relative URLs are rejected.

@param {URL | string} baseUrl - The base URL to resolve relative URLs against.
@returns {(fetchFunction: typeof fetch) => typeof fetch}
*/
export function withBaseUrl(baseUrl) {
	const baseUrlString = baseUrl instanceof URL ? baseUrl.href : baseUrl;

	return fetchFunction => {
		let baseUrlObject;

		const getBaseUrlObject = () => {
			if (!baseUrlObject) {
				try {
					baseUrlObject = new URL(baseUrlString);
				} catch (error) {
					throw new TypeError(`Invalid base URL: ${error.message}`);
				}
			}

			return baseUrlObject;
		};

		const resolveRequestUrl = urlOrRequest => {
			if (typeof urlOrRequest !== 'string') {
				return urlOrRequest instanceof Request ? urlOrRequest.url : String(urlOrRequest);
			}

			if (/^[a-z][a-z\d+\-.]*:/i.test(urlOrRequest)) {
				return urlOrRequest;
			}

			if (urlOrRequest === '') {
				return new URL(urlOrRequest, getBaseUrlObject()).href;
			}

			if (/^\/\/[^/]/.test(urlOrRequest)) {
				throw new TypeError('Protocol-relative URLs are unsupported.');
			}

			if (/^[?#]/.test(urlOrRequest)) {
				return new URL(urlOrRequest, getBaseUrlObject()).href;
			}

			const baseUrlForPath = new URL(getBaseUrlObject());
			baseUrlForPath.search = '';
			baseUrlForPath.hash = '';

			if (!baseUrlForPath.pathname.endsWith('/')) {
				baseUrlForPath.pathname = `${baseUrlForPath.pathname}/`;
			}

			return new URL(urlOrRequest.replace(/^\/+/, ''), baseUrlForPath).href;
		};

		const fetchWithBaseUrl = async (urlOrRequest, options = {}) => fetchFunction(
			typeof urlOrRequest === 'string' ? resolveRequestUrl(urlOrRequest) : urlOrRequest,
			options,
		);

		fetchWithBaseUrl[resolveRequestUrlSymbol] = resolveRequestUrl;

		return copyFetchMetadata(fetchWithBaseUrl, fetchFunction);
	};
}
