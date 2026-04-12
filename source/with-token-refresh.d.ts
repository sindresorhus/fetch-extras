/**
Wraps a fetch function to automatically refresh the token and retry the request on a `401 Unauthorized` response.

On a 401 response, calls `refreshToken` to obtain a new token, then retries the request once with `Authorization: Bearer <token>`. Requests that already use a non-bearer `Authorization` scheme are returned as-is, because this wrapper only knows how to refresh bearer tokens. Refresh failures or retries that still return a non-2xx status are also returned as-is. Abort signals are still respected and will reject the call.

Concurrent 401 responses that overlap while a refresh is still pending share a single `refreshToken` call when they have the same resolved request origin and effective `Authorization` header, preventing token invalidation races across requests for the same auth context. Requests on different origins or with different effective `Authorization` headers refresh separately.

When a request URL cannot be resolved to an absolute origin, deduplication stays conservative and only shares within the same wrapped fetch function.

> Important: Deduplication only applies while the refresh promise is still pending. Once it settles, it is forgotten immediately. A later `401` starts a new refresh on purpose instead of reusing a settled token result.

> Note: Retrying an `options.body` `ReadableStream` requires buffering it with `ReadableStream#tee()`. This keeps streamed uploads replayable for a single retry, but it also means the streamed body is buffered in memory while the retry is possible. Request bodies are not pre-buffered, so a `Request` with its own body is only retried when you provide a replacement `options.body`.

> Note: Wrappers outside `withTokenRefresh()` only observe the initial call, not the internal retry. For example, if you want upload progress for both the first send and the retry, compose `withUploadProgress()` inside `withTokenRefresh()`.

Can be combined with other `with*` functions. In documented `pipeline()` order, place `withTokenRefresh` before `withHttpError` so it can see the raw 401 response:

```
const apiFetch = pipeline(
	fetch,
	withTokenRefresh({refreshToken: ...}),
	withHttpError(),
);
```

@param options - Token refresh options.
@returns A function that takes a fetch function and returns a wrapped fetch function that retries once with a refreshed `Authorization: Bearer <token>` header on 401 responses, unless the request already used a different `Authorization` scheme.

@example
```
import {withTokenRefresh} from 'fetch-extras';

const apiFetch = withTokenRefresh({
	refreshToken: async () => {
		const response = await fetch('/auth/refresh', {method: 'POST'});
		const {accessToken} = await response.json();
		return accessToken;
	},
})(fetch);

const response = await apiFetch('/api/users');
const data = await response.json();
```

@example
```
import {pipeline, withHttpError, withTokenRefresh, withBaseUrl} from 'fetch-extras';

const apiFetch = pipeline(
	fetch,
	withBaseUrl('https://api.example.com'),
	withTokenRefresh({
		refreshToken: async () => {
			const response = await fetch('/auth/refresh', {method: 'POST'});
			const {accessToken} = await response.json();
			return accessToken;
		},
	}),
	withHttpError(),
);

const response = await apiFetch('/users');
```
*/
export function withTokenRefresh(
	options: {
		/**
		Called when a 401 response is received and the request is anonymous or already uses bearer auth. Should return the new token string.
		*/
		refreshToken: () => string | Promise<string>;
	}
): (fetchFunction: typeof fetch) => typeof fetch;
