import {blockedRequestBodyHeaderNames, copyFetchMetadata, timeoutDurationSymbol} from './utilities.js';

/**
Wraps a fetch function to automatically refresh the token and retry the request on a `401 Unauthorized` response.

@param {typeof fetch} fetchFunction - The fetch function to wrap (usually the global `fetch`).
@param {object} options
@param {() => Promise<string>} options.refreshToken - Called when a 401 response is received. Should return the new token string.
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

	const getEffectiveSignal = providedSignal => {
		// Timeout support here is intentionally narrow: we only honor the internal timeout metadata that wrapper builders forward.
		const timeoutDuration = fetchFunction[timeoutDurationSymbol];
		const timeoutSignal = timeoutDuration === undefined ? undefined : AbortSignal.timeout(timeoutDuration);

		if (providedSignal) {
			return timeoutSignal ? AbortSignal.any([providedSignal, timeoutSignal]) : providedSignal;
		}

		return timeoutSignal;
	};

	const withSignal = (options, signal) => signal ? {...options, signal} : options;
	const discardBody = async body => {
		try {
			await body?.cancel?.();
		} catch {}
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

	const getRequestHeaders = (request, options) => {
		const requestHeaders = new Headers(request?.headers);

		if (request && options.body !== undefined) {
			// A replacement body must not inherit body-specific headers from the original Request.
			for (const headerName of blockedRequestBodyHeaderNames) {
				requestHeaders.delete(headerName);
			}
		}

		if (options.headers) {
			for (const [key, value] of new Headers(options.headers)) {
				requestHeaders.set(key, value);
			}
		}

		return requestHeaders;
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
		const signal = getEffectiveSignal(options.signal ?? request?.signal);
		const requestHeaders = getRequestHeaders(request, options);
		let initialOptions = request
			? {...options, headers: requestHeaders}
			: options;
		let retryBody = options.body;
		let hasRetryBody = false;

		if (options.body instanceof ReadableStream) {
			/*
			`options.body` is an explicit override, so replaying it once is worth the memory cost for the single retry path.
			Boundary: outer wrappers only see the initial call into withTokenRefresh, not the internal retry.
			If callers need per-attempt upload progress, withUploadProgress must be composed inside withTokenRefresh so both sends go through it.
			*/
			const [initialBody, clonedBody] = options.body.tee();
			initialOptions = {...initialOptions, body: initialBody};

			retryBody = clonedBody;
			hasRetryBody = true;
		}

		initialOptions = withSignal(initialOptions, signal);
		const authorization = requestHeaders.get('Authorization');
		let response;

		try {
			response = await fetchFunction(urlOrRequest, initialOptions);
		} catch (error) {
			await discardBody(retryBody);
			throw error;
		}

		if (response.status !== 401) {
			return returnResponse(response, retryBody);
		}

		// Boundary: bare Request bodies are not retried because cloning every Request up front would penalize successful uploads too.
		if (request?.body && options.body === undefined) {
			return returnResponse(response, retryBody);
		}

		let token;

		try {
			token = await getToken(authorization, signal);
		} catch (error) {
			// Refresh failures fall back to the original 401, but abort-driven failures must still reject.
			if (signal?.aborted) {
				await discardBody(retryBody);
				throw error;
			}

			return returnResponse(response, retryBody);
		}

		const headers = new Headers(requestHeaders);

		// The original 401 response is never exposed once we retry, so release its body before issuing the second request.
		await discardBody(response.body);

		// Retry state stays minimal: replace only Authorization and rerun the same request shape once.
		headers.set('Authorization', `Bearer ${token}`);
		const retryOptions = hasRetryBody
			? {...options, body: retryBody, headers}
			: {...options, headers};
		return fetchFunction(urlOrRequest, withSignal(retryOptions, signal));
	};

	return copyFetchMetadata(fetchWithTokenRefresh, fetchFunction);
}
