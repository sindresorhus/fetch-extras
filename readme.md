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
import {
	pipeline,
	withTimeout,
	withBaseUrl,
	withHeaders,
	withHttpError
} from 'fetch-extras';

// Create a tiny reusable API client that:
// - Times out after 5 seconds
// - Uses a base URL so you only write paths
// - Sends auth headers on every request
// - Throws errors for non-2xx responses
const apiFetch = pipeline(
	fetch,
	f => withTimeout(f, 5000),
	f => withBaseUrl(f, 'https://api.example.com'),
	f => withHeaders(f, {Authorization: 'Bearer token'}),
	withHttpError,
);

const response = await apiFetch('/users');
const data = await response.json();
```

## API

The `with*` functions are listed in the recommended wrapping order for use with [`pipeline`](docs/pipeline.md).

- [`withTimeout`](docs/with-timeout.md)
- [`withBaseUrl`](docs/with-base-url.md)
- [`withSearchParameters`](docs/with-search-parameters.md)
- [`withHeaders`](docs/with-headers.md)
- [`withJsonBody`](docs/with-json-body.md)
- [`withRateLimit`](docs/with-rate-limit.md)
- [`withDeduplication`](docs/with-deduplication.md)
- [`withCache`](docs/with-cache.md)
- [`withDownloadProgress`](docs/with-download-progress.md)
- [`withUploadProgress`](docs/with-upload-progress.md)
- [`withRetry`](docs/with-retry.md)
- [`withTokenRefresh`](docs/with-token-refresh.md)
- [`withHooks`](docs/with-hooks.md)
- [`withHttpError`](docs/http-error.md#withhttperrorfetchfunction)
- [`HttpError`](docs/http-error.md#httperror)
- [`throwIfHttpError`](docs/http-error.md#throwifhttperrorresponse)
- [`paginate`](docs/paginate.md)
- [`pipeline`](docs/pipeline.md)

## Related

- [is-network-error](https://github.com/sindresorhus/is-network-error) - Check if a value is a Fetch network error
- [ky](https://github.com/sindresorhus/ky) - HTTP client based on Fetch
- [parse-sse](https://www.npmjs.com/package/parse-sse) - Parse Server-Sent Events (SSE) from a Response
