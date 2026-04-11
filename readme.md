<h1 align="center" title="fetch-extras">
	<img src="media/logo.jpg" alt="fetch-extras logo">
</h1>

> Useful utilities for working with [Fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)

Build tiny, focused HTTP clients by composing only the features you need on top of the standard `fetch` API. No wrapper objects, no new interface to learn, no lock-in.

## Highlights

- **Composable** — Each `with*` function adds a single capability. Stack them to build exactly the client you need.
- **Works everywhere** — Browsers, Node.js, Deno, Bun, Cloudflare Workers, etc.
- **Zero dependencies**
- **Standard `fetch`** — The input and output are always a plain `fetch` function. Your code stays portable and familiar.
- **Tree-shakeable** — Only the utilities you import end up in your bundle.
- **TypeScript** — Full type definitions with strong generics.
- **Schema validation** — Validate responses against [Standard Schema](https://standardschema.dev) (Zod, Valibot, ArkType, etc.).

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
	withHttpError,
	withJsonResponse,
} from 'fetch-extras';

// Create a tiny reusable API client that:
// - Times out after 5 seconds
// - Uses a base URL so you only write paths
// - Sends auth headers on every request
// - Throws errors for non-2xx responses
// - Parses JSON responses automatically
const apiFetch = pipeline(
	fetch,
	withTimeout(5000),
	withBaseUrl('https://api.example.com'),
	withHeaders({Authorization: 'Bearer token'}),
	withHttpError(),
	withJsonResponse(),
);

const data = await apiFetch('/users');
```

`pipeline()` order is the documented order throughout this package. Runtime wrapper nesting is the inverse, so `pipeline(fetch, withTimeout(5000), withHeaders(headers))` becomes `withHeaders(headers)(withTimeout(5000)(fetch))`.

## API

### Wrappers

Listed in the recommended [`pipeline`](docs/pipeline.md) order. Read the list top to bottom as the order you pass wrappers to `pipeline()`.

- [`withTimeout`](docs/with-timeout.md) - Abort requests that take too long
- [`withBaseUrl`](docs/with-base-url.md) - Resolve relative URLs against a base URL
- [`withSearchParameters`](docs/with-search-parameters.md) - Attach default query parameters to every request
- [`withHeaders`](docs/with-headers.md) - Attach default headers to every request
- [`withJsonBody`](docs/with-json-body.md) - Auto-stringify plain objects as JSON
- [`withRateLimit`](docs/with-rate-limit.md) - Enforce client-side rate limiting with a sliding window
- [`withConcurrency`](docs/with-concurrency.md) - Cap how many requests can run simultaneously
- [`withDeduplication`](docs/with-deduplication.md) - Collapse concurrent identical GET requests into a single call
- [`withCache`](docs/with-cache.md) - In-memory caching for plain unconditional GET responses with a TTL
- [`withDownloadProgress`](docs/with-download-progress.md) - Track download progress
- [`withUploadProgress`](docs/with-upload-progress.md) - Track upload progress
- [`withRetry`](docs/with-retry.md) - Retry failed requests with exponential backoff
- [`withTokenRefresh`](docs/with-token-refresh.md) - Auto-refresh auth tokens on 401 and retry
- [`withHooks`](docs/with-hooks.md) - `beforeRequest` and `afterResponse` hooks
- [`withHttpError`](docs/http-error.md#withhttperrorfetchfunction) - Throw on non-2xx responses
- [`withJsonResponse`](docs/with-json-response.md) - Parse response as JSON, with optional [Standard Schema](https://standardschema.dev) validation *(place last in pipeline)*

### Utilities

- [`pipeline`](docs/pipeline.md) - Compose `with*` wrappers without deep nesting
- [`paginate`](docs/paginate.md) - Async-iterate over paginated API endpoints
- [`throwIfHttpError`](docs/http-error.md#throwifhttperrorresponse) - Throw if a response is non-2xx

### Errors

- [`HttpError`](docs/http-error.md#httperror) - Error class for non-2xx responses
- [`SchemaValidationError`](docs/schema-validation-error.md) - Error class for schema validation failures

## FAQ

### How is this different from Ky?

[Ky](https://github.com/sindresorhus/ky) is a full-featured HTTP client with its own API (`ky.get()`, `.json()`, etc.). This package instead gives you individual utilities that wrap the standard `fetch` function. You pick only what you need and compose them together. If you want a batteries-included client, use Ky. If you want to stay close to the `fetch` API while adding specific capabilities, use this.

### How do I use a proxy?

This package wraps the standard `fetch` API, so proxy support comes from the runtime. In Node.js, use the [`--use-env-proxy`](https://nodejs.org/learn/http/enterprise-network-configuration) flag.

## Related

- [is-network-error](https://github.com/sindresorhus/is-network-error) - Check if a value is a Fetch network error
- [ky](https://github.com/sindresorhus/ky) - HTTP client based on Fetch
- [parse-sse](https://www.npmjs.com/package/parse-sse) - Parse Server-Sent Events (SSE) from a Response
