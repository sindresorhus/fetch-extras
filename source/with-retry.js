import isNetworkError from './is-network-error.js';
import {
	copyFetchMetadata,
	delay,
	discardBody,
	getResolvedRequestHeaders,
	resolveRequestBodyOptions,
	waitForAbortable,
	withFetchSignal,
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

`withRetry()` resolves replayable request bodies once before the first attempt so later retries can reuse them. When a wrapper couples body resolution to header resolution, `withRetry()` preserves those resolved headers with the prepared body for every attempt. Other request-scoped header wrappers may still run again on each retry. If you need retry-time auth behavior, use a wrapper with explicit retry semantics such as `withTokenRefresh()`.

@param {object} [options]
@param {number} [options.retries=2] - Number of retries after the initial attempt. `retries: 2` means up to 3 total attempts.
@param {string[]} [options.methods=['GET','HEAD','PUT','DELETE','OPTIONS','TRACE']] - HTTP methods to retry.
@param {number[]} [options.statusCodes=[408,429,500,502,503,504]] - HTTP status codes that trigger a retry.
@param {number} [options.maxRetryAfter=60000] - Maximum `Retry-After` duration in milliseconds. If the server requests a longer delay, the response is returned without retrying.
@param {(attemptNumber: number) => number} [options.backoff] - Function returning the delay in milliseconds before a retry. Receives the 1-based attempt number that just failed.
@param {(context: {error?: Error, response?: Response, attemptNumber: number, retriesLeft: number}) => boolean | Promise<boolean>} [options.shouldRetry] - Called after built-in checks pass, before retrying. Return `false` to stop retrying.
@returns {(fetchFunction: typeof fetch) => typeof fetch} A function that accepts a fetch function and returns a wrapped fetch function with automatic retry.
*/
export function withRetry(options = {}) {
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

	return fetchFunction => {
		const shouldResolveHeadersForRetry = (request, fetchOptions, bodyResolvedFetchOptions) => bodyResolvedFetchOptions !== fetchOptions
			|| (request && fetchOptions.body !== undefined && fetchOptions.headers !== undefined);

		const getAttemptState = async ({urlOrRequest, fetchOptions, request, bodyResolvedFetchOptions}) => {
			let requestOptions = bodyResolvedFetchOptions;
			let attemptOptions = withFetchSignal(fetchFunction, urlOrRequest, requestOptions);

			if (shouldResolveHeadersForRetry(request, fetchOptions, bodyResolvedFetchOptions)) {
				const attemptSignal = attemptOptions.signal;
				requestOptions = withResolvedRequestHeaders(
					bodyResolvedFetchOptions,
					await getResolvedRequestHeaders(fetchFunction, urlOrRequest, {...fetchOptions, signal: attemptSignal}),
				);
				attemptOptions = attemptSignal === undefined
					? requestOptions
					: {...requestOptions, signal: attemptSignal};
			}

			return {
				attemptOptions,
				attemptSignal: attemptOptions.signal,
			};
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
			const {
				attemptOptions,
				attemptSignal,
			} = await getAttemptState({
				urlOrRequest,
				fetchOptions,
				request,
				bodyResolvedFetchOptions,
			});

			/* eslint-disable no-await-in-loop */
			for (let attempt = 0; attempt <= maximumAttempts; attempt++) {
				const isLastAttempt = attempt >= maximumAttempts;
				let response;
				try {
					response = await fetchFunction(urlOrRequest, attemptOptions);
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
	};
}
