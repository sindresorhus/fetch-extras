# HttpError / throwIfHttpError / withHttpError

## HttpError

Error class thrown when a response has a non-2xx status code.

```js
import {HttpError, throwIfHttpError} from 'fetch-extras';

try {
	await throwIfHttpError(fetch('/api'));
} catch (error) {
	if (error instanceof HttpError) {
		console.log(error.response.status); // 404
	}
}
```

## throwIfHttpError(response)

Throws an `HttpError` if the response is not ok. Can also accept a promise that resolves to a response.

```js
import {throwIfHttpError} from 'fetch-extras';

const response = await throwIfHttpError(fetch('/api'));
const data = await response.json();
```

## withHttpError(fetchFunction)

Returns a wrapped fetch function that automatically throws `HttpError` for non-2xx responses.

```js
import {withHttpError} from 'fetch-extras';

const fetchWithError = withHttpError(fetch);
const response = await fetchWithError('/api');
```
