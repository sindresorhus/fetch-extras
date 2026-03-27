<h1 align="center" title="fetch-extras">
	<img src="media/logo.jpg" alt="fetch-extras logo">
</h1>

> Useful utilities for working with [Fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)

*For more features and conveniences on top of Fetch, check out my [`ky`](https://github.com/sindresorhus/ky) package.*

## Install

```sh
npm install fetch-extras
```

## Usage

```js
import {withHttpError, withTimeout} from 'fetch-extras';

// Create an enhanced reusable fetch function that:
// - Throws errors for non-2xx responses
// - Times out after 5 seconds
const enhancedFetch = withHttpError(withTimeout(fetch, 5000));

const response = await enhancedFetch('/api');
const data = await response.json();
```

## API

### HttpError

Error class thrown when a response has a non-2xx status code.

```js
import {HttpError, throwIfHttpError} from 'fetch-extras';

try {
	await throwIfHttpError(fetch('/api'));
} catch (error) {
	if (error instanceof HttpError) {
		console.log(error.response.status); // 404
	}
}
```

### throwIfHttpError(response)

Throws an `HttpError` if the response is not ok. Can also accept a promise that resolves to a response.

```js
import {throwIfHttpError} from 'fetch-extras';

const response = await throwIfHttpError(fetch('/api'));
const data = await response.json();
```

### withHttpError(fetchFunction)

Returns a wrapped fetch function that automatically throws `HttpError` for non-2xx responses.

```js
import {withHttpError} from 'fetch-extras';

const fetchWithError = withHttpError(fetch);
const response = await fetchWithError('/api');
```

### withTimeout(fetchFunction, timeout)

Returns a wrapped fetch function with timeout functionality.

```js
import {withTimeout} from 'fetch-extras';

const fetchWithTimeout = withTimeout(fetch, 5000);
const response = await fetchWithTimeout('/api');
```

### withBaseUrl(fetchFunction, baseUrl)

Returns a wrapped fetch function that resolves relative URLs against a base URL. Useful for API clients with a consistent base URL.

```js
import {withBaseUrl} from 'fetch-extras';

const fetchWithBaseUrl = withBaseUrl(fetch, 'https://api.example.com');
const response = await fetchWithBaseUrl('/users'); // Requests https://api.example.com/users
const data = await response.json();
```

Only string-based relative URLs are resolved against the base URL. Absolute URLs and URL objects are passed through unchanged. Relative paths are resolved against the base URL's pathname, while query-only and fragment-only inputs keep normal URL semantics:

```js
// Both of these work the same way
const fetch1 = withBaseUrl(fetch, 'https://api.example.com/v1');
const fetch2 = withBaseUrl(fetch, 'https://api.example.com/v1/');

await fetch1('users'); // https://api.example.com/v1/users
await fetch2('users'); // https://api.example.com/v1/users
await fetch1('?page=2'); // https://api.example.com/v1?page=2
```

Can be combined with other `with*` functions:

```js
import {withBaseUrl, withHttpError, withTimeout} from 'fetch-extras';

const fetchWithAll = withHttpError(
	withBaseUrl(
		withTimeout(fetch, 5000),
		'https://api.example.com'
	)
);

const response = await fetchWithAll('/users');
```

Works seamlessly with `paginate()`:

```js
import {paginate, withBaseUrl} from 'fetch-extras';

const fetchWithBaseUrl = withBaseUrl(fetch, 'https://api.github.com');

for await (const commit of paginate('/repos/sindresorhus/ky/commits', {fetchFunction: fetchWithBaseUrl})) {
	console.log(commit.sha);
}
```

### paginate(input, options?)

Paginate through API responses using async iteration. By default, it automatically follows RFC 5988 `Link` headers with `rel="next"`.

Returns an async iterator that yields items from each page.

```js
import {paginate} from 'fetch-extras';

// Basic usage with Link headers (GitHub API)
for await (const commit of paginate('https://api.github.com/repos/sindresorhus/ky/commits')) {
	console.log(commit.sha);
}
```

#### options

Type: `object`

##### pagination

Type: `object`

###### transform

Type: `(response: Response) => Promise<unknown[]>`\
Default: `response => response.json()`

Transform the response into an array of items.

```js
for await (const user of paginate('https://api.example.com/users', {
	pagination: {
		transform: async response => {
			const data = await response.json();
			return data.users; // Extract from nested property
		}
	}
})) {
	console.log(user);
}
```

###### paginate

Type: `(data: {response, currentUrl, currentItems, allItems}) => Promise<PaginationNextPage | false>`\
Default: Parses RFC 5988 `Link` header

Determine the next page to fetch. Return an object with fetch options for the next request, or `false` to stop pagination.

> [!IMPORTANT]
> The response body has already been consumed by the `transform` function. Do NOT call `response.json()` or other body methods here. Extract pagination info from headers, the URL, or share data from the transform function through closure.

> [!NOTE]
> Returning `headers` replaces all inherited headers, consistent with standard Fetch API behavior. If you need to add headers while keeping existing ones, read them from the response and include them in the returned object.
> Setting `body` to `undefined` will strip body-related headers (`Content-Type`, `Content-Length`, etc.) from the request, consistent with HTTP semantics for bodyless requests.

```js
// Cursor-based pagination using headers (recommended)
for await (const item of paginate('https://api.example.com/items', {
	pagination: {
		paginate: ({response}) => {
			const cursor = response.headers.get('X-Next-Cursor');
			return cursor
				? {url: new URL(`https://api.example.com/items?cursor=${cursor}`)}
				: false;
		}
	}
})) {
	console.log(item);
}
```

```js
// Sharing data between transform and paginate via closure
let nextCursor;

for await (const item of paginate('https://api.example.com/items', {
	pagination: {
		transform: async (response) => {
			const data = await response.json();
			nextCursor = data.nextCursor;
			return data.items;
		},
		paginate: () => {
			return nextCursor
				? {url: new URL(`https://api.example.com/items?cursor=${nextCursor}`)}
				: false;
		}
	}
})) {
	console.log(item);
}
```

###### filter

Type: `(data: {item, currentItems, allItems}) => boolean`\
Default: `() => true`

Filter items before yielding them.

```js
// Only get active users
for await (const user of paginate('https://api.example.com/users', {
	pagination: {
		filter: ({item}) => item.status === 'active'
	}
})) {
	console.log(user);
}
```

###### shouldContinue

Type: `(data: {item, currentItems, allItems}) => boolean`\
Default: `() => true`

Check if pagination should continue after yielding an item. This is called after `filter` returns `true`. Useful for stopping pagination based on item values.

```js
// Stop when we reach items older than one week
const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);

for await (const commit of paginate('https://api.github.com/repos/user/repo/commits', {
	pagination: {
		shouldContinue: ({item}) => new Date(item.date).getTime() >= oneWeekAgo
	}
})) {
	console.log(commit);
}
```

###### countLimit

Type: `number`\
Default: `Infinity`

Maximum number of items to yield.

```js
const items = await paginate.all('https://api.example.com/items', {
	pagination: {
		countLimit: 100 // Stop after 100 items
	}
});
```

###### requestLimit

Type: `number`\
Default: `10000`

Maximum number of requests to make. This prevents infinite loops if your `paginate` function has bugs. Ensure your `paginate` function eventually returns `false` or the iteration will continue until this limit is reached.

###### backoff

Type: `number`\
Default: `0`

Delay in milliseconds between requests. Useful for rate limiting.

```js
for await (const item of paginate('https://api.example.com/items', {
	pagination: {
		backoff: 1000 // Wait 1 second between requests
	}
})) {
	console.log(item);
}
```

###### stackAllItems

Type: `boolean`\
Default: `false`

Whether to keep all yielded items in memory. When `true`, the `allItems` array passed to callbacks will contain all previously yielded items. When `false`, `allItems` will always be empty to save memory.

##### fetchFunction

Type: `(input: RequestInfo | URL, init?: any) => Promise<Response>`\
Default: `globalThis.fetch`

Custom fetch function to use for requests. This allows you to use a custom fetch implementation, such as [`ky`](https://github.com/sindresorhus/ky), or a fetch function wrapped with `withHttpError` or `withTimeout`.

```js
import {paginate} from 'fetch-extras';
import ky from 'ky';

const url = 'https://api.github.com/repos/sindresorhus/ky/commits';

for await (const commit of paginate(url, {fetchFunction: ky})) {
	console.log(commit.sha);
}
```

### paginate.all(input, options?)

Get all paginated items as an array. This is a convenience method that collects all items into memory. For large datasets, prefer using the async iterator directly.

```js
import {paginate} from 'fetch-extras';

const commits = await paginate.all('https://api.github.com/repos/sindresorhus/ky/commits', {
	pagination: {
		countLimit: 50
	}
});

console.log(`Fetched ${commits.length} commits`);
```

## Related

- [is-network-error](https://github.com/sindresorhus/is-network-error) - Check if a value is a Fetch network error
- [ky](https://github.com/sindresorhus/ky) - HTTP client based on Fetch
- [parse-sse](https://www.npmjs.com/package/parse-sse) - Parse Server-Sent Events (SSE) from a Response
