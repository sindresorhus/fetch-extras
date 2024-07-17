/**
Custom error class for HTTP errors that should be thrown when the response has a non-200 status code.
*/
export class HttpError extends Error {
	name: 'HttpError';
	code: 'ERR_HTTP_RESPONSE_NOT_OK';
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
