import isNetworkError from 'is-network-error';
import {
	blockedRequestBodyHeaderNames,
	copyFetchMetadata,
	delay,
	inheritedRequestBodyHeaderNamesSymbol,
	resolveRequestUrl,
	timeoutDurationSymbol,
} from './utilities.js';

const defaultRetriableMethods = new Set(['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'TRACE']);
const defaultRetriableStatusCodes = new Set([408, 429, 500, 502, 503, 504]);

const defaultBackoff = attemptNumber =>
	Math.min(1000 * (2 ** (attemptNumber - 1)), 30_000) * (0.5 + (Math.random() * 0.5));

function parseRetryAfter(response) {
	const header = response.headers.get('retry-after');
	if (!header) {
		return;
	}

	const seconds = Number(header);
	if (Number.isFinite(seconds)) {
		return seconds * 1000;
	}

	const date = Date.parse(header);
	if (!Number.isNaN(date)) {
		return date - Date.now();
	}
}

/**
Wraps a fetch function to automatically retry failed requests.

Retries on [network errors](https://github.com/sindresorhus/is-network-error) and configurable HTTP status codes. Only retries idempotent methods by default (GET, HEAD, PUT, DELETE, OPTIONS, TRACE). Uses exponential backoff with jitter by default. Respects the `Retry-After` response header when present.

When all retries are exhausted, the last response is returned (for HTTP status retries) or the last error is thrown (for network errors).

Requests with a one-shot body provided via `options.body`, such as a `ReadableStream` or AsyncIterable, are sent as-is and are not retried. Retrying those uploads would require buffering and would change wrapper composition semantics such as upload progress. Requests whose body comes from a bare `Request` object (no `options.body` override) are also not retried.

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

	const getRequestHeaders = (request, options) => {
		const requestHeaders = new Headers(request?.headers);
		const callHeaders = new Headers(options.headers);

		if (request && options.body !== undefined) {
			for (const headerName of blockedRequestBodyHeaderNames) {
				requestHeaders.delete(headerName);
			}

			for (const headerName of options[inheritedRequestBodyHeaderNamesSymbol] ?? []) {
				callHeaders.delete(headerName);
			}
		}

		for (const [key, value] of callHeaders) {
			requestHeaders.set(key, value);
		}

		return requestHeaders;
	};

	const requestSnapshot = request => ({
		method: request.method,
		referrer: request.referrer,
		referrerPolicy: request.referrerPolicy,
		mode: request.mode,
		credentials: request.credentials,
		cache: request.cache,
		redirect: request.redirect,
		integrity: request.integrity,
		keepalive: request.keepalive,
		signal: request.signal,
		duplex: request.duplex,
		priority: request.priority,
	});

	const getAttemptSignal = providedSignal => {
		const timeoutDuration = fetchFunction[timeoutDurationSymbol];
		const timeoutSignal = timeoutDuration === undefined ? undefined : AbortSignal.timeout(timeoutDuration);

		if (providedSignal) {
			return timeoutSignal ? AbortSignal.any([providedSignal, timeoutSignal]) : providedSignal;
		}

		return timeoutSignal;
	};

	const discardBody = async body => {
		try {
			await body?.cancel?.();
		} catch {}
	};

	const isNonReplayableBody = body =>
		body instanceof ReadableStream
		|| typeof body?.[Symbol.asyncIterator] === 'function';

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

		const providedSignal = fetchOptions.signal ?? request?.signal;
		const baseOptions = request && fetchOptions.body !== undefined
			? {...fetchOptions, headers: getRequestHeaders(request, fetchOptions)}
			: fetchOptions;
		const requestInput = request && fetchOptions.body !== undefined
			? new Request(resolveRequestUrl(fetchFunction, request), {
				...requestSnapshot(request),
				headers: new Headers(baseOptions.headers),
			})
			: urlOrRequest;
		const attemptSignal = getAttemptSignal(providedSignal);
		const currentOptions = attemptSignal ? {...baseOptions, signal: attemptSignal} : baseOptions;
		const canRetryBody = !(request?.body && fetchOptions.body === undefined) && !isNonReplayableBody(fetchOptions.body);
		const maximumAttempts = canRetryBody ? retries : 0;

		/* eslint-disable no-await-in-loop */
		for (let attempt = 0; attempt <= maximumAttempts; attempt++) {
			const isLastAttempt = attempt >= maximumAttempts;
			let response;
			try {
				response = await fetchFunction(requestInput, currentOptions);
			} catch (error) {
				if (isLastAttempt || !isNetworkError(error)) {
					throw error;
				}

				if (!await shouldRetry({error, attemptNumber: attempt + 1, retriesLeft: retries - attempt})) {
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

			if (!await shouldRetry({response, attemptNumber: attempt + 1, retriesLeft: retries - attempt})) {
				return response;
			}

			await discardBody(response.body);
			await delay(retryDelay, {signal: attemptSignal});
		}
		/* eslint-enable no-await-in-loop */
	};

	return copyFetchMetadata(fetchWithRetry, fetchFunction);
}
