<h1 align="center" title="fetch-extras">
	<img src="media/logo.jpg" alt="fetch-extras logo">
</h1>

> Useful utilities for working with [Fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)

Great for creating tiny custom HTTP clients without a heavy dependency.

*For a full-featured HTTP client on top of Fetch, check out my [`ky`](https://github.com/sindresorhus/ky) package.*

## Install

```sh
npm install fetch-extras
```

## Usage

```js
import {withHttpError, withTimeout, withBaseUrl, withHeaders} from 'fetch-extras';

// Create a tiny reusable API client that:
// - Sends auth headers on every request
// - Uses a base URL so you only write paths
// - Throws errors for non-2xx responses
// - Times out after 5 seconds
const apiFetch = withHeaders(
	withHttpError(
		withBaseUrl(
			withTimeout(fetch, 5000),
			'https://api.example.com',
		),
	),
	{Authorization: 'Bearer my-token'},
);

const response = await apiFetch('/users');
const data = await response.json();
```

## API

- [`HttpError`](docs/http-error.md#httperror)
- [`throwIfHttpError`](docs/http-error.md#throwifhttperrorresponse)
- [`withHttpError`](docs/http-error.md#withhttperrorfetchfunction)
- [`withTimeout`](docs/with-timeout.md)
- [`withBaseUrl`](docs/with-base-url.md)
- [`withHeaders`](docs/with-headers.md)
- [`paginate`](docs/paginate.md)

## Related

- [is-network-error](https://github.com/sindresorhus/is-network-error) - Check if a value is a Fetch network error
- [ky](https://github.com/sindresorhus/ky) - HTTP client based on Fetch
- [parse-sse](https://www.npmjs.com/package/parse-sse) - Parse Server-Sent Events (SSE) from a Response
