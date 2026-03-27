import {blockedDefaultHeaderNamesSymbol} from './utilities.js';

/**
Wraps a fetch function to include default headers on every request. Per-call headers take priority over the defaults.

@param {typeof fetch} fetchFunction - The fetch function to wrap.
@param {HeadersInit} defaultHeaders - Default headers to include on every request.
@returns {typeof fetch} A wrapped fetch function that merges the default headers into every request.
*/
export function withHeaders(fetchFunction, defaultHeaders) {
	return async (urlOrRequest, options = {}) => {
		const merged = new Headers(defaultHeaders);
		const blockedDefaultHeaderNames = new Set([
			...(urlOrRequest?.[blockedDefaultHeaderNamesSymbol] ?? []),
			...(options[blockedDefaultHeaderNamesSymbol] ?? []),
			...(options.headers?.[blockedDefaultHeaderNamesSymbol] ?? []),
		]);

		for (const headerName of blockedDefaultHeaderNames) {
			merged.delete(headerName);
		}

		if (urlOrRequest instanceof Request) {
			for (const [key, value] of urlOrRequest.headers) {
				merged.set(key, value);
			}
		}

		if (options.headers) {
			for (const [key, value] of new Headers(options.headers)) {
				merged.set(key, value);
			}
		}

		return fetchFunction(urlOrRequest, {...options, headers: merged});
	};
}
