import {copyFetchMetadata} from './utilities.js';

function formatErrorUrl(url) {
	if (!url) {
		return url;
	}

	try {
		const parsedUrl = new URL(url);
		parsedUrl.username = '';
		parsedUrl.password = '';
		return parsedUrl.href;
	} catch {
		return url;
	}
}

export class HttpError extends Error {
	constructor(response) {
		const status = `${response.status} ${response.statusText}`.trim();
		const reason = status ? `status code ${status}` : 'an unknown error';
		const errorUrl = formatErrorUrl(response.url);

		super(`Request failed with ${reason}: ${errorUrl}`);
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
