/**
 Wraps a fetch function with a concurrency limit. When the maximum number of requests are already running until `fetch()` resolves, additional calls are queued and executed as earlier ones complete.

The concurrency state is shared across all calls to the returned function. To limit different hosts independently, create separate `withConcurrency` wrappers.

Abort signals are respected while waiting: if the signal fires before a slot opens, the call rejects with the signal's abort reason without consuming a concurrency slot.

Can be combined with other `with*` functions.

@param fetchFunction - The fetch function to wrap (usually the global `fetch`).
@param options - Concurrency configuration.
@returns A wrapped fetch function that enforces the concurrency limit.

@example
```
import {withConcurrency} from 'fetch-extras';

// Allow at most 5 fetch() calls to run at the same time
const concurrentFetch = withConcurrency(fetch, {
	maxConcurrentRequests: 5,
});

const response = await concurrentFetch('/api/data');
const data = await response.json();
```

@example
```
import {pipeline, withHttpError, withConcurrency, withBaseUrl} from 'fetch-extras';

const apiFetch = pipeline(
	fetch,
	f => withBaseUrl(f, 'https://api.example.com'),
	f => withConcurrency(f, {maxConcurrentRequests: 5}),
	withHttpError,
);

const response = await apiFetch('/users');
```
*/
export function withConcurrency(
	fetchFunction: typeof fetch,
	options: {
		/**
		Maximum number of requests allowed to run at the same time until `fetch()` resolves.
		*/
		maxConcurrentRequests: number;
	},
): typeof fetch;
