/**
Wraps a fetch function with a concurrency limit. When the maximum number of requests are already running until `fetch()` resolves, additional calls are queued and executed as earlier ones complete.

This is different from {@link withRateLimit}, which caps how many requests can start within a time window. `withConcurrency` caps how many `fetch()` calls can be running at the same time until they resolve.

The concurrency state is shared across all calls to the returned function. To limit different hosts independently, create separate `withConcurrency` wrappers.

Abort signals are respected while waiting: if the signal fires before a slot opens, the call rejects with the signal's abort reason without consuming a concurrency slot.

Streaming or otherwise slow response bodies may continue after their `fetch()` call has resolved, so response-body downloads can overlap.

Can be combined with other `with*` functions.

@param options - Concurrency configuration.
@returns A wrapper that takes a fetch function and returns a wrapped fetch function that enforces the concurrency limit.

@example
```
import {withConcurrency} from 'fetch-extras';

// Allow at most 5 fetch() calls to run at the same time
const concurrentFetch = withConcurrency({
	maxConcurrentRequests: 5,
})(fetch);

const response = await concurrentFetch('/api/data');
const data = await response.json();
```

@example
```
import {pipeline, withHttpError, withConcurrency, withBaseUrl} from 'fetch-extras';

const apiFetch = pipeline(
	fetch,
	withBaseUrl('https://api.example.com'),
	withConcurrency({maxConcurrentRequests: 5}),
	withHttpError(),
);

const response = await apiFetch('/users');
```
*/
export function withConcurrency(
	options: {
		/**
		Maximum number of requests allowed to run at the same time until `fetch()` resolves.
		*/
		maxConcurrentRequests: number;
	},
): (fetchFunction: typeof fetch) => typeof fetch;
