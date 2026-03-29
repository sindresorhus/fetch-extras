/**
Wraps a fetch function with timeout functionality.

Can be combined with other `with*` functions.

@param fetchFunction - The fetch function to wrap (usually the global `fetch`).
@param timeout - Timeout in milliseconds.
@returns A wrapped fetch function that will abort if the request takes longer than the specified timeout.

@example
```
import {withTimeout} from 'fetch-extras';

const fetchWithTimeout = withTimeout(fetch, 5000);
const response = await fetchWithTimeout('/api');
const data = await response.json();
```

@example
```
import {pipeline, withHttpError, withTimeout} from 'fetch-extras';

const fetchWithAll = pipeline(
	fetch,
	f => withTimeout(f, 5000),
	withHttpError,
);

const response = await fetchWithAll('/api');
```
*/
export function withTimeout(
	fetchFunction: typeof fetch,
	timeout: number
): typeof fetch;
