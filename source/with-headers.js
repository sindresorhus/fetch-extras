import {
	blockedRequestBodyHeaderNames,
	blockedDefaultHeaderNamesSymbol,
	inheritedRequestBodyHeaderNamesSymbol,
} from './utilities.js';

/**
Wraps a fetch function to include default headers on every request. Per-call headers take priority over the defaults.

@param {typeof fetch} fetchFunction - The fetch function to wrap.
@param {HeadersInit} defaultHeaders - Default headers to include on every request.
@returns {typeof fetch} A wrapped fetch function that merges the default headers into every request.
*/
export function withHeaders(fetchFunction, defaultHeaders) {
	return async (urlOrRequest, options = {}) => {
		const merged = new Headers(defaultHeaders);
		const requestHeaders = urlOrRequest instanceof Request ? new Headers(urlOrRequest.headers) : undefined;
		const callHeaders = options.headers ? new Headers(options.headers) : undefined;
		const blockedDefaultHeaderNames = new Set([
			...(urlOrRequest?.[blockedDefaultHeaderNamesSymbol] ?? []),
			...(options[blockedDefaultHeaderNamesSymbol] ?? []),
			...(options.headers?.[blockedDefaultHeaderNamesSymbol] ?? []),
		]);

		for (const headerName of blockedDefaultHeaderNames) {
			merged.delete(headerName);
		}

		if (requestHeaders) {
			for (const [key, value] of requestHeaders) {
				merged.set(key, value);
			}
		}

		if (callHeaders) {
			for (const [key, value] of callHeaders) {
				merged.set(key, value);
			}
		}

		if (requestHeaders && options.body !== undefined) {
			const inheritedHeaderNames = blockedRequestBodyHeaderNames.filter(headerName => requestHeaders.has(headerName) && !callHeaders?.has(headerName));

			if (inheritedHeaderNames.length > 0) {
				options = {
					...options,
					[inheritedRequestBodyHeaderNamesSymbol]: inheritedHeaderNames,
				};
			}
		}

		return fetchFunction(urlOrRequest, {...options, headers: merged});
	};
}
