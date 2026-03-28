import {copyFetchMetadata} from './utilities.js';

/**
Wraps a fetch function to resolve relative URLs against a base URL. Only string-based relative URLs are resolved; absolute URLs and URL objects are passed through unchanged.

@param {typeof fetch} fetchFunction - The fetch function to wrap.
@param {URL | string} baseUrl - The base URL to resolve relative URLs against.
@returns {typeof fetch} A wrapped fetch function that resolves relative URLs against the base URL.
*/
export function withBaseUrl(fetchFunction, baseUrl) {
	const baseUrlString = baseUrl instanceof URL ? baseUrl.href : baseUrl;
	let baseUrlObject;

	const fetchWithBaseUrl = async (urlOrRequest, options = {}) => {
		if (typeof urlOrRequest !== 'string') {
			return fetchFunction(urlOrRequest, options);
		}

		if (!baseUrlObject) {
			try {
				baseUrlObject = new URL(baseUrlString);
			} catch (error) {
				throw new TypeError(`Invalid base URL: ${error.message}`);
			}
		}

		if (/^[a-z][a-z\d+\-.]*:/i.test(urlOrRequest)) {
			return fetchFunction(urlOrRequest, options);
		}

		if (urlOrRequest === '') {
			return fetchFunction(baseUrlString, options);
		}

		if (/^\/\/[^/]/.test(urlOrRequest) || /^[?#]/.test(urlOrRequest)) {
			return fetchFunction(new URL(urlOrRequest, baseUrlObject).href, options);
		}

		const baseUrlForPath = new URL(baseUrlObject);
		baseUrlForPath.search = '';
		baseUrlForPath.hash = '';

		if (!baseUrlForPath.pathname.endsWith('/')) {
			baseUrlForPath.pathname = `${baseUrlForPath.pathname}/`;
		}

		return fetchFunction(new URL(urlOrRequest.replace(/^\/+/, ''), baseUrlForPath).href, options);
	};

	return copyFetchMetadata(fetchWithBaseUrl, fetchFunction);
}
