import {copyFetchMetadata} from './utilities.js';

export class HttpError extends Error {
	constructor(response) {
		const status = `${response.status} ${response.statusText}`.trim();
		const reason = status ? `status code ${status}` : 'an unknown error';

		super(`Request failed with ${reason}: ${response.url}`);
		Error.captureStackTrace?.(this, this.constructor);

		this.name = 'HttpError';
		this.code = 'ERR_HTTP_RESPONSE_NOT_OK';
		this.response = response;
	}
}

const throwIfHttpErrorAsync = async responsePromise => throwIfHttpError(await responsePromise);

export function throwIfHttpError(responseOrPromise) {
	if (typeof responseOrPromise?.then === 'function') {
		return throwIfHttpErrorAsync(responseOrPromise);
	}

	if (!responseOrPromise.ok) {
		throw new HttpError(responseOrPromise);
	}

	return responseOrPromise;
}

export function withHttpError() {
	return fetchFunction => {
		const fetchWithHttpError = async (urlOrRequest, options = {}) => {
			const response = await fetchFunction(urlOrRequest, options);
			return throwIfHttpError(response);
		};

		return copyFetchMetadata(fetchWithHttpError, fetchFunction);
	};
}
