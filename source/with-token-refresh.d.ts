/**
Wraps a fetch function to automatically refresh the token and retry the request on a `401 Unauthorized` response.

On a 401 response, calls `refreshToken` to obtain a new token, then retries the request once with `Authorization: Bearer <token>`. If the refresh fails or the retry also returns a non-2xx status, the response is returned as-is. Abort signals are still respected and will reject the call.

Concurrent 401 responses that overlap while a refresh is still pending share a single `refreshToken` call to prevent token invalidation races.

> Important: Deduplication only applies while the refresh promise is still pending. Once it settles, it is forgotten immediately. A later `401` starts a new refresh on purpose instead of reusing a settled token result.

> Note: Retrying an `options.body` `ReadableStream` requires buffering it with `ReadableStream#tee()`. This keeps streamed uploads replayable for a single retry, but it also means the streamed body is buffered in memory while the retry is possible. Request bodies are not pre-buffered, so a `Request` with its own body is only retried when you provide a replacement `options.body`.

> Note: Wrappers outside `withTokenRefresh()` only observe the initial call, not the internal retry. For example, if you want upload progress for both the first send and the retry, compose `withUploadProgress()` inside `withTokenRefresh()`.

Can be combined with other `with*` functions. Should be composed inside `withHttpError` so it can see the raw 401 response:

```
const apiFetch = pipeline(
	fetch,
	f => withTokenRefresh(f, {refreshToken: ...}),
	withHttpError,
);
```

@param fetchFunction - The fetch function to wrap (usually the global `fetch`).
@param options - Token refresh options.
@returns A wrapped fetch function that retries once with a refreshed `Authorization: Bearer <token>` header on 401 responses.

@example
```
import {withTokenRefresh} from 'fetch-extras';

const apiFetch = withTokenRefresh(fetch, {
	refreshToken: async () => {
		const response = await fetch('/auth/refresh', {method: 'POST'});
		const {accessToken} = await response.json();
		return accessToken;
	},
});

const response = await apiFetch('/api/users');
const data = await response.json();
```

@example
```
import {pipeline, withHttpError, withTokenRefresh, withBaseUrl} from 'fetch-extras';

const apiFetch = pipeline(
	fetch,
	f => withBaseUrl(f, 'https://api.example.com'),
	f => withTokenRefresh(f, {
		refreshToken: async () => {
			const response = await fetch('/auth/refresh', {method: 'POST'});
			const {accessToken} = await response.json();
			return accessToken;
		},
	}),
	withHttpError,
);

const response = await apiFetch('/users');
```
*/
export function withTokenRefresh(
	fetchFunction: typeof fetch,
	options: {
		/**
		Called when a 401 response is received. Should return the new token string.
		*/
		refreshToken: () => string | Promise<string>;
	}
): typeof fetch;
