# withTimeout

## withTimeout(fetchFunction, timeout)

Wraps a fetch function with timeout functionality.

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
import {withHttpError, withTimeout} from 'fetch-extras';

const fetchWithAll = withHttpError(withTimeout(fetch, 5000));
const response = await fetchWithAll('/api');
```
