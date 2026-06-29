/**
Wraps a fetch function with in-memory caching for plain unconditional GET requests.

Non-GET requests pass through unchanged. Unsafe methods (POST, PUT, PATCH, DELETE, etc.) also invalidate any cached response for the same URL. Only successful (2xx) responses are cached. Each cache hit returns a fresh clone, so the body can be consumed independently on every call.

The cache lives in memory for the lifetime of the returned function. To clear it, create a new `withCache` wrapper.

This is a small in-memory cache, not a full HTTP cache. It memoizes plain unconditional GET responses for a fixed TTL.

The cache key is the URL only, so `withCache()` only caches plain unconditional GET requests in the default fetch mode. If a GET request carries any explicit or inherited headers, including auth, cookies, or validators like `If-None-Match`, or it changes request metadata like `credentials`, `integrity`, `mode`, `redirect`, `referrer`, or `referrerPolicy`, it is treated as uncacheable and bypasses this wrapper's in-memory cache. Responses that include `Set-Cookie`, any `Vary` header, or `Cache-Control: no-store` / `no-cache` are also treated as uncacheable so a URL-only wrapper does not replay responses whose representation depends on hidden request state or should be revalidated before reuse. With `cache: 'only-if-cached'`, that still means a cache miss and the wrapper returns its synthetic `504` response.

This wrapper cannot see ambient runtime credentials such as browser-managed same-origin cookies or other hidden auth state that is attached outside explicit request headers. If a response may vary on that kind of ambient state, treat `withCache()` as unsupported for that route and rely on server-side cache headers or a cache keyed with your own explicit auth signal instead.

In documented `pipeline()` order, place `withCache` after `withBaseUrl` so the cache key is the resolved absolute URL, and before `withHttpError` so cached responses still get error-checked.

If you need to limit the number of cached entries, you can use a [`quick-lru`](https://github.com/sindresorhus/quick-lru) instance as the basis for a custom wrapper, since it implements the `Map` interface with a `maxSize` option.

@param options - Cache configuration.
@returns A wrapper that takes a fetch function and returns a wrapped fetch function that caches GET responses.

@example
```
import {withCache} from 'fetch-extras';

const cachedFetch = withCache({ttl: 60_000})(fetch);

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
	withBaseUrl('https://api.example.com'),
	withCache({ttl: 30_000}),
	withHttpError(),
);

const response = await apiFetch('/users');
```
*/
export function withCache(
	options: {
		/**
		Time-to-live in milliseconds. Cached responses older than this are discarded and re-fetched.
		*/
		ttl: number;
	},
): <FetchFunction extends typeof fetch>(
	fetchFunction: FetchFunction
) => (...arguments_: Parameters<FetchFunction>) => Promise<Response>;
