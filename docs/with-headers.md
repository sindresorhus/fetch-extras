# withHeaders

## withHeaders(defaultHeaders)

Wraps a fetch function to include default headers on every request. Per-call headers take priority over the defaults, so you can always override a default on a specific request.

## Parameters

- `defaultHeaders` (`HeadersInit | (() => HeadersInit | Promise<HeadersInit>)`) - Default headers to include on every request. Accepts a plain object, a `Headers` instance, an array of `[name, value]` tuples, or a function that returns any of these (sync or async). When a function is given, it is called on every request, which is useful for headers that need to be resolved at request time (for example, reading an auth token from storage).

## Returns

A function that takes a fetch function and returns a wrapped fetch function that merges the default headers into every request.

## Example

```js
import {withHeaders} from 'fetch-extras';

const fetchWithAuth = withHeaders({
	Authorization: 'Bearer my-token',
	'Content-Type': 'application/json',
})(fetch);

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

const fetchWithAuth = withHeaders(async () => ({
	Authorization: `Bearer ${await getTokenFromStorage()}`,
}))(fetch);

const response = await fetchWithAuth('/api/users');
```

> [!TIP]
> The header function does not receive the request URL or options. If you need headers that vary per request, use [`withHooks`](with-hooks.md) with a `beforeRequest` hook instead.

> [!NOTE]
> Function-based defaults are request-scoped, not sequence-scoped. Each new wrapped fetch call resolves them again. Wrappers such as `withRetry()` and `paginate()` call into `withHeaders()` separately for each attempt or page, so the header function can run again for each one.

Can be combined with other `with*` functions:

```js
import {pipeline, withHeaders, withBaseUrl, withTimeout} from 'fetch-extras';

const apiFetch = pipeline(
	fetch,
	withTimeout(5000),
	withBaseUrl('https://api.example.com'),
	withHeaders({Authorization: 'Bearer my-token'}),
);

const response = await apiFetch('/users');
```
