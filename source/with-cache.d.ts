/**
Wraps a fetch function with in-memory caching for GET requests.

Non-GET requests pass through unchanged. Unsafe methods (POST, PUT, PATCH, DELETE, etc.) also invalidate any cached response for the same URL. Only successful (2xx) responses are cached. Each cache hit returns a fresh clone, so the body can be consumed independently on every call.

The cache lives in memory for the lifetime of the returned function. To clear it, create a new `withCache` wrapper.

The cache key is the URL only. Requests with different headers but the same URL share the same cache entry.

Place `withCache` after `withBaseUrl` in a pipeline so the cache key is the resolved absolute URL, and before `withHttpError` so cached responses still get error-checked.

If you need to limit the number of cached entries, you can use a [`quick-lru`](https://github.com/sindresorhus/quick-lru) instance as the basis for a custom wrapper, since it implements the `Map` interface with a `maxSize` option.

@param fetchFunction - The fetch function to wrap (usually the global `fetch`).
@param options - Cache configuration.
@returns A wrapped fetch function that caches GET responses.

@example
```
import {withCache} from 'fetch-extras';

const cachedFetch = withCache(fetch, {ttl: 60_000});

const response = await cachedFetch('https://api.example.com/data');
const data = await response.json();

// Second call within 60 seconds returns the cached response
const response2 = await cachedFetch('https://api.example.com/data');
```

@example
```
import {pipeline, withHttpError, withCache, withBaseUrl} from 'fetch-extras';

const apiFetch = pipeline(
	fetch,
	f => withBaseUrl(f, 'https://api.example.com'),
	f => withCache(f, {ttl: 30_000}),
	withHttpError,
);

const response = await apiFetch('/users');
```
*/
export function withCache(
	fetchFunction: typeof fetch,
	options: {
		/**
		Time-to-live in milliseconds. Cached responses older than this are discarded and re-fetched.
		*/
		ttl: number;
	},
): typeof fetch;
