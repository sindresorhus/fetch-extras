# withRetry

## withRetry(fetchFunction, options?)

Wraps a fetch function to automatically retry failed requests.

Retries on network errors and configurable HTTP status codes. Only retries idempotent methods by default (GET, HEAD, PUT, DELETE, OPTIONS, TRACE). Uses exponential backoff with jitter by default. Respects the `Retry-After` response header when present.

When all retries are exhausted, the last response is returned (for HTTP status retries) or the last error is thrown (for network errors).

## Parameters

- `fetchFunction` (`typeof fetch`) - The fetch function to wrap (usually the global `fetch`).
- `options` (`object`)
  - `retries` (`number`) - Number of retries after the initial attempt. `retries: 2` means up to 3 total attempts. Default: `2`.
  - `methods` (`string[]`) - HTTP methods to retry. Non-matching methods pass through without retry. Default: `['GET', 'HEAD', 'PUT', 'DELETE', 'OPTIONS', 'TRACE']`.
  - `statusCodes` (`number[]`) - HTTP status codes that trigger a retry. Default: `[408, 429, 500, 502, 503, 504]`.
  - `maxRetryAfter` (`number`) - Maximum `Retry-After` duration in milliseconds. If the server requests a longer delay, the response is returned without retrying. Default: `60_000`.
  - `backoff` (`(attemptNumber: number) => number`) - Function returning the delay in milliseconds before a retry. Receives the 1-based attempt number that just failed. Default: exponential backoff with jitter (`min(1000 * 2^(attempt-1), 30000) * random(0.5, 1.0)`).
  - `shouldRetry` (`(context) => boolean | Promise<boolean>`) - Called after built-in checks pass, before retrying. Return `false` to stop retrying. The context object has `{error?, response?, attemptNumber, retriesLeft}`. For network errors, `error` is set. For HTTP status retries, `response` is set. Do not consume the `response` body. If you need to inspect the body, clone the response first.

## Returns

A wrapped fetch function with automatic retry.

> [!NOTE]
> POST and PATCH are not retried by default because they are not idempotent. Add them to `methods` if your endpoints are safe to retry.

> [!TIP]
> Place `withRetry` before `withHttpError` in a pipeline so it sees raw responses and can check status codes.

> [!IMPORTANT]
> Requests with a one-shot body provided via `options.body`, such as a `ReadableStream` or AsyncIterable, are sent as-is and are not retried. Retrying those uploads would require buffering and would change wrapper composition semantics such as upload progress. Requests whose body comes from a bare `Request` object (no `options.body` override) are also not retried.

## Example

```js
import {withRetry} from 'fetch-extras';

const fetchWithRetry = withRetry(fetch, {retries: 3});

const response = await fetchWithRetry('https://api.example.com/data');
const data = await response.json();
```

With a custom backoff and conditional retry:

```js
import {withRetry} from 'fetch-extras';

const fetchWithRetry = withRetry(fetch, {
	retries: 5,
	backoff: attemptNumber => attemptNumber * 1000, // Linear: 1s, 2s, 3s, ...
	shouldRetry({response}) {
		// Don't retry if the server says the resource is gone
		return response?.status !== 410;
	},
});
```

Can be combined with other `with*` functions:

```js
import {pipeline, withHttpError, withRetry, withBaseUrl, withTimeout} from 'fetch-extras';

const apiFetch = pipeline(
	fetch,
	f => withTimeout(f, 10_000),
	f => withBaseUrl(f, 'https://api.example.com'),
	f => withRetry(f, {retries: 2}),
	withHttpError,
);

const response = await apiFetch('/users');
```
