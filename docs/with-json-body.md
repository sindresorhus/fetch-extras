# withJsonBody

## withJsonBody(fetchFunction)

Returns a wrapped fetch function that automatically stringifies plain-object and array bodies as JSON and sets the `Content-Type: application/json` header.

```js
import {withJsonBody} from 'fetch-extras';

const fetchWithJson = withJsonBody(fetch);

const response = await fetchWithJson('/api/users', {
	method: 'POST',
	body: {name: 'Alice', age: 30},
});
// Sends JSON.stringify({name: 'Alice', age: 30}) with Content-Type: application/json
```

## Parameters

- `fetchFunction` (`typeof fetch`) - The fetch function to wrap (usually the global `fetch`).

## Returns

A wrapped fetch function that auto-serializes JSON bodies.

> [!NOTE]
> Only plain objects (`{}`) and arrays are auto-serialized. Other body types like strings, `FormData`, `Blob`, and `ReadableStream` are passed through unchanged.

> [!TIP]
> If you need a custom `Content-Type` (e.g., `application/vnd.api+json`), set it explicitly in the request headers and it will not be overridden.

> [!NOTE]
> When replacing the body of an existing `Request`, the original request `Content-Type` is not preserved. Set the replacement `Content-Type` in `init.headers` or with `withHeaders()` if you need one.

## Example

Can be combined with other `with*` functions:

```js
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
