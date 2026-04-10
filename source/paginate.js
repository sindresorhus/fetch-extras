import parseLinkHeader from './parse-link-header.js';
import {
	blockedDefaultHeaderNamesSymbol,
	delay,
	markResolvedRequestHeaders,
	requestBodyHeaderNames,
	requestSnapshot,
	resolveRequestBodyOptions,
	resolveRequestHeaders,
	resolveRequestHeadersSymbol,
} from './utilities.js';

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

const stripBodyHeaders = headers => {
	const cleanedHeaders = new Headers(headers);
	cleanedHeaders.delete('content-length');

	for (const headerName of requestBodyHeaderNames) {
		cleanedHeaders.delete(headerName);
	}

	return cleanedHeaders;
};

const markToBlockDefaultHeaders = (object, headerNames) => {
	object[blockedDefaultHeaderNamesSymbol] = [...headerNames];
	return object;
};

const methodCanHaveBody = method => method === undefined || !['get', 'head'].includes(method.toLowerCase());

const requestWithoutBody = request => ({
	...requestSnapshot(request),
	headers: stripBodyHeaders(request.headers),
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
const hasExplicitBody = fetchOptions => Object.hasOwn(fetchOptions, 'body') && fetchOptions.body !== undefined;
const integerOrInfinity = value => value === Number.POSITIVE_INFINITY || Number.isInteger(value);
const isPaginationFetchOptions = value => typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof URL);
const isCrossOrigin = (currentUrl, nextUrl) => currentUrl.origin !== nextUrl.origin;
const shouldStripInheritedHeaderState = (inheritedStateOrigin, requestUrl) => inheritedStateOrigin && requestUrl instanceof URL && isCrossOrigin(inheritedStateOrigin, requestUrl);

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
			if ('headers' in fetchOptions) {
				return new Request(input.url, {
					...requestSnapshot(input),
					...fetchOptions,
					headers: new Headers(fetchOptions.headers),
				});
			}

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

const cloneRequest = (url, request, headers = request.headers) => new Request(url, {
	...requestSnapshot(request),
	headers: new Headers(headers),
	body: request.body ?? undefined,
});

const createResolvedRequestTemplate = async (fetchFunction, input, fetchOptions) => {
	const bodyResolvedFetchOptions = resolveRequestBodyOptions(fetchFunction, input, fetchOptions);

	// The template bakes in the resolved body; callers strip body/headers via createTemplateFetchOptions, so original fetchOptions is correct here.
	return [
		createRequestTemplate(input, bodyResolvedFetchOptions),
		fetchOptions,
	];
};

const createCurrentInput = async (fetchFunction, currentUrl, requestTemplate, fetchOptions) => {
	const clonedTemplate = requestTemplate.clone();
	const currentInput = cloneRequest(currentUrl, clonedTemplate);
	const blockedDefaultHeaderNames = requestTemplate[blockedDefaultHeaderNamesSymbol];

	if (blockedDefaultHeaderNames) {
		markToBlockDefaultHeaders(currentInput, blockedDefaultHeaderNames);
	}

	if (fetchFunction[resolveRequestHeadersSymbol] === undefined) {
		return currentInput;
	}

	/*
	Boundary: later pages are new requests, not retries, so dynamic defaults from withHeaders() must be re-resolved here instead of being baked into the stored template.
	The template only preserves replayable request state like the body and non-header RequestInit fields across pages.
	*/
	const resolvedHeaders = await resolveRequestHeaders(fetchFunction, currentInput, {
		...fetchOptions,
		signal: currentSignal(requestTemplate, fetchOptions),
	});
	const resolvedInput = cloneRequest(currentUrl, currentInput, resolvedHeaders);

	if (blockedDefaultHeaderNames) {
		markToBlockDefaultHeaders(resolvedInput, blockedDefaultHeaderNames);
	}

	return markResolvedRequestHeaders(resolvedInput);
};

const shouldUseRequestTemplateOnFirstRequest = (input, fetchOptions) => input instanceof Request || (absoluteUrl(input) && fetchOptions.body instanceof ReadableStream);

const currentSignal = (requestTemplate, fetchOptions) => fetchOptions.signal ?? requestTemplate?.signal;

const getHeaderNames = headers => [...new Headers(headers).keys()];

/*
Boundary: following a Link header is not an HTTP redirect. We are constructing a new request for a new URL, often in environments like Node where callers can set arbitrary credential headers. So when pagination crosses origins, only the carried request header state is cleared. Then inner wrappers such as withHeaders() run again for the next page.
*/
const clearCrossOriginHeaderState = (requestTemplate, fetchOptions) => {
	const nextFetchOptions = 'headers' in fetchOptions
		? {
			...fetchOptions,
			headers: new Headers(),
		}
		: {...fetchOptions};

	return {
		requestTemplate: requestTemplate && new Request(requestTemplate.url, {
			...requestSnapshot(requestTemplate),
			headers: new Headers(),
		}),
		currentFetchOptions: hasExplicitBody(fetchOptions) ? normalizeBodylessFetchOptions(nextFetchOptions) : nextFetchOptions,
		inheritedStateOrigin: undefined,
	};
};

const hasExplicitHeaderState = fetchOptions => hasExplicitBody(fetchOptions) || ('headers' in fetchOptions && getHeaderNames(fetchOptions.headers).length > 0);
const shouldClearInheritedBody = (fetchOptions, nextPageOptions) => !methodCanHaveBody(fetchOptions.method) && !Object.hasOwn(nextPageOptions, 'body') && Object.hasOwn(fetchOptions, 'body');

/**
Paginate through API responses using async iteration.

By default, it automatically follows RFC 5988 Link headers with rel="next".

Note: When pagination crosses to a different origin, inherited request headers are cleared before the next request is built. If you intentionally need headers on the new origin, return them explicitly from `pagination.paginate`.

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

	if (!methodCanHaveBody(fetchOptions.method) && Object.hasOwn(fetchOptions, 'body') && fetchOptions.body !== undefined) {
		throw new TypeError('Request with GET/HEAD method cannot have body.');
	}

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
	const shouldUseRequestTemplate = shouldUseRequestTemplateOnFirstRequest(input, fetchOptions);
	let requestTemplate;
	let currentFetchOptions;

	if (shouldUseRequestTemplate) {
		[requestTemplate, currentFetchOptions] = await createResolvedRequestTemplate(fetchFunction, input, fetchOptions);
	} else {
		currentFetchOptions = normalizeFetchOptions(fetchOptions);
	}

	let currentUrl = requestTemplate ? new URL(requestTemplate.url) : input;
	let inheritedStateOrigin = absoluteUrl(requestTemplate ? requestTemplate.url : input);

	while (numberOfRequests < paginationOptions.requestLimit && countLimit > 0) {
		if (numberOfRequests !== 0 && paginationOptions.backoff > 0) {
			// eslint-disable-next-line no-await-in-loop
			await delay(paginationOptions.backoff, {signal: currentSignal(requestTemplate, currentFetchOptions)});
		}

		let currentInput = currentUrl;

		if (requestTemplate) {
			// eslint-disable-next-line no-await-in-loop
			currentInput = await createCurrentInput(fetchFunction, currentUrl, requestTemplate, currentFetchOptions);
		}

		// eslint-disable-next-line no-await-in-loop
		const response = await fetchFunction(
			currentInput,
			requestTemplate ? createTemplateFetchOptions(currentFetchOptions) : currentFetchOptions,
		);
		const currentResponseUrl = responseUrl(response, currentUrl);
		const shouldClearLaterStreamBody = !requestTemplate && currentFetchOptions.body instanceof ReadableStream;

		if (shouldClearLaterStreamBody) {
			currentFetchOptions = normalizeFetchOptions({
				...currentFetchOptions,
				body: undefined,
			});
		}

		currentUrl = currentResponseUrl;

		if (shouldStripInheritedHeaderState(inheritedStateOrigin, currentResponseUrl)) {
			({requestTemplate, currentFetchOptions, inheritedStateOrigin} = clearCrossOriginHeaderState(
				requestTemplate,
				currentFetchOptions,
			));
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

		if (shouldStripInheritedHeaderState(inheritedStateOrigin, nextRequestUrl)) {
			({requestTemplate, currentFetchOptions, inheritedStateOrigin} = clearCrossOriginHeaderState(
				requestTemplate,
				currentFetchOptions,
			));
		}

		const nextPageKeys = Object.keys(nextPageOptions);
		if (nextPageKeys.length > 1 || (nextPageKeys.length === 1 && !nextPageOptions.url)) {
			const {url: _, ...restNextPageOptions} = nextPageOptions;
			const nextFetchOptions = {
				...(!requestTemplate && currentFetchOptions.body instanceof ReadableStream
					? {
						...currentFetchOptions,
						body: undefined,
					}
					: currentFetchOptions),
				...restNextPageOptions,
			};

			if (requestTemplate) {
				requestTemplate = createRequestTemplate(requestTemplate, nextFetchOptions);
				currentFetchOptions = nextFetchOptions;
			} else {
				currentFetchOptions = normalizeFetchOptions(shouldClearInheritedBody(nextFetchOptions, restNextPageOptions) ? {...nextFetchOptions, body: undefined} : nextFetchOptions);
			}

			if (hasExplicitHeaderState(restNextPageOptions)) {
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
