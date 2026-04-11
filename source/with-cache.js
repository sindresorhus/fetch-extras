import {
	copyFetchMetadata,
	defersFetchStartSymbol,
	getRequestReplayHeaders,
	hasHeaders,
	hasResolvedRequestHeaders,
	notifyFetchStartSymbol,
	resolveRequestHeadersSymbol,
	resolveRequestUrl,
	withFetchSignal,
	withResolvedRequestHeaders,
} from './utilities.js';

const nonInvalidatingMethods = new Set(['HEAD', 'OPTIONS', 'TRACE']);
const defaultCacheableRequestState = (() => {
	const request = new Request('https://example.com');

	return {
		credentials: request.credentials,
		integrity: request.integrity,
		mode: request.mode,
		redirect: request.redirect,
		referrer: request.referrer,
		referrerPolicy: request.referrerPolicy,
	};
})();

function hasNonDefaultRequestState(urlOrRequest, options) {
	const request = urlOrRequest instanceof Request ? urlOrRequest : undefined;

	for (const [key, defaultValue] of Object.entries(defaultCacheableRequestState)) {
		if ((options[key] ?? request?.[key] ?? defaultValue) !== defaultValue) {
			return true;
		}
	}

	return false;
}

async function getRequestHeaders(fetchFunction, urlOrRequest, fetchOptions) {
	const requestReplayHeaders = getRequestReplayHeaders(urlOrRequest, fetchOptions);

	if (hasResolvedRequestHeaders(urlOrRequest, fetchOptions)) {
		return requestReplayHeaders;
	}

	const requestHeaders = await fetchFunction[resolveRequestHeadersSymbol]?.(urlOrRequest, fetchOptions);
	return requestHeaders ?? requestReplayHeaders;
}

function getRequestContext(fetchFunction, urlOrRequest, options) {
	const fetchOptions = withFetchSignal(fetchFunction, urlOrRequest, options);

	return {
		method: (options.method ?? (urlOrRequest instanceof Request ? urlOrRequest.method : 'GET')).toUpperCase(),
		url: resolveRequestUrl(fetchFunction, urlOrRequest),
		cacheMode: options.cache ?? (urlOrRequest instanceof Request ? urlOrRequest.cache : undefined),
		signal: fetchOptions.signal,
		fetchOptions,
	};
}

async function getGetRequestContext(fetchFunction, urlOrRequest, options, requestContext) {
	const hasRequestHeaderResolver = fetchFunction[resolveRequestHeadersSymbol] !== undefined;
	const headers = new Headers(await getRequestHeaders(fetchFunction, urlOrRequest, requestContext.fetchOptions));
	const fetchOptions = hasRequestHeaderResolver
		? withResolvedRequestHeaders(requestContext.fetchOptions, headers)
		: requestContext.fetchOptions;

	return {
		...requestContext,
		isRangedRequest: headers.has('range'),
		hasRequestHeaders: hasHeaders(headers),
		hasNonDefaultRequestState: hasNonDefaultRequestState(urlOrRequest, options),
		fetchOptions,
	};
}

function getGeneration(cache, state, url) {
	return cache.get(url)?.generation ?? state.get(url)?.generation ?? 0;
}

function getState(state, url) {
	let urlState = state.get(url);

	if (!urlState) {
		urlState = {
			generation: 0,
			pendingGetCount: 0,
			pendingInvalidationCount: 0,
		};
		state.set(url, urlState);
	}

	return urlState;
}

function cleanupState(cache, state, url) {
	const urlState = state.get(url);

	if (
		urlState
		&& !cache.has(url)
		&& urlState.pendingGetCount === 0
		&& urlState.pendingInvalidationCount === 0
	) {
		state.delete(url);
	}
}

async function trackPending(resources, url, counterName, callback) {
	const urlState = getState(resources.state, url);
	urlState[counterName]++;

	try {
		return await callback(urlState);
	} finally {
		urlState[counterName]--;
		cleanupState(resources.cache, resources.state, url);
	}
}

function evictExpiredEntries(cache, state, retainKey) {
	const currentTime = performance.now();

	for (const [key, entry] of cache) {
		if (entry.expiry <= currentTime && (key !== retainKey || !entry.response)) {
			cache.delete(key);
			cleanupState(cache, state, key);
		}
	}

	return currentTime;
}

function getCachedResponse({entry, cacheMode, currentTime, isRangedRequest}) {
	if (!entry?.response || isRangedRequest || cacheMode === 'no-store') {
		return;
	}

	if (cacheMode === 'only-if-cached' || cacheMode === 'force-cache') {
		return entry.response.clone();
	}

	if (cacheMode !== 'reload' && cacheMode !== 'no-cache' && currentTime < entry.expiry) {
		return entry.response.clone();
	}
}

export function withCache({ttl}) {
	if (typeof ttl !== 'number' || ttl <= 0 || !Number.isFinite(ttl)) {
		throw new TypeError('`ttl` must be a positive finite number.');
	}

	return fetchFunction => {
		// Cache state is per wrapped fetch function, not per curried wrapper factory.
		const cache = new Map();
		const state = new Map();
		const resources = {cache, state};

		const fetchWithCache = async (urlOrRequest, options = {}) => {
			const {method, url, cacheMode, signal, fetchOptions} = getRequestContext(fetchFunction, urlOrRequest, options);

			// Non-GET requests pass through; unsafe methods also invalidate cache
			if (method !== 'GET') {
				if (nonInvalidatingMethods.has(method)) {
					return fetchFunction(urlOrRequest, fetchOptions);
				}

				signal?.throwIfAborted();

				const generation = getGeneration(cache, state, url);
				return trackPending(resources, url, 'pendingInvalidationCount', async urlState => {
					let didInvalidate = false;
					const invalidate = () => {
						if (didInvalidate) {
							return;
						}

						didInvalidate = true;
						cache.delete(url);
						urlState.generation = generation + 1;
					};

					if (!fetchFunction[defersFetchStartSymbol]) {
						invalidate();
						return fetchFunction(urlOrRequest, fetchOptions);
					}

					return fetchFunction(urlOrRequest, {...fetchOptions, [notifyFetchStartSymbol]: invalidate});
				});
			}

			const requestContext = {
				method,
				url,
				cacheMode,
				signal,
				fetchOptions,
			};
			const generation = getGeneration(cache, state, url);
			const {
				isRangedRequest,
				hasRequestHeaders,
				hasNonDefaultRequestState,
				fetchOptions: fetchOptionsWithHeaders,
			} = await getGetRequestContext(fetchFunction, urlOrRequest, options, requestContext);
			const retainStaleEntry = cacheMode === 'force-cache' || cacheMode === 'only-if-cached';
			const currentTime = evictExpiredEntries(cache, state, retainStaleEntry ? url : undefined);
			const isCacheableRequest = !isRangedRequest && !hasRequestHeaders && !hasNonDefaultRequestState;

			signal?.throwIfAborted();

			const entry = cache.get(url);
			const cachedResponse = isCacheableRequest
				? getCachedResponse({
					entry,
					cacheMode,
					currentTime,
					isRangedRequest,
				})
				: undefined;
			if (cachedResponse) {
				return cachedResponse;
			}

			if (cacheMode === 'only-if-cached') {
				return new Response(undefined, {status: 504, statusText: 'Gateway Timeout'});
			}

			return trackPending(resources, url, 'pendingGetCount', async () => {
				const response = await fetchFunction(urlOrRequest, fetchOptionsWithHeaders);
				const isPartialResponse = response.status === 206;

				// Only cache successful responses.
				if (
					response.ok
					&& isCacheableRequest
					&& !isPartialResponse
					&& cacheMode !== 'no-store'
					&& generation === getGeneration(cache, state, url)
				) {
					cache.set(url, {
						generation,
						response: response.clone(),
						expiry: performance.now() + ttl,
					});
				}

				return response;
			});
		};

		return copyFetchMetadata(fetchWithCache, fetchFunction);
	};
}
