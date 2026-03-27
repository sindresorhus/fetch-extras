# HttpError / throwIfHttpError / withHttpError

## HttpError

Custom error class for HTTP errors that should be thrown when the response has a non-2xx status code.

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

Throws an `HttpError` if the response is not ok (non-2xx status code). Can also accept a promise that resolves to a response.

```js
import {throwIfHttpError} from 'fetch-extras';

const response = await fetch('/api');
throwIfHttpError(response);
const data = await response.json();
```

```js
import {throwIfHttpError} from 'fetch-extras';

const response = await throwIfHttpError(fetch('/api'));
const data = await response.json();
```

## withHttpError(fetchFunction)

Wraps a fetch function to automatically throw `HttpError` for non-2xx responses.

Can be combined with other `with*` functions.

```js
import {withHttpError} from 'fetch-extras';

const fetchWithError = withHttpError(fetch);
const response = await fetchWithError('/api'); // Throws HttpError for non-2xx responses
const data = await response.json();
```
