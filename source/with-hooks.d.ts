/**
Wraps a fetch function with hooks that run before each request and after each response.

This is the recommended way to add custom logic (logging, metrics, dynamic headers, response transformation) in documented `pipeline()` order after request-building wrappers, `withRetry()`, and `withTokenRefresh()`, but before `withHttpError()`. Hooks receive the effective request state for their stage, including URL, headers, and replayable body transformations already prepared by upstream wrappers in documented `pipeline()` order. When combined with `withTokenRefresh()`, hooks observe the public call and the final response returned to the caller. The internal refresh retry is not re-hooked.

Can be combined with other `with*` functions:

```
const apiFetch = pipeline(
	fetch,
	withBaseUrl('https://api.example.com'),
	withHeaders({Authorization: 'Bearer token'}),
	withRetry({retries: 2}),
	withTokenRefresh({
		async refreshToken() {
			return 'new-token';
		},
	}),
	withHooks({
		beforeRequest({url, options}) {
			console.log('→', options.method ?? 'GET', url);
		},
		afterResponse({url, response}) {
			console.log('←', response.status, url);
		},
	}),
	withHttpError(),
);
```

@param options - Hook options.
@returns A wrapper that takes a fetch function and returns a wrapped fetch function with hooks.

@example
```
import {withHooks} from 'fetch-extras';

const fetchWithLogging = withHooks({
	beforeRequest({url, options}) {
		console.log('→', options.method ?? 'GET', url);
	},
	afterResponse({url, response}) {
		console.log('←', response.status, url);
	},
})(fetch);

const response = await fetchWithLogging('https://api.example.com/users');
```

@example
```
import {withHooks} from 'fetch-extras';

// Add a dynamic request ID header to every request
const fetchWithRequestId = withHooks({
	beforeRequest({options}) {
		return {
			...options,
			headers: {
				...options.headers,
				'X-Request-ID': crypto.randomUUID(),
			},
		};
	},
})(fetch);
```
*/
export function withHooks(
	options?: {
		/**
		Called before each request. Receives the resolved URL and the effective request options for that stage.

		Return a replacement `RequestInit` to modify the request options, return a `Response` to short-circuit the request entirely (skipping the fetch call and `afterResponse`), or return `undefined` to leave them unchanged.
		*/
		readonly beforeRequest?: (context: {
			readonly url: string;
			readonly options: RequestInit;
		}) => RequestInit | Response | void | Promise<RequestInit | Response | void>;

		/**
		Called after each response. Receives the response, resolved URL, and the same effective request options used for that hooked request.

		Return a replacement `Response` to modify the response, or return `undefined` to leave it unchanged.
		*/
		readonly afterResponse?: (context: {
			readonly url: string;
			readonly options: RequestInit;
			readonly response: Response;
		}) => Response | void | Promise<Response | void>;
	},
): (fetchFunction: typeof fetch) => typeof fetch;
