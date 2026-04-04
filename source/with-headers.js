import {
	blockedRequestBodyHeaderNames,
	blockedDefaultHeaderNamesSymbol,
	copyFetchMetadata,
	deleteHeaders,
	inheritedRequestBodyHeaderNamesSymbol,
	resolveAuthorizationHeaderSymbol,
	resolveRequestHeadersSymbol,
	setHeaders,
} from './utilities.js';

/**
Wraps a fetch function to include default headers on every request. Per-call headers take priority over the defaults.

@param {typeof fetch} fetchFunction - The fetch function to wrap (usually the global `fetch`).
@param {HeadersInit} defaultHeaders - Default headers to include on every request.
@returns {typeof fetch} A wrapped fetch function that merges the default headers into every request.
*/
export function withHeaders(fetchFunction, defaultHeaders) {
	const defaultHeadersObject = new Headers(defaultHeaders);

	const getMergedHeaders = (urlOrRequest, options = {}) => {
		const merged = new Headers(defaultHeaders);
		const requestHeaders = urlOrRequest instanceof Request ? new Headers(urlOrRequest.headers) : undefined;
		const callHeaders = options.headers ? new Headers(options.headers) : undefined;
		const blockedDefaultHeaderNames = new Set([
			...(urlOrRequest?.[blockedDefaultHeaderNamesSymbol] ?? []),
			...(options[blockedDefaultHeaderNamesSymbol] ?? []),
			...(options.headers?.[blockedDefaultHeaderNamesSymbol] ?? []),
		]);

		deleteHeaders(merged, blockedDefaultHeaderNames);
		setHeaders(merged, requestHeaders);
		setHeaders(merged, callHeaders);

		return {
			merged,
			requestHeaders,
			callHeaders,
			blockedDefaultHeaderNames,
		};
	};

	const fetchWithHeaders = async (urlOrRequest, options = {}) => {
		const {
			merged,
			requestHeaders,
			callHeaders,
			blockedDefaultHeaderNames,
		} = getMergedHeaders(urlOrRequest, options);

		const shouldTreatRequestBodyHeadersAsInherited = requestHeaders
			&& options.body !== undefined
			&& !blockedRequestBodyHeaderNames.some(headerName => blockedDefaultHeaderNames.has(headerName));

		if (shouldTreatRequestBodyHeadersAsInherited) {
			const inheritedHeaderNames = blockedRequestBodyHeaderNames.filter(headerName =>
				requestHeaders.has(headerName)
				&& !callHeaders?.has(headerName)
				&& defaultHeadersObject.get(headerName) !== requestHeaders.get(headerName),
			);

			if (inheritedHeaderNames.length > 0) {
				options = {
					...options,
					[inheritedRequestBodyHeaderNamesSymbol]: inheritedHeaderNames,
				};
			}
		}

		return fetchFunction(urlOrRequest, {...options, headers: merged});
	};

	fetchWithHeaders[resolveAuthorizationHeaderSymbol] = function (urlOrRequest, options = {}) {
		const mergedHeaders = getMergedHeaders(urlOrRequest, options).merged;
		const authorization = mergedHeaders.get('Authorization');

		if (authorization !== null) {
			return authorization;
		}

		return fetchFunction[resolveAuthorizationHeaderSymbol]?.(urlOrRequest, {
			...options,
			headers: mergedHeaders,
		});
	};

	fetchWithHeaders[resolveRequestHeadersSymbol] = function (urlOrRequest, options = {}) {
		const mergedHeaders = getMergedHeaders(urlOrRequest, options).merged;

		return fetchFunction[resolveRequestHeadersSymbol]?.(urlOrRequest, {
			...options,
			headers: mergedHeaders,
		}) ?? mergedHeaders;
	};

	return copyFetchMetadata(fetchWithHeaders, fetchFunction);
}
