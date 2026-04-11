/**
`RequestInit` with `body` extended to also accept plain objects and arrays that will be auto-serialized as JSON.
*/
export type JsonBodyRequestInit = Omit<RequestInit, 'body'> & {
	readonly body?: RequestInit['body'] | Record<string, unknown> | readonly unknown[];
};

/**
Wraps a fetch function to automatically stringify plain-object and array bodies as JSON and set the `Content-Type: application/json` header.

Only plain objects (`{}`) and arrays are auto-serialized. Other body types like strings, `FormData`, `Blob`, and `ReadableStream` are passed through unchanged.

If you need a custom `Content-Type` (e.g., `application/vnd.api+json`), set it explicitly in the request headers and it will not be overridden.

When replacing the body of an existing `Request`, the original request `Content-Type` is not preserved. Set the replacement `Content-Type` in `init.headers` or with `withHeaders()` if you need one.

Can be combined with other `with*` functions.

@returns A function that accepts a fetch function and returns a wrapped fetch function that auto-serializes JSON bodies.

@example
```
import {withJsonBody} from 'fetch-extras';

const fetchWithJson = withJsonBody()(fetch);

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
	withBaseUrl('https://api.example.com'),
	withJsonBody(),
	withHttpError(),
);

const response = await apiFetch('/users', {
	method: 'POST',
	body: {name: 'Alice'},
});
```
*/
export function withJsonBody(): (
	fetchFunction: typeof fetch
) => (input: RequestInfo | URL, init?: JsonBodyRequestInit) => Promise<Response>;
