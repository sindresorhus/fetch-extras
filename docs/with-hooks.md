# withHooks

## withHooks(fetchFunction, options?)

Wraps a fetch function with hooks that run before each request and after each response.

This is the recommended way to add custom logic (logging, metrics, dynamic headers, response transformation) in documented `pipeline()` order after request-building wrappers, `withRetry()`, and `withTokenRefresh()`, but before `withHttpError()`. Hooks receive the effective request state for their stage, including URL, headers, and replayable body transformations already prepared by upstream wrappers in documented `pipeline()` order. When combined with `withTokenRefresh()`, hooks observe the public call and the final response returned to the caller. The internal refresh retry is not re-hooked.

## Parameters

- `fetchFunction` (`typeof fetch`) - The fetch function to wrap (usually the global `fetch`).
- `options` (`object`)
  - `beforeRequest` (`(context) => RequestInit | Response | void | Promise<RequestInit | Response | void>`) - Called before each request. The context object has `{url, options}` where `url` is the resolved URL string and `options` is the effective `RequestInit` for that stage. Return a replacement `RequestInit` to modify the request options, return a `Response` to short-circuit the request entirely (skipping the fetch call and `afterResponse`), or return `undefined` to leave them unchanged.
  - `afterResponse` (`(context) => Response | void | Promise<Response | void>`) - Called after each response. The context object has `{url, options, response}` where `options` is the same effective `RequestInit` used for that hooked request. Return a replacement `Response` to modify the response, or return `undefined` to leave it unchanged.

## Returns

A wrapped fetch function with hooks.

> [!TIP]
> The `url` provided to hooks is the resolved URL (after `withBaseUrl`, `withSearchParameters`, etc.), so it reflects the actual URL being requested.

> [!IMPORTANT]
> When returning modified options from `beforeRequest`, spread the original `options` to preserve any metadata set by upstream wrappers: `return {...options, headers: {...}}`.

> [!IMPORTANT]
> In documented `pipeline()` order, hook `options` already include request-building effects from upstream wrappers such as `withHeaders()` and `withJsonBody()`. Hooks should treat that state as the prepared request for their stage.

> [!TIP]
> In documented `pipeline()` order, place `withHooks` after request-building wrappers, `withRetry()`, and `withTokenRefresh()`, but before `withHttpError()`. In that order, `withRetry()` replays the same hooked request, while `withTokenRefresh()` remains a self-contained wrapper whose internal retry is not re-hooked.

## Example

Logging:

```js
import {withHooks} from 'fetch-extras';

const fetchWithLogging = withHooks(fetch, {
	beforeRequest({url, options}) {
		console.log('→', options.method ?? 'GET', url);
	},
	afterResponse({url, response}) {
		console.log('←', response.status, url);
	},
});

const response = await fetchWithLogging('https://api.example.com/users');
```

Adding a dynamic header to every request:

```js
import {withHooks} from 'fetch-extras';

const fetchWithRequestId = withHooks(fetch, {
	beforeRequest({options}) {
		return {
			...options,
			headers: {
				...options.headers,
				'X-Request-ID': crypto.randomUUID(),
			},
		};
	},
});
```

Can be combined with other `with*` functions:

```js
import {pipeline, withBaseUrl, withHeaders, withRetry, withTokenRefresh, withHooks, withHttpError} from 'fetch-extras';

const apiFetch = pipeline(
	fetch,
	f => withBaseUrl(f, 'https://api.example.com'),
	f => withHeaders(f, {Authorization: 'Bearer token'}),
	f => withRetry(f, {retries: 2}),
	f => withTokenRefresh(f, {
		async refreshToken() {
			return 'new-token';
		},
	}),
	f => withHooks(f, {
		beforeRequest({url, options}) {
			console.log('→', options.method ?? 'GET', url);
		},
		afterResponse({url, response}) {
			console.log('←', response.status, url);
		},
	}),
	withHttpError,
);

const response = await apiFetch('/users');
```
