/**
Wraps a fetch function to automatically retry failed requests.

Retries on network errors and configurable HTTP status codes. Only retries idempotent methods by default (GET, HEAD, PUT, DELETE, OPTIONS, TRACE). Uses exponential backoff with jitter by default. Respects the `Retry-After` response header when present, and ignores malformed values by falling back to `backoff`.

POST and PATCH are not retried by default because they are not idempotent. Add them to `methods` if your endpoints are safe to retry.

When all retries are exhausted, the last response is returned (for HTTP status retries) or the last error is thrown (for network errors).

In documented `pipeline()` order, place `withRetry` before `withHttpError` so it sees raw responses and can check status codes.

Do not consume the `response` body inside `shouldRetry`. If you need to inspect the body, clone the response first.

Requests with a one-shot body provided via `options.body`, such as a `ReadableStream` or AsyncIterable, are sent as-is and are not retried. Retrying those uploads would require buffering and would change wrapper composition semantics such as upload progress. Requests whose body comes from a bare `Request` object (no `options.body` override) are also not retried.

`withRetry()` resolves replayable request bodies once before the first attempt so later retries can reuse them. When a wrapper couples body resolution to header resolution, `withRetry()` preserves those resolved headers with the prepared body for every attempt. Other request-scoped header wrappers may still run again on each retry.

If you need retry-time auth behavior, use a wrapper with explicit retry semantics such as `withTokenRefresh()`.

@param options - Retry configuration.
@returns A wrapper that takes a fetch function and returns a wrapped fetch function with automatic retry.

@example
```
import {withRetry} from 'fetch-extras';

const fetchWithRetry = withRetry({retries: 3})(fetch);

const response = await fetchWithRetry('https://api.example.com/data');
const data = await response.json();
```

@example
```
import {withRetry} from 'fetch-extras';

// With a custom backoff and conditional retry
const fetchWithRetry = withRetry({
	retries: 5,
	backoff: attemptNumber => attemptNumber * 1000, // Linear: 1s, 2s, 3s, ...
	shouldRetry({response}) {
		// Don't retry if the server says the resource is gone
		return response?.status !== 410;
	},
})(fetch);
```

@example
```
import {pipeline, withHttpError, withRetry, withBaseUrl, withTimeout} from 'fetch-extras';

const apiFetch = pipeline(
	fetch,
	withTimeout(10_000),
	withBaseUrl('https://api.example.com'),
	withRetry({retries: 2}),
	withHttpError(),
);

const response = await apiFetch('/users');
```
*/
export function withRetry(
	options?: {
		/**
		Number of retries after the initial attempt. `retries: 2` means up to 3 total attempts.

		@default 2
		*/
		readonly retries?: number;

		/**
		HTTP methods to retry. Non-matching methods pass through without retry.

		@default ['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'TRACE']
		*/
		readonly methods?: readonly string[];

		/**
		HTTP status codes that trigger a retry.

		@default [408, 429, 500, 502, 503, 504]
		*/
		readonly statusCodes?: readonly number[];

		/**
		Maximum `Retry-After` duration in milliseconds. If the server requests a longer delay, the response is returned without retrying.

		@default 60_000
		*/
		readonly maxRetryAfter?: number;

		/**
		Function returning the delay in milliseconds before a retry. Receives the 1-based attempt number that just failed.

		@default Exponential backoff with jitter: `min(1000 * 2^(attempt-1), 30000) * random(0.5, 1.0)`
		*/
		readonly backoff?: (attemptNumber: number) => number;

		/**
		Called after built-in checks pass, before retrying. Return `false` to stop retrying.

		For network errors, `error` is set. For HTTP status retries, `response` is set.

		Do not consume the `response` body. If you need to inspect the body, clone the response first.
		*/
		readonly shouldRetry?: (context: {
			readonly error?: Error;
			readonly response?: Response;
			readonly attemptNumber: number;
			readonly retriesLeft: number;
		}) => boolean | Promise<boolean>;
	},
): (fetchFunction: typeof fetch) => typeof fetch;
