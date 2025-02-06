/**
Custom error class for HTTP errors that should be thrown when the response has a non-200 status code.
*/
export class HttpError extends Error {
	readonly name: 'HttpError';
	readonly code: 'ERR_HTTP_RESPONSE_NOT_OK';
	response: Response;

	/**
	Constructs a new `HttpError` instance.

	@param response - The `Response` object that caused the error.
	*/
	constructor(response: Response);
}

/**
Throws an `HttpError` if the response is not ok (non-200 status code).

@param response - The `Response` object to check.
@returns The same `Response` object if it is ok.
@throws {HttpError} If the response is not ok.

@example
```
import {throwIfHttpError} from 'fetch-extras';

const response = await fetch('/api');
throwIfHttpError(response);
const data = await response.json();
```
*/
export function throwIfHttpError(response: Response): Response;

/**
Throws an `HttpError` if the response is not ok (non-200 status code).

@param responsePromise - A promise that resolves to a `Response` object to check.
@returns A promise that resolves to the same `Response` object if it is ok.
@throws {HttpError} If the response is not ok.

@example
```
import {throwIfHttpError} from 'fetch-extras';

const response = await throwIfHttpError(fetch('/api'));
const data = await response.json();
```
*/
export function throwIfHttpError(responsePromise: Promise<Response>): Promise<Response>;

/**
Wraps a fetch function to automatically throw `HttpError` for non-200 responses.

Can be combined with other `with*` methods.

@param fetchFunction - The fetch function to wrap (usually the global `fetch`).
@returns A wrapped fetch function that will throw HttpError for non-200 responses.

@example
```
import {withHttpError} from 'fetch-extras';

const fetchWithError = withHttpError(fetch);
const response = await fetchWithError('/api'); // Throws HttpError if status is not 200-299
const data = await response.json();
```
*/
export function withHttpError(
	fetchFunction: typeof fetch
): typeof fetch;

/**
Wraps a fetch function with timeout functionality.

Can be combined with other `with*` methods.

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
*/
export function withTimeout(
	fetchFunction: typeof fetch,
	timeout: number
): typeof fetch;
