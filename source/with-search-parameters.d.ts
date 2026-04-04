/**
Returns a wrapped fetch function that includes default search parameters on every request. Per-call parameters in the URL take priority over the defaults, so you can always override a default on a specific request.

String URLs and `URL` objects are modified. `Request` objects are passed through unchanged.

Can be combined with other `with*` functions.

@param fetchFunction - The fetch function to wrap (usually the global `fetch`).
@param defaultSearchParameters - Default search parameters to include on every request. Accepts a plain object, a `URLSearchParams` instance, or an array of `[name, value]` tuples.
@returns A wrapped fetch function that merges the default search parameters into every request URL.

@example
```
import {withSearchParameters} from 'fetch-extras';

const fetchWithParameters = withSearchParameters(fetch, {apiKey: 'my-key', format: 'json'});

const response = await fetchWithParameters('/users');
// Requests /users?apiKey=my-key&format=json

const data = await response.json();

// Per-call parameters override defaults
const response2 = await fetchWithParameters('/users?format=xml');
// Requests /users?apiKey=my-key&format=xml
```

@example
```
import {pipeline, withSearchParameters, withBaseUrl, withHttpError} from 'fetch-extras';

const apiFetch = pipeline(
	fetch,
	f => withBaseUrl(f, 'https://api.example.com'),
	f => withSearchParameters(f, {apiKey: 'my-key'}),
	withHttpError,
);

const response = await apiFetch('/users');
```
*/
export function withSearchParameters(
	fetchFunction: typeof fetch,
	defaultSearchParameters: Record<string, string> | URLSearchParams | ReadonlyArray<readonly [string, string]>
): typeof fetch;
