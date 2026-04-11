/**
Wraps a fetch function with timeout functionality.

Can be combined with other `with*` functions.

@param timeout - Timeout in milliseconds.
@returns A wrapper that takes a fetch function and returns a wrapped fetch function that will abort if the request takes longer than the specified timeout.

@example
```
import {withTimeout} from 'fetch-extras';

const fetchWithTimeout = withTimeout(5000)(fetch);
const response = await fetchWithTimeout('/api');
const data = await response.json();
```

@example
```
import {pipeline, withHttpError, withTimeout} from 'fetch-extras';

const fetchWithAll = pipeline(
	fetch,
	withTimeout(5000),
	withHttpError(),
);

const response = await fetchWithAll('/api');
```
*/
export function withTimeout(
	timeout: number
): (fetchFunction: typeof fetch) => typeof fetch;
