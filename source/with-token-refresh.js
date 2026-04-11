import {
	copyFetchMetadata,
	discardBody,
	getFetchSignal,
	getRequestSignal,
	hasHeaders,
	resolveRequestBodyOptions,
	resolveRequestHeadersSymbol,
	resolveRequestHeaders,
	withResolvedRequestHeaders,
} from './utilities.js';

/**
Wraps a fetch function to automatically refresh the token and retry the request on a `401 Unauthorized` response.

Concurrent 401 responses that overlap while a refresh is still pending share a single `refreshToken` call when they have the same effective `Authorization` header, preventing token invalidation races across requests for the same auth context. Requests with different effective `Authorization` headers refresh separately.

@param {typeof fetch} fetchFunction - The fetch function to wrap (usually the global `fetch`).
@param {object} options
@param {() => string | Promise<string>} options.refreshToken - Called when a 401 response is received. Should return the new token string.
@returns {typeof fetch} A wrapped fetch function that retries once with a refreshed `Authorization: Bearer <token>` header on 401 responses.
*/
export function withTokenRefresh(fetchFunction, {refreshToken}) {
	/*
	Boundary: this wrapper only deduplicates overlapping refreshes.
	It does not try to remember a "current" token or reuse a settled refresh result for late 401s.
	If a request reaches the 401 path after the shared refresh has already settled, it starts a new refresh.
	This smaller contract is intentional because it keeps the state model predictable and avoids stale-token reuse.
	*/
	const refreshEntries = new Map();
	const getAbortReason = signal => signal?.reason ?? new DOMException('This operation was aborted', 'AbortError');

	const withSignal = (options, signal) => signal ? {...options, signal} : options;
	const isAsyncIterable = value => value !== undefined && !(value instanceof ReadableStream) && typeof value[Symbol.asyncIterator] === 'function';
	const discardHiddenBodies = async (response, retryBody) => {
		await discardBody(response?.body);
		await discardBody(retryBody);
	};

	const returnResponse = async (response, retryBody) => {
		await discardBody(retryBody);
		return response;
	};

	const clearRefreshEntry = (authorization, refreshEntry) => {
		if (refreshEntries.get(authorization) === refreshEntry) {
			refreshEntries.delete(authorization);
		}
	};

	const createRefreshEntry = authorization => {
		const refreshEntry = {
			waiterCount: 0,
		};

		refreshEntry.promise = (async () => {
			try {
				return await refreshToken();
			} finally {
				clearRefreshEntry(authorization, refreshEntry);
			}
		})();

		refreshEntries.set(authorization, refreshEntry);
		return refreshEntry;
	};

	const getToken = async (authorization, signal) => {
		if (signal?.aborted) {
			throw getAbortReason(signal);
		}

		let refreshEntry = refreshEntries.get(authorization);

		if (!refreshEntry || refreshEntry.waiterCount === 0) {
			/*
			Algorithm: one pending refresh promise per effective Authorization value.
			Requests that hit 401 while this promise is pending reuse it.
			If every waiter gives up on a still-pending refresh, the next same-auth request starts a fresh attempt instead of inheriting an abandoned hung refresh.
			*/
			refreshEntry = createRefreshEntry(authorization);
		}

		refreshEntry.waiterCount++;

		if (!signal) {
			try {
				return await refreshEntry.promise;
			} finally {
				refreshEntry.waiterCount--;
			}
		}

		return new Promise((resolve, reject) => {
			let didFinish = false;

			const finish = () => {
				if (didFinish) {
					return;
				}

				didFinish = true;
				refreshEntry.waiterCount--;
				signal.removeEventListener('abort', abort);
			};

			const abort = () => {
				finish();
				// Preserve the caller's original abort reason so this still matches fetch cancellation semantics.
				reject(getAbortReason(signal));
			};

			signal.addEventListener('abort', abort, {once: true});
			(async () => {
				try {
					resolve(await refreshEntry.promise);
				} catch (error) {
					reject(error);
				} finally {
					finish();
				}
			})();
		});
	};

	const fetchWithTokenRefresh = async (urlOrRequest, options = {}) => {
		const request = urlOrRequest instanceof Request
			? urlOrRequest
			: undefined;
		const bodyResolvedOptions = resolveRequestBodyOptions(fetchFunction, urlOrRequest, options);
		const signal = getFetchSignal(fetchFunction, getRequestSignal(urlOrRequest, options));
		const requestHeaders = new Headers(await resolveRequestHeaders(fetchFunction, urlOrRequest, options));
		const hasRequestHeaderResolver = fetchFunction[resolveRequestHeadersSymbol] !== undefined;
		const hasInitialHeaders = request
			|| options.headers !== undefined
			|| hasRequestHeaderResolver
			|| hasHeaders(requestHeaders);
		let requestOptions = bodyResolvedOptions;

		if (hasInitialHeaders) {
			requestOptions = withResolvedRequestHeaders(bodyResolvedOptions, requestHeaders);
		}

		let retryBody = bodyResolvedOptions.body;
		let hasRetryBody = false;

		if (bodyResolvedOptions.body instanceof ReadableStream) {
			/*
			`options.body` is an explicit override, so replaying it once is worth the memory cost for the single retry path.
			Boundary: outer wrappers only see the initial call into withTokenRefresh, not the internal retry.
			If callers need per-attempt upload progress, withUploadProgress must be composed inside withTokenRefresh so both sends go through it.
			*/
			const [initialBody, clonedBody] = bodyResolvedOptions.body.tee();
			requestOptions = {...requestOptions, body: initialBody};

			retryBody = clonedBody;
			hasRetryBody = true;
		}

		requestOptions = withSignal(requestOptions, signal);
		const authorization = requestHeaders.get('Authorization');
		let response;

		try {
			response = await fetchFunction(urlOrRequest, requestOptions);
		} catch (error) {
			await discardBody(retryBody);
			throw error;
		}

		if (response.status !== 401) {
			return returnResponse(response, retryBody);
		}

		// Boundary: bare Request bodies are not retried because cloning every Request up front would penalize successful uploads too.
		if (
			(request?.body && options.body === undefined)
			|| isAsyncIterable(bodyResolvedOptions.body)
		) {
			return returnResponse(response, retryBody);
		}

		let token;

		try {
			token = await getToken(authorization, signal);
		} catch (error) {
			// Refresh failures fall back to the original 401, but abort-driven failures must still reject.
			if (signal?.aborted) {
				// The 401 response is also hidden from the caller on this path, so abort cleanup must release both unread bodies.
				await discardHiddenBodies(response, retryBody);
				throw error;
			}

			return returnResponse(response, retryBody);
		}

		const headers = new Headers(requestHeaders);

		// The original 401 response is never exposed once we retry, so release its body before issuing the second request.
		await discardHiddenBodies(response);

		// Retry state stays minimal: replace only Authorization and rerun the same request shape once.
		headers.set('Authorization', `Bearer ${token}`);
		const retryOptions = hasRetryBody
			? withResolvedRequestHeaders({...bodyResolvedOptions, body: retryBody}, headers)
			: withResolvedRequestHeaders(bodyResolvedOptions, headers);
		return fetchFunction(urlOrRequest, withSignal(retryOptions, signal));
	};

	return copyFetchMetadata(fetchWithTokenRefresh, fetchFunction);
}
