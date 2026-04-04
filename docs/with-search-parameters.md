# withSearchParameters

## withSearchParameters(fetchFunction, defaultSearchParameters)

Returns a wrapped fetch function that includes default search parameters on every request. Per-call parameters in the URL take priority over the defaults, so you can always override a default on a specific request.

```js
import {withSearchParameters} from 'fetch-extras';

const fetchWithParameters = withSearchParameters(fetch, {apiKey: 'my-key', format: 'json'});

const response = await fetchWithParameters('/users');
// Requests /users?apiKey=my-key&format=json

const data = await response.json();

// Per-call parameters override defaults
const response2 = await fetchWithParameters('/users?format=xml');
// Requests /users?apiKey=my-key&format=xml
```

## Parameters

- `fetchFunction` (`typeof fetch`) - The fetch function to wrap (usually the global `fetch`).
- `defaultSearchParameters` (`Record<string, string> | URLSearchParams | string[][]`) - Default search parameters to include on every request. Accepts a plain object, a `URLSearchParams` instance, or an array of `[name, value]` tuples.

## Returns

A wrapped fetch function that merges the default search parameters into every request URL.

> [!NOTE]
> String URLs and `URL` objects are modified. `Request` objects are passed through unchanged.

> [!TIP]
> Place `withSearchParameters` after `withBaseUrl` in a pipeline so the parameters are appended to the resolved absolute URL.

## Example

Can be combined with other `with*` functions:

```js
import {pipeline, withSearchParameters, withBaseUrl, withHttpError} from 'fetch-extras';

const apiFetch = pipeline(
	fetch,
	f => withBaseUrl(f, 'https://api.example.com'),
	f => withSearchParameters(f, {apiKey: 'my-key'}),
	withHttpError,
);

const response = await apiFetch('/users');
```
