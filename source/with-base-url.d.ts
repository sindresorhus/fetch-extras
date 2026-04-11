/**
Wraps a fetch function to resolve relative URLs against a base URL. Useful for API clients with a consistent base URL.

Only string-based relative URLs are resolved against the base URL. Absolute URLs and URL objects are passed through unchanged. Protocol-relative inputs like `//cdn.example.com/file.js` are rejected to avoid escaping the configured origin. Relative paths are resolved against the base URL's pathname, while query-only and fragment-only inputs keep normal URL semantics.

Can be combined with other `with*` functions.

@param baseUrl - The base URL to resolve relative URLs against. Can be a string or URL object.
@returns A wrapper that takes a fetch function and returns a wrapped fetch function that resolves relative URLs against the base URL.

@example
```
import {withBaseUrl} from 'fetch-extras';

const fetchWithBaseUrl = withBaseUrl('https://api.example.com')(fetch);
const response = await fetchWithBaseUrl('/users'); // Requests https://api.example.com/users
const data = await response.json();
```

@example
```
// Both of these work the same way
const fetch1 = withBaseUrl('https://api.example.com/v1')(fetch);
const fetch2 = withBaseUrl('https://api.example.com/v1/')(fetch);

await fetch1('users'); // https://api.example.com/v1/users
await fetch2('users'); // https://api.example.com/v1/users
await fetch1('?page=2'); // https://api.example.com/v1?page=2
```

@example
```
import {pipeline, withBaseUrl, withHttpError, withTimeout} from 'fetch-extras';

const fetchWithAll = pipeline(
	fetch,
	withTimeout(5000),
	withBaseUrl('https://api.example.com'),
	withHttpError(),
);

const response = await fetchWithAll('/users');
```

@example
```
import {paginate, withBaseUrl} from 'fetch-extras';

const fetchWithBaseUrl = withBaseUrl('https://api.github.com')(fetch);

for await (const commit of paginate('/repos/sindresorhus/ky/commits', {fetchFunction: fetchWithBaseUrl})) {
	console.log(commit.sha);
}
```
*/
export function withBaseUrl(
	baseUrl: URL | string
): (fetchFunction: typeof fetch) => typeof fetch;
