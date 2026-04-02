# withCache

## withCache(fetchFunction, options)

Wraps a fetch function with in-memory caching for GET requests.

Non-GET requests pass through unchanged. Unsafe methods (POST, PUT, PATCH, DELETE, etc.) also invalidate any cached response for the same URL. Only successful (2xx) responses are cached. Each cache hit returns a fresh clone, so the body can be consumed independently on every call.

The cache lives in memory for the lifetime of the returned function. To clear it, create a new `withCache` wrapper.

## Parameters

- `fetchFunction` (`typeof fetch`) - The fetch function to wrap (usually the global `fetch`).
- `options` (`object`)
  - `ttl` (`number`) - Time-to-live in milliseconds. Cached responses older than this are discarded and re-fetched.

## Returns

A wrapped fetch function that caches GET responses.

> [!NOTE]
> The cache key is the URL only. Requests with different headers but the same URL share the same cache entry.

> [!TIP]
> Place `withCache` after `withBaseUrl` in a pipeline so the cache key is the resolved absolute URL, and before `withHttpError` so cached responses still get error-checked.

> [!TIP]
> If you need to limit the number of cached entries, you can use a [`quick-lru`](https://github.com/sindresorhus/quick-lru) instance as the basis for a custom wrapper, since it implements the `Map` interface with a `maxSize` option.

## Example

```js
import {withCache} from 'fetch-extras';

const cachedFetch = withCache(fetch, {ttl: 60_000});

const response = await cachedFetch('https://api.example.com/data');
const data = await response.json();

// Second call within 60 seconds returns the cached response
const response2 = await cachedFetch('https://api.example.com/data');
```

Can be combined with other `with*` functions:

```js
import {pipeline, withHttpError, withCache, withBaseUrl} from 'fetch-extras';

const apiFetch = pipeline(
	fetch,
	f => withBaseUrl(f, 'https://api.example.com'),
	f => withCache(f, {ttl: 30_000}),
	withHttpError,
);

const response = await apiFetch('/users');
```
