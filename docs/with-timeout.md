# withTimeout

## withTimeout(fetchFunction, timeout)

Wraps a fetch function with timeout functionality.

Use a single `withTimeout()` in a wrapper pipeline. Nested `withTimeout()` wrappers are unsupported and only the outermost documented timeout budget should be relied on.

## Parameters

- `fetchFunction` (`typeof fetch`) - The fetch function to wrap (usually the global `fetch`).
- `timeout` (`number`) - Timeout in milliseconds.

## Returns

A wrapped fetch function that will abort if the request takes longer than the specified timeout.

## Example

```js
import {withTimeout} from 'fetch-extras';

const fetchWithTimeout = withTimeout(fetch, 5000);
const response = await fetchWithTimeout('/api');
const data = await response.json();
```

Can be combined with other `with*` functions:

```js
import {pipeline, withHttpError, withTimeout} from 'fetch-extras';

const fetchWithAll = pipeline(
	fetch,
	f => withTimeout(f, 5000),
	withHttpError,
);

const response = await fetchWithAll('/api');
```
