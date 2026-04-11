import {
	blockedRequestBodyHeaderNames,
	blockedDefaultHeaderNamesSymbol,
	copyFetchMetadata,
	deleteHeaders,
	getRequestSignal,
	hasResolvedRequestHeaders,
	inheritedRequestBodyHeaderNamesSymbol,
	resolveRequestHeadersSymbol,
	setHeaders,
	waitForAbortable,
} from './utilities.js';

/**
Returns a wrapped fetch function that includes default headers on every request. Per-call headers take priority over the defaults, so you can always override a default on a specific request.

Can be combined with other `with*` functions.

@param {typeof fetch} fetchFunction - The fetch function to wrap (usually the global `fetch`).
@param {HeadersInit | (() => HeadersInit | Promise<HeadersInit>)} defaultHeaders - Default headers to include on every request. Accepts a plain object, a `Headers` instance, an array of `[name, value]` tuples, or a function that returns any of these (sync or async). When a function is given, it is called on every request, which is useful for headers that need to be resolved at request time (for example, reading an auth token from storage).
@returns {typeof fetch} A wrapped fetch function that merges the default headers into every request.

The header function does not receive the request URL or options. If you need headers that vary per request, use `withHooks` with a `beforeRequest` hook instead.
Function-based defaults are request-scoped, not sequence-scoped. Each new wrapped fetch call resolves them again. Wrappers such as `withRetry()` and `paginate()` call into `withHeaders()` separately for each attempt or page, so the header function can run again for each one.
*/
export function withHeaders(fetchFunction, defaultHeaders) {
	const isFunction = typeof defaultHeaders === 'function';
	const staticDefaultHeaders = isFunction ? undefined : new Headers(defaultHeaders);
	const resolveDefaultHeaders = isFunction ? defaultHeaders : () => staticDefaultHeaders;
	const getMergedHeaders = (urlOrRequest, resolvedDefaults, options = {}) => {
		const merged = new Headers(resolvedDefaults);
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

	const resolveMergedHeaderState = async (urlOrRequest, options = {}) => {
		const resolvedDefaults = isFunction
			? await waitForAbortable(resolveDefaultHeaders, getRequestSignal(urlOrRequest, options))
			: staticDefaultHeaders;

		return {
			resolvedDefaults,
			...getMergedHeaders(urlOrRequest, resolvedDefaults, options),
		};
	};

	const fetchWithHeaders = async (urlOrRequest, options = {}) => {
		if (hasResolvedRequestHeaders(urlOrRequest, options)) {
			return fetchFunction(urlOrRequest, options);
		}

		const {
			resolvedDefaults,
			merged,
			requestHeaders,
			callHeaders,
			blockedDefaultHeaderNames,
		} = await resolveMergedHeaderState(urlOrRequest, options);

		const shouldTreatRequestBodyHeadersAsInherited = requestHeaders
			&& options.body !== undefined
			&& !blockedRequestBodyHeaderNames.some(headerName => blockedDefaultHeaderNames.has(headerName));

		if (shouldTreatRequestBodyHeadersAsInherited) {
			const resolvedDefaultHeaders = new Headers(resolvedDefaults);
			const inheritedHeaderNames = blockedRequestBodyHeaderNames.filter(headerName =>
				requestHeaders.has(headerName)
				&& !callHeaders?.has(headerName)
				&& resolvedDefaultHeaders.get(headerName) !== requestHeaders.get(headerName),
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

	fetchWithHeaders[resolveRequestHeadersSymbol] = async function (urlOrRequest, options = {}) {
		const {merged: mergedHeaders} = await resolveMergedHeaderState(urlOrRequest, options);

		return fetchFunction[resolveRequestHeadersSymbol]?.(urlOrRequest, {
			...options,
			headers: mergedHeaders,
		}) ?? mergedHeaders;
	};

	return copyFetchMetadata(fetchWithHeaders, fetchFunction);
}
