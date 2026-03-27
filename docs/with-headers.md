# `withHeaders(fetchFunction, defaultHeaders)`

Returns a wrapped fetch function that includes default headers on every request. Per-call headers take priority over the defaults, so you can always override a default on a specific request.

## Parameters

- `fetchFunction` (`typeof fetch`) - The fetch function to wrap (usually the global `fetch`).
- `defaultHeaders` (`HeadersInit`) - Default headers to include on every request. Accepts a plain object, a `Headers` instance, or an array of `[name, value]` tuples.

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

Can be combined with other `with*` functions:

```js
import {withHeaders, withBaseUrl, withTimeout} from 'fetch-extras';

const apiFetch = withHeaders(
	withBaseUrl(
		withTimeout(fetch, 5000),
		'https://api.example.com'
	),
	{Authorization: 'Bearer my-token'},
);

const response = await apiFetch('/users');
```
