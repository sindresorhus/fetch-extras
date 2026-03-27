import parseLinkHeader from './parse-link-header.js';
import {blockedDefaultHeaderNamesSymbol, delay} from './utilities.js';

const defaultPaginationOptions = {
	async transform(response) {
		return response.json();
	},
	async paginate({response, currentUrl}) {
		const linkHeader = response.headers.get('Link');

		if (!linkHeader?.trim()) {
			return false;
		}

		const links = parseLinkHeader(linkHeader);
		const next = links.find(link => link.parameters.rel?.split(/\s+/).some(relationType => relationType.toLowerCase() === 'next'));

		if (next) {
			return {url: toUrl(next.url, response.url || absoluteUrl(currentUrl)?.href)};
		}

		return false;
	},
	filter: () => true,
	shouldContinue: () => true,
	countLimit: Number.POSITIVE_INFINITY,
	backoff: 0,
	requestLimit: 10_000,
	stackAllItems: false,
};

const requestBodyHeaderNames = [
	'content-encoding',
	'content-language',
	'content-location',
	'content-type',
];
const sensitiveHeaderNames = [
	'authorization',
	'cookie',
	'proxy-authorization',
];

const stripBodyHeaders = headers => {
	const cleanedHeaders = new Headers(headers);
	cleanedHeaders.delete('content-length');

	for (const headerName of requestBodyHeaderNames) {
		cleanedHeaders.delete(headerName);
	}

	return cleanedHeaders;
};

const stripSensitiveHeaders = headers => {
	const cleanedHeaders = new Headers(headers);

	for (const headerName of sensitiveHeaderNames) {
		cleanedHeaders.delete(headerName);
	}

	return cleanedHeaders;
};

const markToBlockDefaultHeaders = (object, headerNames) => {
	object[blockedDefaultHeaderNamesSymbol] = [...headerNames];
	return object;
};

const methodCanHaveBody = method => method === undefined || !['get', 'head'].includes(method.toLowerCase());

const requestSnapshot = request => ({
	method: request.method,
	referrer: request.referrer,
	referrerPolicy: request.referrerPolicy,
	mode: request.mode,
	credentials: request.credentials,
	cache: request.cache,
	redirect: request.redirect,
	integrity: request.integrity,
	keepalive: request.keepalive,
	signal: request.signal,
	duplex: request.duplex,
	priority: request.priority,
});

const requestWithoutBody = request => ({
	...requestSnapshot(request),
	headers: stripBodyHeaders(request.headers),
});

const requestWithoutSensitiveState = request => ({
	...requestWithoutBody(request),
	headers: stripSensitiveHeaders(stripBodyHeaders(request.headers)),
});

const stripBodyHeadersFromFetchOptions = fetchOptions => {
	if (!('headers' in fetchOptions)) {
		return fetchOptions;
	}

	return {
		...fetchOptions,
		headers: stripBodyHeaders(fetchOptions.headers),
	};
};

const normalizeBodylessFetchOptions = fetchOptions => {
	const {body: _body, ...restFetchOptions} = fetchOptions;

	if (!('headers' in restFetchOptions)) {
		return restFetchOptions;
	}

	return {
		...restFetchOptions,
		headers: stripBodyHeaders(restFetchOptions.headers),
	};
};

// URL/string inputs stay on the `fetch(input, init)` path, so body cleanup must happen on the init object itself.
const normalizeFetchOptions = fetchOptions => shouldStripBodyHeaders(fetchOptions) ? normalizeBodylessFetchOptions(fetchOptions) : fetchOptions;

const shouldStripBodyHeaders = fetchOptions => (Object.hasOwn(fetchOptions, 'body') && fetchOptions.body === undefined) || (!methodCanHaveBody(fetchOptions.method) && !Object.hasOwn(fetchOptions, 'body'));
const shouldResetBodyHeaders = fetchOptions => shouldStripBodyHeaders(fetchOptions) || Object.hasOwn(fetchOptions, 'body');
const integerOrInfinity = value => value === Number.POSITIVE_INFINITY || Number.isInteger(value);
const isPaginationFetchOptions = value => typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof URL);
const isCrossOrigin = (currentUrl, nextUrl) => currentUrl.origin !== nextUrl.origin;
const shouldStripInheritedSensitiveState = (inheritedStateOrigin, requestUrl) => inheritedStateOrigin && requestUrl instanceof URL && isCrossOrigin(inheritedStateOrigin, requestUrl);

const toUrl = (input, baseUrl = globalThis.location?.href) => {
	const url = input instanceof Request ? input.url : input;

	if (url instanceof URL) {
		return url;
	}

	if (baseUrl === undefined) {
		return new URL(url);
	}

	return new URL(url, baseUrl);
};

// Custom fetch functions are expected to follow Fetch semantics here: `response.url` is absolute after resolution, or the empty string when unavailable.
const responseUrl = (response, currentUrl) => response.url ? new URL(response.url) : currentUrl;
const absoluteUrl = input => {
	// Custom fetch wrappers can leave `response.url` empty or keep relative inputs unresolved.
	try {
		return toUrl(input);
	} catch {}

	return undefined;
};

// Template-backed requests keep their headers on the Request itself to match `new Request(input, init)` semantics.
const createTemplateFetchOptions = ({body: _body, headers: _headers, ...rest}) => rest;

const createRequestTemplate = (input, fetchOptions) => {
	if (input instanceof Request && shouldResetBodyHeaders(fetchOptions)) {
		// Replacing only the body should keep the inherited request headers, so defer to the platform behavior.
		if (!shouldStripBodyHeaders(fetchOptions)) {
			return new Request(input, fetchOptions);
		}

		// Bodyless requests need explicit cleanup because Fetch only removes the request-body-header names.
		const requestInit = requestWithoutBody(input);
		const nextFetchOptions = stripBodyHeadersFromFetchOptions(fetchOptions);

		if ('headers' in nextFetchOptions) {
			return new Request(input.url, {
				...requestInit,
				...nextFetchOptions,
				headers: new Headers(nextFetchOptions.headers),
			});
		}

		return new Request(input.url, {...requestInit, ...nextFetchOptions});
	}

	return new Request(input, fetchOptions);
};

const currentSignal = (requestTemplate, fetchOptions) => fetchOptions.signal ?? requestTemplate?.signal;
const requestWithoutSensitiveHeaders = request => ({
	...requestSnapshot(request),
	headers: stripSensitiveHeaders(request.headers),
});

const stripInheritedSensitiveState = (requestTemplate, fetchOptions) => ({
	requestTemplate: requestTemplate && markToBlockDefaultHeaders(new Request(requestTemplate.url, requestTemplate.body === null ? requestWithoutSensitiveHeaders(requestTemplate) : requestWithoutSensitiveState(requestTemplate)), sensitiveHeaderNames),
	fetchOptions: Object.hasOwn(fetchOptions, 'body') && fetchOptions.body !== undefined ? normalizeBodylessFetchOptions(markSensitiveHeadersAsFinal(fetchOptions)) : markSensitiveHeadersAsFinal(fetchOptions),
});

const markSensitiveHeadersAsFinal = fetchOptions => {
	if (!('headers' in fetchOptions)) {
		return markToBlockDefaultHeaders({...fetchOptions}, sensitiveHeaderNames);
	}

	return markToBlockDefaultHeaders({
		...fetchOptions,
		headers: markToBlockDefaultHeaders(stripSensitiveHeaders(fetchOptions.headers), sensitiveHeaderNames),
	}, sensitiveHeaderNames);
};

const hasSensitiveHeaders = headers => {
	const normalizedHeaders = new Headers(headers);

	for (const headerName of sensitiveHeaderNames) {
		if (normalizedHeaders.has(headerName)) {
			return true;
		}
	}

	return false;
};

const hasExplicitSensitiveState = fetchOptions => ('body' in fetchOptions && fetchOptions.body !== undefined) || ('headers' in fetchOptions && hasSensitiveHeaders(fetchOptions.headers));
const shouldClearInheritedBody = (fetchOptions, nextPageOptions) => !methodCanHaveBody(fetchOptions.method) && !Object.hasOwn(nextPageOptions, 'body') && Object.hasOwn(fetchOptions, 'body');

/**
Paginate through API responses using async iteration.

By default, it automatically follows RFC 5988 Link headers with rel="next".

@param {RequestInfo | URL} input - The URL to fetch.
@param {RequestInit & {pagination?: PaginationOptions, fetchFunction?: Function}} options - Fetch options plus pagination options.
@yields {*} Items from each page.
@returns {AsyncIterableIterator} An async iterator that yields items from each page.

@example
```
import {paginate} from 'fetch-extras';

// Basic usage with Link headers
for await (const item of paginate('https://api.example.com/items')) {
	console.log(item);
}
```
*/
// eslint-disable-next-line complexity
export async function * paginate(input, options = {}) {
	const {pagination = {}, fetchFunction = fetch, ...fetchOptions} = options;
	const paginationOptions = {...defaultPaginationOptions, ...pagination};

	if (typeof paginationOptions.transform !== 'function') {
		throw new TypeError('pagination.transform must be a function');
	}

	if (typeof paginationOptions.paginate !== 'function') {
		throw new TypeError('pagination.paginate must be a function');
	}

	if (typeof paginationOptions.filter !== 'function') {
		throw new TypeError('pagination.filter must be a function');
	}

	if (typeof paginationOptions.shouldContinue !== 'function') {
		throw new TypeError('pagination.shouldContinue must be a function');
	}

	if (typeof paginationOptions.countLimit !== 'number') {
		throw new TypeError('pagination.countLimit must be a number');
	}

	if (Number.isNaN(paginationOptions.countLimit)) {
		throw new TypeError('pagination.countLimit must not be NaN');
	}

	if (paginationOptions.countLimit < 0) {
		throw new TypeError('pagination.countLimit must be non-negative');
	}

	if (!integerOrInfinity(paginationOptions.countLimit)) {
		throw new TypeError('pagination.countLimit must be an integer');
	}

	if (typeof paginationOptions.requestLimit !== 'number') {
		throw new TypeError('pagination.requestLimit must be a number');
	}

	if (Number.isNaN(paginationOptions.requestLimit)) {
		throw new TypeError('pagination.requestLimit must not be NaN');
	}

	if (paginationOptions.requestLimit < 0) {
		throw new TypeError('pagination.requestLimit must be non-negative');
	}

	if (!integerOrInfinity(paginationOptions.requestLimit)) {
		throw new TypeError('pagination.requestLimit must be an integer');
	}

	if (typeof paginationOptions.backoff !== 'number') {
		throw new TypeError('pagination.backoff must be a number');
	}

	if (Number.isNaN(paginationOptions.backoff)) {
		throw new TypeError('pagination.backoff must not be NaN');
	}

	if (!Number.isFinite(paginationOptions.backoff)) {
		throw new TypeError('pagination.backoff must be finite');
	}

	if (paginationOptions.backoff < 0) {
		throw new TypeError('pagination.backoff must be non-negative');
	}

	if (typeof paginationOptions.stackAllItems !== 'boolean') {
		throw new TypeError('pagination.stackAllItems must be a boolean');
	}

	const allItems = [];
	let {countLimit} = paginationOptions;
	let numberOfRequests = 0;
	const absoluteInputUrl = input instanceof Request ? undefined : absoluteUrl(input);
	let requestTemplate = input instanceof Request || ('body' in fetchOptions && absoluteInputUrl) ? createRequestTemplate(input instanceof Request ? input : absoluteInputUrl, fetchOptions) : undefined;
	let currentUrl = requestTemplate ? new URL(requestTemplate.url) : input;
	let currentFetchOptions = requestTemplate ? createTemplateFetchOptions(fetchOptions) : normalizeFetchOptions(fetchOptions);
	let inheritedStateOrigin = absoluteUrl(requestTemplate ? requestTemplate.url : input);

	while (numberOfRequests < paginationOptions.requestLimit && countLimit > 0) {
		if (numberOfRequests !== 0 && paginationOptions.backoff > 0) {
			// eslint-disable-next-line no-await-in-loop
			await delay(paginationOptions.backoff, {signal: currentSignal(requestTemplate, currentFetchOptions)});
		}

		let currentInput = currentUrl;

		if (requestTemplate) {
			currentInput = new Request(currentUrl, requestTemplate.clone());

			if (requestTemplate[blockedDefaultHeaderNamesSymbol]) {
				markToBlockDefaultHeaders(currentInput, requestTemplate[blockedDefaultHeaderNamesSymbol]);
			}
		}

		// eslint-disable-next-line no-await-in-loop
		const response = await fetchFunction(currentInput, currentFetchOptions);
		const currentResponseUrl = responseUrl(response, currentUrl);

		currentUrl = currentResponseUrl;

		if (shouldStripInheritedSensitiveState(inheritedStateOrigin, currentResponseUrl)) {
			const strippedState = stripInheritedSensitiveState(requestTemplate, currentFetchOptions);
			requestTemplate = strippedState.requestTemplate;
			currentFetchOptions = strippedState.fetchOptions;
			inheritedStateOrigin = undefined;
		}

		// eslint-disable-next-line no-await-in-loop
		const parsed = await paginationOptions.transform(response);

		if (!Array.isArray(parsed)) {
			throw new TypeError('pagination.transform must return an array');
		}

		const currentItems = [];

		for (const item of parsed) {
			if (paginationOptions.filter({item, currentItems, allItems})) {
				yield item;

				if (paginationOptions.stackAllItems) {
					allItems.push(item);
				}

				currentItems.push(item);
				countLimit--;

				if (!paginationOptions.shouldContinue({item, currentItems, allItems})) {
					return;
				}

				if (countLimit === 0) {
					return;
				}
			}
		}

		// eslint-disable-next-line no-await-in-loop
		const nextPageOptions = await paginationOptions.paginate({
			response,
			currentUrl,
			currentItems,
			allItems,
		});

		if (nextPageOptions === false) {
			return;
		}

		if (!isPaginationFetchOptions(nextPageOptions)) {
			throw new TypeError('pagination.paginate must return an object or false');
		}

		if ('url' in nextPageOptions) {
			if (!(nextPageOptions.url instanceof URL)) {
				throw new TypeError('pagination.paginate must return an object with url as a URL instance');
			}

			currentUrl = nextPageOptions.url;
		}

		const nextRequestUrl = absoluteUrl(nextPageOptions.url ?? currentUrl);

		if (shouldStripInheritedSensitiveState(inheritedStateOrigin, nextRequestUrl)) {
			const strippedState = stripInheritedSensitiveState(requestTemplate, currentFetchOptions);
			requestTemplate = strippedState.requestTemplate;
			currentFetchOptions = strippedState.fetchOptions;
			inheritedStateOrigin = undefined;
		}

		const nextPageKeys = Object.keys(nextPageOptions);
		if (nextPageKeys.length > 1 || (nextPageKeys.length === 1 && !nextPageOptions.url)) {
			const {url: _, ...restNextPageOptions} = nextPageOptions;
			const nextFetchOptions = {...currentFetchOptions, ...restNextPageOptions};

			if (requestTemplate) {
				requestTemplate = createRequestTemplate(requestTemplate, nextFetchOptions);
				currentFetchOptions = createTemplateFetchOptions(nextFetchOptions);
			} else {
				currentFetchOptions = normalizeFetchOptions(shouldClearInheritedBody(nextFetchOptions, restNextPageOptions) ? {...nextFetchOptions, body: undefined} : nextFetchOptions);
			}

			if (hasExplicitSensitiveState(restNextPageOptions)) {
				inheritedStateOrigin = nextRequestUrl ?? inheritedStateOrigin;
			}
		}

		numberOfRequests++;
	}
}

paginate.all = async (input, options) => {
	const items = [];
	for await (const item of paginate(input, options)) {
		items.push(item);
	}

	return items;
};
