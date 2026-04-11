import {
	blockedDefaultHeaderNamesSymbol,
	blockedRequestBodyHeaderNames,
	copyFetchMetadata,
	deleteHeaders,
	inheritedRequestBodyHeaderNamesSymbol,
	requestSnapshot,
	resolveRequestBodySymbol,
	resolveRequestHeadersSymbol,
	setHeaders,
} from './utilities.js';

function isPlainObject(value) {
	if (typeof value !== 'object' || value === null) {
		return false;
	}

	const prototype = Object.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null;
}

function getRequestForHeaders(urlOrRequest) {
	if (!(urlOrRequest instanceof Request)) {
		return urlOrRequest;
	}

	const request = new Request(urlOrRequest.url, {
		...requestSnapshot(urlOrRequest),
		headers: deleteHeaders(new Headers(urlOrRequest.headers), blockedRequestBodyHeaderNames),
	});
	request[blockedDefaultHeaderNamesSymbol] = urlOrRequest[blockedDefaultHeaderNamesSymbol];
	return request;
}

const blockedJsonDefaultHeaderNames = blockedRequestBodyHeaderNames.filter(headerName => headerName !== 'content-type');

async function getJsonHeaders(fetchFunction, urlOrRequest, options) {
	const inheritedHeaderNames = options[inheritedRequestBodyHeaderNamesSymbol] ?? [];
	const requestForHeaders = getRequestForHeaders(urlOrRequest);
	const headers = new Headers(await fetchFunction[resolveRequestHeadersSymbol]?.(requestForHeaders, options) ?? (requestForHeaders instanceof Request ? requestForHeaders.headers : undefined));
	const callHeaders = new Headers(options.headers);
	const contentType = callHeaders.get('content-type')
		?? headers.get('content-type');

	deleteHeaders(headers, blockedRequestBodyHeaderNames);
	deleteHeaders(callHeaders, blockedRequestBodyHeaderNames);
	deleteHeaders(callHeaders, inheritedHeaderNames);
	setHeaders(headers, callHeaders);

	if (contentType) {
		headers.set('content-type', contentType);
	} else {
		headers.set('content-type', 'application/json');
	}

	return headers;
}

function getBlockedJsonDefaultHeaderNames(options) {
	return [
		...(options[blockedDefaultHeaderNamesSymbol] ?? []),
		...blockedJsonDefaultHeaderNames,
	];
}

function getJsonBody(options) {
	return JSON.stringify(options.body);
}

async function getJsonRequestOptions(fetchFunction, urlOrRequest, options) {
	return {
		...options,
		[blockedDefaultHeaderNamesSymbol]: getBlockedJsonDefaultHeaderNames(options),
		body: getJsonBody(options),
		headers: await getJsonHeaders(fetchFunction, urlOrRequest, options),
	};
}

function shouldJsonifyBody(body) {
	return isPlainObject(body) || Array.isArray(body);
}

/**
Returns a wrapped fetch function that automatically stringifies plain-object and array bodies as JSON and sets the `Content-Type: application/json` header.

@returns {(fetchFunction: typeof fetch) => typeof fetch} A function that accepts a fetch function and returns a wrapped fetch function that auto-serializes JSON bodies.
*/
export function withJsonBody() {
	return fetchFunction => {
		const fetchWithJsonBody = async (urlOrRequest, options = {}) => {
			if (shouldJsonifyBody(options.body)) {
				options = await getJsonRequestOptions(fetchFunction, urlOrRequest, options);
			}

			return fetchFunction(urlOrRequest, options);
		};

		fetchWithJsonBody[resolveRequestHeadersSymbol] = function (urlOrRequest, options = {}) {
			if (shouldJsonifyBody(options.body)) {
				return getJsonHeaders(fetchFunction, urlOrRequest, options);
			}

			return fetchFunction[resolveRequestHeadersSymbol]?.(urlOrRequest, options);
		};

		fetchWithJsonBody[resolveRequestBodySymbol] = function (urlOrRequest, options = {}) {
			if (shouldJsonifyBody(options.body)) {
				return getJsonBody(options);
			}

			return fetchFunction[resolveRequestBodySymbol]?.(urlOrRequest, options) ?? options.body;
		};

		return copyFetchMetadata(fetchWithJsonBody, fetchFunction);
	};
}
