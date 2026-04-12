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

export function withHeaders(defaultHeaders) {
	const isFunction = typeof defaultHeaders === 'function';
	const staticDefaultHeaders = isFunction ? undefined : new Headers(defaultHeaders);
	const resolveDefaultHeaders = isFunction ? defaultHeaders : () => staticDefaultHeaders;

	return fetchFunction => {
		const getMergedHeaders = (urlOrRequest, resolvedDefaults, options = {}) => {
			const requestHeaders = urlOrRequest instanceof Request ? new Headers(urlOrRequest.headers) : undefined;
			const callHeaders = options.headers ? new Headers(options.headers) : undefined;
			const blockedDefaultHeaderNames = new Set([
				...(urlOrRequest?.[blockedDefaultHeaderNamesSymbol] ?? []),
				...(options[blockedDefaultHeaderNamesSymbol] ?? []),
				...(options.headers?.[blockedDefaultHeaderNamesSymbol] ?? []),
			]);
			const hasBlockedAllDefaultHeaders = blockedDefaultHeaderNames.has('*');
			const merged = hasBlockedAllDefaultHeaders ? new Headers() : new Headers(resolvedDefaults);

			deleteHeaders(merged, blockedDefaultHeaderNames);
			setHeaders(merged, requestHeaders);
			setHeaders(merged, callHeaders);

			return {
				hasBlockedAllDefaultHeaders,
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
				hasBlockedAllDefaultHeaders,
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
				const resolvedDefaultHeaders = hasBlockedAllDefaultHeaders ? new Headers() : new Headers(resolvedDefaults);
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
	};
}
