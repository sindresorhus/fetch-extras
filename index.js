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

export async function throwIfHttpError(responseOrPromise) {
	if (!(responseOrPromise instanceof Response)) {
		responseOrPromise = await responseOrPromise;
	}

	if (!responseOrPromise.ok) {
		throw new HttpError(responseOrPromise);
	}

	return responseOrPromise;
}

export function withTimeout(fetchFunction, timeout) {
	return async (urlOrRequest, options = {}) => {
		const providedSignal = options.signal ?? (urlOrRequest instanceof Request && urlOrRequest.signal);
		const timeoutSignal = AbortSignal.timeout(timeout);
		const signal = providedSignal ? AbortSignal.any([providedSignal, timeoutSignal]) : timeoutSignal;
		return fetchFunction(urlOrRequest, {...options, signal});
	};
}
