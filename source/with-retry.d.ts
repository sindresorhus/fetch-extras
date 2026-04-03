/**
Wraps a fetch function to automatically retry failed requests.

Retries on [network errors](https://github.com/sindresorhus/is-network-error) and configurable HTTP status codes. Only retries idempotent methods by default (GET, HEAD, PUT, DELETE, OPTIONS, TRACE). Uses exponential backoff with jitter by default. Respects the `Retry-After` response header when present.

When all retries are exhausted, the last response is returned (for HTTP status retries) or the last error is thrown (for network errors).

Place `withRetry` before `withHttpError` in a pipeline so it sees raw responses and can check status codes.

Do not consume the `response` body inside `shouldRetry`. If you need to inspect the body, clone the response first.

Requests with a one-shot body provided via `options.body`, such as a `ReadableStream` or AsyncIterable, are sent as-is and are not retried. Retrying those uploads would require buffering and would change wrapper composition semantics such as upload progress. Requests whose body comes from a bare `Request` object (no `options.body` override) are also not retried.

@param fetchFunction - The fetch function to wrap (usually the global `fetch`).
@param options - Retry configuration.
@returns A wrapped fetch function with automatic retry.

@example
```
import {withRetry} from 'fetch-extras';

const fetchWithRetry = withRetry(fetch, {retries: 3});

const response = await fetchWithRetry('https://api.example.com/data');
const data = await response.json();
```

@example
```
import {pipeline, withHttpError, withRetry, withBaseUrl} from 'fetch-extras';

const apiFetch = pipeline(
	fetch,
	f => withBaseUrl(f, 'https://api.example.com'),
	f => withRetry(f, {retries: 2}),
	withHttpError,
);

const response = await apiFetch('/users');
```
*/
export function withRetry(
	fetchFunction: typeof fetch,
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
		readonly methods?: string[];

		/**
		HTTP status codes that trigger a retry.

		@default [408, 429, 500, 502, 503, 504]
		*/
		readonly statusCodes?: number[];

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
): typeof fetch;
