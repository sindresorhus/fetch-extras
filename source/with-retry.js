import isNetworkError from './is-network-error.js';
import {
	copyFetchMetadata,
	delay,
	discardBody,
	getFetchSignal,
	getResolvedRequestHeaders,
	getRequestSignal,
	hasHeaders,
	requestSnapshot,
	resolveRequestBodyOptions,
	resolveRequestHeadersSymbol,
	resolveRequestUrl,
	waitForAbortable,
	withResolvedRequestHeaders,
} from './utilities.js';

const defaultRetriableMethods = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'TRACE']);
const defaultRetriableStatusCodes = new Set([408, 429, 500, 502, 503, 504]);

const defaultBackoff = attemptNumber =>
	Math.min(1000 * (2 ** (attemptNumber - 1)), 30_000) * (0.5 + (Math.random() * 0.5));

function parseRetryAfter(response) {
	const header = response.headers.get('retry-after')?.trim();
	if (!header) {
		return;
	}

	if (/^\d+$/.test(header)) {
		return Number(header) * 1000;
	}

	const date = Date.parse(header);
	if (!Number.isNaN(date)) {
		return date - Date.now();
	}
}

/**
Wraps a fetch function to automatically retry failed requests.

Retries on network errors and configurable HTTP status codes. Only retries idempotent methods by default (GET, HEAD, PUT, DELETE, OPTIONS, TRACE). Uses exponential backoff with jitter by default. Respects the `Retry-After` response header when present, and ignores malformed values by falling back to `backoff`.

When all retries are exhausted, the last response is returned (for HTTP status retries) or the last error is thrown (for network errors).

Requests with a one-shot body provided via `options.body`, such as a `ReadableStream` or AsyncIterable, are sent as-is and are not retried. Retrying those uploads would require buffering and would change wrapper composition semantics such as upload progress. Requests whose body comes from a bare `Request` object (no `options.body` override) are also not retried.

Retry replays the same logical request. If an inner wrapper resolves headers at request time, those resolved headers are kept stable for the retry batch instead of being recomputed on each attempt. If you need headers to change between attempts, use a wrapper with explicit retry-time semantics such as `withTokenRefresh()`, not generic retry.

@param {typeof fetch} fetchFunction - The fetch function to wrap (usually the global `fetch`).
@param {object} [options]
@param {number} [options.retries=2] - Number of retries after the initial attempt. `retries: 2` means up to 3 total attempts.
@param {string[]} [options.methods=['GET','HEAD','PUT','DELETE','OPTIONS','TRACE']] - HTTP methods to retry.
@param {number[]} [options.statusCodes=[408,429,500,502,503,504]] - HTTP status codes that trigger a retry.
@param {number} [options.maxRetryAfter=60000] - Maximum `Retry-After` duration in milliseconds. If the server requests a longer delay, the response is returned without retrying.
@param {(attemptNumber: number) => number} [options.backoff] - Function returning the delay in milliseconds before a retry. Receives the 1-based attempt number that just failed.
@param {(context: {error?: Error, response?: Response, attemptNumber: number, retriesLeft: number}) => boolean | Promise<boolean>} [options.shouldRetry] - Called after built-in checks pass, before retrying. Return `false` to stop retrying.
@returns {typeof fetch} A wrapped fetch function with automatic retry.
*/
export function withRetry(fetchFunction, options = {}) {
	const {
		retries = 2,
		methods = [...defaultRetriableMethods],
		statusCodes = [...defaultRetriableStatusCodes],
		maxRetryAfter = 60_000,
		backoff = defaultBackoff,
		shouldRetry = () => true,
	} = options;

	if (!Number.isInteger(retries) || retries < 0) {
		throw new TypeError('`retries` must be a non-negative integer.');
	}

	const retriableMethods = new Set(methods.map(method => method.toUpperCase()));
	const retriableStatusCodes = new Set(statusCodes);

	function isNonReplayableBody(body) {
		return body instanceof ReadableStream
			|| typeof body?.[Symbol.asyncIterator] === 'function';
	}

	function createRetryInput({request, fetchOptions, retryBaseOptions, urlOrRequest}) {
		if (!(request && fetchOptions.body !== undefined)) {
			return urlOrRequest;
		}

		return new Request(resolveRequestUrl(fetchFunction, request), {
			...requestSnapshot(request),
			headers: new Headers(retryBaseOptions.headers),
		});
	}

	const getRetryDelay = (response, attemptNumber) => {
		const retryAfter = parseRetryAfter(response);

		if (retryAfter !== undefined && retryAfter >= 0) {
			if (retryAfter > maxRetryAfter) {
				return; // Signal: don't retry
			}

			return retryAfter;
		}

		return backoff(attemptNumber);
	};

	const fetchWithRetry = async (urlOrRequest, fetchOptions = {}) => {
		const request = urlOrRequest instanceof Request ? urlOrRequest : undefined;
		const method = (fetchOptions.method ?? request?.method ?? 'GET').toUpperCase();

		if (!retriableMethods.has(method)) {
			return fetchFunction(urlOrRequest, fetchOptions);
		}

		const bodyResolvedFetchOptions = resolveRequestBodyOptions(fetchFunction, urlOrRequest, fetchOptions);
		const canRetryBody = !(request?.body && fetchOptions.body === undefined) && !isNonReplayableBody(bodyResolvedFetchOptions.body);
		const maximumAttempts = canRetryBody ? retries : 0;
		/*
		Boundary: retries are replaying the same logical request, so resolved headers from request-building wrappers must stay stable across attempts.
		Wrappers that intentionally change auth state between attempts, such as withTokenRefresh(), should own that behavior explicitly instead of depending on generic retry to rebuild headers.
		Still avoid calling resolveRequestHeaders() unless a wrapper actually provides it, because eagerly doing so would rerun outer wrappers like withHooks().
		*/
		const attemptSignal = getFetchSignal(fetchFunction, getRequestSignal(urlOrRequest, fetchOptions));
		const shouldResolveHeaders = bodyResolvedFetchOptions.body !== undefined || fetchFunction[resolveRequestHeadersSymbol] !== undefined;
		const requestHeaders = shouldResolveHeaders
			? await getResolvedRequestHeaders(fetchFunction, urlOrRequest, attemptSignal ? {...fetchOptions, signal: attemptSignal} : fetchOptions)
			: undefined;
		const hasResolvedHeaders = requestHeaders !== undefined && (request || fetchOptions.headers !== undefined || fetchFunction[resolveRequestHeadersSymbol] !== undefined || hasHeaders(requestHeaders));
		const resolvedHeaders = hasResolvedHeaders
			? requestHeaders
			: undefined;
		let currentOptionsBase = bodyResolvedFetchOptions;

		if (resolvedHeaders) {
			currentOptionsBase = withResolvedRequestHeaders(bodyResolvedFetchOptions, resolvedHeaders);
		}

		const currentAttemptOptions = attemptSignal
			? {...currentOptionsBase, signal: attemptSignal}
			: currentOptionsBase;
		const retryBaseOptions = resolvedHeaders === undefined
			? currentAttemptOptions
			: currentOptionsBase;
		const retryRequestInput = createRetryInput({
			request,
			fetchOptions,
			retryBaseOptions,
			urlOrRequest,
		});
		const retryOptions = attemptSignal && retryBaseOptions !== currentAttemptOptions
			? {...retryBaseOptions, signal: attemptSignal}
			: retryBaseOptions;

		/* eslint-disable no-await-in-loop */
		for (let attempt = 0; attempt <= maximumAttempts; attempt++) {
			const attemptOptions = attempt === 0 ? currentAttemptOptions : retryOptions;
			const isLastAttempt = attempt >= maximumAttempts;
			let response;
			try {
				response = await fetchFunction(
					attempt === 0 ? urlOrRequest : retryRequestInput,
					attemptOptions,
				);
			} catch (error) {
				if (isLastAttempt || !isNetworkError(error)) {
					throw error;
				}

				if (!await waitForAbortable(
					() => shouldRetry({error, attemptNumber: attempt + 1, retriesLeft: retries - attempt}),
					attemptSignal,
				)) {
					throw error;
				}

				await delay(backoff(attempt + 1), {signal: attemptSignal});
				continue;
			}

			if (!retriableStatusCodes.has(response.status) || isLastAttempt) {
				return response;
			}

			const retryDelay = getRetryDelay(response, attempt + 1);
			if (retryDelay === undefined) {
				return response;
			}

			let shouldRetryResponse;
			try {
				shouldRetryResponse = await waitForAbortable(
					() => shouldRetry({response, attemptNumber: attempt + 1, retriesLeft: retries - attempt}),
					attemptSignal,
				);
			} catch (error) {
				await discardBody(response.body);
				throw error;
			}

			if (!shouldRetryResponse) {
				return response;
			}

			await discardBody(response.body);
			await delay(retryDelay, {signal: attemptSignal});
		}
		/* eslint-enable no-await-in-loop */
	};

	return copyFetchMetadata(fetchWithRetry, fetchFunction);
}
