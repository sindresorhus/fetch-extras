# withDeduplication

## withDeduplication()

Wraps a fetch function with in-flight request deduplication for plain GET URL requests.

If multiple callers request the same URL concurrently without passing a `Request` object or any non-empty `RequestInit`, only one network request is made. Each caller receives an independent clone of the response. Once the request completes, the result is immediately forgotten, so a later request starts a fresh fetch.

Non-GET requests, `Request` objects, calls with non-empty `RequestInit`, and fetch functions already wrapped with `withTimeout` pass through unchanged.

## Returns

A function that accepts a fetch function and returns a wrapped fetch function that deduplicates concurrent plain GET URL requests.

> [!NOTE]
> Deduplication only applies when you call the wrapper with a URL and no non-empty `RequestInit`. An empty `{}` is treated the same as omitting the second argument so transparent outer wrappers like `withHttpError` still compose correctly.

> [!NOTE]
> `withDeduplication` does not deduplicate fetch functions already wrapped with `withTimeout`. In documented `pipeline()` order, place `withTimeout` before `withDeduplication` if you need per-call timeout behavior.

> [!TIP]
> In documented `pipeline()` order, place `withDeduplication` after `withBaseUrl` so the deduplication key is the resolved absolute URL.

## Example

```js
import {withDeduplication} from 'fetch-extras';

const deduplicatedFetch = withDeduplication()(fetch);

// These two concurrent requests result in only one network call
const [response1, response2] = await Promise.all([
	deduplicatedFetch('https://api.example.com/data'),
	deduplicatedFetch('https://api.example.com/data'),
]);
```

Can be combined with other `with*` functions:

```js
import {pipeline, withHttpError, withDeduplication, withBaseUrl} from 'fetch-extras';

const apiFetch = pipeline(
	fetch,
	withBaseUrl('https://api.example.com'),
	withDeduplication(),
	withHttpError(),
);

const response = await apiFetch('/users');
```
