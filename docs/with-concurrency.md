# withConcurrency

## withConcurrency(fetchFunction, options)

Wraps a fetch function with a concurrency limit. When the maximum number of requests are already running until `fetch()` resolves, additional calls are queued and executed as earlier ones complete.

This is different from [`withRateLimit`](with-rate-limit.md), which caps how many requests can start within a time window. `withConcurrency` caps how many `fetch()` calls can be running at the same time until they resolve.

## Parameters

- `fetchFunction` (`typeof fetch`) - The fetch function to wrap (usually the global `fetch`).
- `options` (`object`)
  - `maxConcurrentRequests` (`number`) - Maximum number of requests allowed to run at the same time until `fetch()` resolves.

## Returns

A wrapped fetch function that enforces the concurrency limit.

> [!NOTE]
> The concurrency state is shared across all calls to the returned function. To limit different hosts independently, create separate `withConcurrency` wrappers.

> [!NOTE]
> Abort signals are respected while waiting: if the signal fires before a slot opens, the call rejects with the signal's abort reason without consuming a concurrency slot.

> [!NOTE]
> Streaming or otherwise slow response bodies may continue after their `fetch()` call has resolved, so response-body downloads can overlap.

## Example

```js
import {withConcurrency} from 'fetch-extras';

// Allow at most 5 fetch() calls to run at the same time
const concurrentFetch = withConcurrency(fetch, {
	maxConcurrentRequests: 5,
});

const response = await concurrentFetch('/api/data');
const data = await response.json();
```

Can be combined with other `with*` functions:

```js
import {pipeline, withHttpError, withConcurrency, withBaseUrl} from 'fetch-extras';

const apiFetch = pipeline(
	fetch,
	f => withBaseUrl(f, 'https://api.example.com'),
	f => withConcurrency(f, {maxConcurrentRequests: 5}),
	withHttpError,
);

const response = await apiFetch('/users');
```
