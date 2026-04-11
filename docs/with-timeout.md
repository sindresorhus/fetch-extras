# withTimeout

## withTimeout(timeout)

Wraps a fetch function with timeout functionality.

Use a single `withTimeout()` in a wrapper pipeline. Nested `withTimeout()` wrappers are unsupported and only the outermost documented timeout budget should be relied on.

## Parameters

- `timeout` (`number`) - Timeout in milliseconds.

## Returns

A function that takes a fetch function and returns a wrapped fetch function that will abort if the request takes longer than the specified timeout.

## Example

```js
import {withTimeout} from 'fetch-extras';

const fetchWithTimeout = withTimeout(5000)(fetch);
const response = await fetchWithTimeout('/api');
const data = await response.json();
```

Can be combined with other `with*` functions:

```js
import {pipeline, withHttpError, withTimeout} from 'fetch-extras';

const fetchWithAll = pipeline(
	fetch,
	withTimeout(5000),
	withHttpError(),
);

const response = await fetchWithAll('/api');
```
