type HookRequestInit<Arguments extends unknown[]> = Arguments extends [unknown]
	? RequestInit
	: Arguments extends [unknown, ...infer Rest]
		? Rest extends [infer RequestInit_]
			? Exclude<RequestInit_, undefined>
			: Rest extends [(infer RequestInit_)?]
				? Exclude<RequestInit_, undefined>
				: RequestInit
		: RequestInit;

type HookResponse<FetchFunction extends typeof fetch> = Awaited<ReturnType<FetchFunction>>;

/**
Wraps a fetch function with hooks that run before each request and after each response.

This is the recommended way to add custom logic (logging, metrics, dynamic headers, response transformation) in documented `pipeline()` order after request-building wrappers, `withRetry()`, and `withTokenRefresh()`, but before `withHttpError()`. Hooks receive the effective request state for their stage, including URL, headers, and replayable body transformations already prepared by upstream wrappers in documented `pipeline()` order. When combined with `withTokenRefresh()`, hooks observe the public call and the final response returned to the caller. The internal refresh retry is not re-hooked.

Can be combined with other `with*` functions:

```
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
```

@param fetchFunction - The fetch function to wrap (usually the global `fetch`).
@param options - Hook options.
@returns A wrapped fetch function with hooks.

@example
```
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

@example
```
import {withHooks} from 'fetch-extras';

// Add a dynamic request ID header to every request
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
*/
export function withHooks<FetchFunction extends typeof fetch>(
	fetchFunction: FetchFunction,
	options?: {
		/**
		Called before each request. Receives the resolved URL and the effective request options for that stage.

		Return a replacement `RequestInit` to modify the request options, return a `Response` to short-circuit the request entirely (skipping the fetch call and `afterResponse`), or return `undefined` to leave them unchanged.
		*/
		readonly beforeRequest?: (context: {
			readonly url: string;
			readonly options: HookRequestInit<Parameters<FetchFunction>>;
		}) => HookRequestInit<Parameters<FetchFunction>> | HookResponse<FetchFunction> | void | Promise<HookRequestInit<Parameters<FetchFunction>> | HookResponse<FetchFunction> | void>;

		/**
		Called after each response. Receives the response, resolved URL, and the same effective request options used for that hooked request.

		Return a replacement `Response` to modify the response, or return `undefined` to leave it unchanged.
		*/
		readonly afterResponse?: (context: {
			readonly url: string;
			readonly options: HookRequestInit<Parameters<FetchFunction>>;
			readonly response: HookResponse<FetchFunction>;
		}) => HookResponse<FetchFunction> | void | Promise<HookResponse<FetchFunction> | void>;
	},
): (...arguments_: Parameters<FetchFunction>) => ReturnType<FetchFunction>;
