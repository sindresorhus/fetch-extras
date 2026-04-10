# `withHeaders(fetchFunction, defaultHeaders)`

Returns a wrapped fetch function that includes default headers on every request. Per-call headers take priority over the defaults, so you can always override a default on a specific request.

## Parameters

- `fetchFunction` (`typeof fetch`) - The fetch function to wrap (usually the global `fetch`).
- `defaultHeaders` (`HeadersInit | (() => HeadersInit | Promise<HeadersInit>)`) - Default headers to include on every request. Accepts a plain object, a `Headers` instance, an array of `[name, value]` tuples, or a function that returns any of these (sync or async). When a function is given, it is called on every request, which is useful for headers that need to be resolved at request time (for example, reading an auth token from storage).

## Returns

A wrapped fetch function that merges the default headers into every request.

## Example

```js
import {withHeaders} from 'fetch-extras';

const fetchWithAuth = withHeaders(fetch, {
	Authorization: 'Bearer my-token',
	'Content-Type': 'application/json',
});

const response = await fetchWithAuth('/api/users');
const data = await response.json();

// Per-call headers override defaults
const response2 = await fetchWithAuth('/api/upload', {
	headers: {'Content-Type': 'multipart/form-data'},
});
```

Dynamic headers resolved on every request:

```js
import {withHeaders} from 'fetch-extras';

const fetchWithAuth = withHeaders(fetch, async () => ({
	Authorization: `Bearer ${await getTokenFromStorage()}`,
}));

const response = await fetchWithAuth('/api/users');
```

> [!TIP]
> The header function does not receive the request URL or options. If you need headers that vary per request, use [`withHooks`](with-hooks.md) with a `beforeRequest` hook instead.

> [!NOTE]
> Function-based defaults are request-scoped, not sequence-scoped. Wrappers that replay the same request, such as `withRetry()`, freeze the resolved headers for that replay batch. Wrappers that build later requests, such as `paginate()`, re-resolve them for each request.

Can be combined with other `with*` functions:

```js
import {pipeline, withHeaders, withBaseUrl, withTimeout} from 'fetch-extras';

const apiFetch = pipeline(
	fetch,
	f => withTimeout(f, 5000),
	f => withBaseUrl(f, 'https://api.example.com'),
	f => withHeaders(f, {Authorization: 'Bearer my-token'}),
);

const response = await apiFetch('/users');
```
