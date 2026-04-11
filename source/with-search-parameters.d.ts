/**
Wraps a fetch function to include default search parameters on every request. Per-call parameters in the URL take priority over the defaults, so you can always override a default on a specific request.

String URLs and `URL` objects are modified. `Request` objects are passed through unchanged.

In documented `pipeline()` order, place `withSearchParameters` after `withBaseUrl` so the parameters are appended to the resolved absolute URL.

Can be combined with other `with*` functions.

@param defaultSearchParameters - Default search parameters to include on every request. Accepts a plain object, a `URLSearchParams` instance, or an array of `[name, value]` tuples.
@returns A wrapper that takes a fetch function and returns a wrapped fetch function that merges the default search parameters into every request URL.

@example
```
import {withSearchParameters} from 'fetch-extras';

const fetchWithParameters = withSearchParameters({apiKey: 'my-key', format: 'json'})(fetch);

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
	withBaseUrl('https://api.example.com'),
	withSearchParameters({apiKey: 'my-key'}),
	withHttpError(),
);

const response = await apiFetch('/users');
```
*/
export function withSearchParameters(
	defaultSearchParameters: Record<string, string> | URLSearchParams | ReadonlyArray<readonly [string, string]>
): (fetchFunction: typeof fetch) => typeof fetch;
