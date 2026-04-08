/**
`RequestInit` with `body` extended to also accept plain objects and arrays that will be auto-serialized as JSON.
*/
export type JsonBodyRequestInit = Omit<RequestInit, 'body'> & {
	readonly body?: RequestInit['body'] | Record<string, unknown> | readonly unknown[];
};

type JsonBodyWrappedDefinedRequestInit<RequestInit> = RequestInit extends {readonly body?: never}
	? RequestInit
	: RequestInit extends {body?: infer Body}
		? {[Key in keyof RequestInit]: Key extends 'body' ? Body | JsonBodyRequestInit['body'] : RequestInit[Key]}
		: RequestInit;

type JsonBodyWrappedRequestInit<RequestInit> = undefined extends RequestInit
	? JsonBodyWrappedDefinedRequestInit<Exclude<RequestInit, undefined>> | undefined
	: JsonBodyWrappedDefinedRequestInit<RequestInit>;

type JsonBodyWrappedArguments<Arguments extends unknown[]> = Arguments extends [infer Input]
	? [input: Input]
	: Arguments extends [infer Input, ...infer Rest]
		? Rest extends [infer RequestInit_]
			? [input: Input, init: JsonBodyWrappedRequestInit<RequestInit_>]
			: Rest extends [(infer RequestInit_)?]
				? [input: Input, init?: JsonBodyWrappedRequestInit<RequestInit_>]
				: Arguments
		: Arguments;

type JsonBodyWrappedFetch<FetchFunction extends typeof fetch> = (...arguments_: JsonBodyWrappedArguments<Parameters<FetchFunction>>) => ReturnType<FetchFunction>;

/**
Returns a wrapped fetch function that automatically stringifies plain-object and array bodies as JSON and sets the `Content-Type: application/json` header.

Only plain objects (`{}`) and arrays are auto-serialized. Other body types like strings, `FormData`, `Blob`, and `ReadableStream` are passed through unchanged.

If you need a custom `Content-Type` (e.g., `application/vnd.api+json`), set it explicitly in the request headers and it will not be overridden.

When replacing the body of an existing `Request`, the original request `Content-Type` is not preserved. Set the replacement `Content-Type` in `init.headers` or with `withHeaders()` if you need one.

Can be combined with other `with*` functions.

@param fetchFunction - The fetch function to wrap (usually the global `fetch`).
@returns A wrapped fetch function that auto-serializes JSON bodies.

@example
```
import {withJsonBody} from 'fetch-extras';

const fetchWithJson = withJsonBody(fetch);

const response = await fetchWithJson('/api/users', {
	method: 'POST',
	body: {name: 'Alice', age: 30},
});
// Sends JSON.stringify({name: 'Alice', age: 30}) with Content-Type: application/json
```

@example
```
import {pipeline, withJsonBody, withBaseUrl, withHttpError} from 'fetch-extras';

const apiFetch = pipeline(
	fetch,
	f => withBaseUrl(f, 'https://api.example.com'),
	withJsonBody,
	withHttpError,
);

const response = await apiFetch('/users', {
	method: 'POST',
	body: {name: 'Alice'},
});
```
*/
export function withJsonBody<FetchFunction extends (input: RequestInfo | URL, ...arguments_: any[]) => Promise<Response>>(
	fetchFunction: FetchFunction
): JsonBodyWrappedFetch<FetchFunction>;
