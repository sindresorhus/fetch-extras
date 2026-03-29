/**
Returns a wrapped fetch function that includes default headers on every request. Per-call headers take priority over the defaults, so you can always override a default on a specific request.

Can be combined with other `with*` functions.

@param fetchFunction - The fetch function to wrap (usually the global `fetch`).
@param defaultHeaders - Default headers to include on every request. Accepts a plain object, a `Headers` instance, or an array of `[name, value]` tuples.
@returns A wrapped fetch function that merges the default headers into every request.

@example
```
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

@example
```
import {pipeline, withHeaders, withBaseUrl, withTimeout} from 'fetch-extras';

const apiFetch = pipeline(
	fetch,
	f => withTimeout(f, 5000),
	f => withBaseUrl(f, 'https://api.example.com'),
	f => withHeaders(f, {Authorization: 'Bearer my-token'}),
);

const response = await apiFetch('/users');
```
*/
export function withHeaders(
	fetchFunction: typeof fetch,
	defaultHeaders: HeadersInit
): typeof fetch;
