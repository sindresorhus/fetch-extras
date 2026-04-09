import test from 'ava';
import {
	paginate,
	withHeaders,
	withJsonBody,
	withRetry,
} from 'fetch-extras';
import parseLinkHeader from '../source/parse-link-header.js';

// Pagination tests - run serially since they modify globalThis.fetch
const createPaginatedMockFetch = pages => async url => {
	const urlObject = typeof url === 'string' ? new URL(url) : url;
	const pageParameter = urlObject.searchParams.get('page');
	const page = pageParameter ? Number.parseInt(pageParameter, 10) : 1;

	const data = pages[page - 1];
	if (!data) {
		return {
			ok: true,
			status: 200,
			url: urlObject.toString(),
			headers: {
				get() {
					return undefined;
				},
			},
			bodyUsed: false,
			async json() {
				if (this.bodyUsed) {
					throw new TypeError('Body has already been consumed');
				}

				this.bodyUsed = true;
				return [];
			},
		};
	}

	const linkHeader = page < pages.length
		? `<http://example.com/?page=${page + 1}>; rel="next"`
		: undefined;

	return {
		ok: true,
		status: 200,
		url: urlObject.toString(),
		headers: {
			get(name) {
				if (name === 'Link') {
					return linkHeader;
				}

				return undefined;
			},
		},
		bodyUsed: false,
		async json() {
			if (this.bodyUsed) {
				throw new TypeError('Body has already been consumed');
			}

			this.bodyUsed = true;
			return data;
		},
	};
};

const createRecordedRequestFetch = ({nextLink, includeBody = false, recordHeaders = []} = {}) => {
	const seenRequests = [];
	const fetchFunction = async (input, options) => {
		const request = input instanceof Request ? input : new Request(input, options);
		const page = seenRequests.length + 1;
		seenRequests.push(await createRequestRecord(request, {includeBody, recordHeaders}));

		return {
			ok: true,
			status: 200,
			url: request.url,
			headers: {
				get(name) {
					if (name === 'Link' && page === 1) {
						return nextLink;
					}

					return undefined;
				},
			},
			json: async () => [page],
		};
	};

	return {seenRequests, fetchFunction};
};

const createRequestRecord = async (request, {includeBody = false, recordHeaders = []} = {}) => {
	const requestRecord = {
		url: request.url,
		authorization: request.headers.get('authorization'),
		...(includeBody ? {body: request.body ? await request.text() : undefined} : {}),
	};

	for (const recordHeader of recordHeaders) {
		const [key, headerName] = Array.isArray(recordHeader) ? recordHeader : [recordHeader, recordHeader];
		requestRecord[key] = request.headers.get(headerName);
	}

	return requestRecord;
};

const createRedirectedRecordedRequestFetch = ({redirectUrl = 'https://cdn.example.net/?page=1', nextLink, includeBody = false, recordHeaders = []} = {}) => {
	const seenRequests = [];
	let page = 0;

	return {
		seenRequests,
		async fetchFunction(input, options) {
			const request = input instanceof Request ? input : new Request(input, options);
			page++;
			seenRequests.push(await createRequestRecord(request, {includeBody, recordHeaders}));

			return {
				ok: true,
				status: 200,
				url: page === 1 ? redirectUrl : request.url,
				headers: {
					get(name) {
						if (name === 'Link' && page === 1) {
							return nextLink;
						}

						return undefined;
					},
				},
				json: async () => [page],
			};
		},
	};
};

const redirectedCredentialHeaders = {
	authorization: 'Bearer secret',
	cookie: 'session=abc123',
	'proxy-authorization': 'Basic c2VjcmV0',
};

const redirectedCredentialRecordHeaders = [['cookie', 'cookie'], ['proxyAuthorization', 'proxy-authorization']];
const redirectedNextPageLink = '<https://cdn.example.net/?page=2>; rel="next"';

const paginateWithRedirectedCredentialHeaders = async nextLink => {
	const {seenRequests, fetchFunction} = createRedirectedRecordedRequestFetch({
		nextLink,
		recordHeaders: redirectedCredentialRecordHeaders,
	});

	const items = await paginate.all('https://api.example.com/?page=1', {
		headers: redirectedCredentialHeaders,
		fetchFunction,
	});

	return {items, seenRequests};
};

const createRedirectedPaginationOptions = nextPageOptions => ({
	requestLimit: 2,
	paginate({currentUrl}) {
		if (currentUrl.href === 'https://cdn.example.net/?page=1') {
			return nextPageOptions;
		}

		return false;
	},
});

const createEmptyResponseUrlRecordedRequestFetch = ({recordHeaders = []} = {}) => {
	const seenRequests = [];

	return {
		seenRequests,
		async fetchFunction(input, options) {
			const request = input instanceof Request ? input : new Request(input, options);
			const requestRecord = {
				url: request.url,
				authorization: request.headers.get('authorization'),
			};

			for (const [key, headerName] of recordHeaders) {
				requestRecord[key] = request.headers.get(headerName);
			}

			seenRequests.push(requestRecord);

			return Response.json([seenRequests.length], {
				headers: {
					'content-type': 'application/json',
				},
			});
		},
	};
};

const createRelativeInputRecordedFetch = () => {
	const seenCalls = [];

	return {
		seenCalls,
		async fetchFunction(input, options) {
			seenCalls.push({
				input,
				method: options?.method,
				body: options?.body,
				contentType: options?.headers ? new Headers(options.headers).get('content-type') : undefined,
			});

			return {
				ok: true,
				status: 200,
				url: '',
				headers: {
					get() {
						return undefined;
					},
				},
				json: async () => [seenCalls.length],
			};
		},
	};
};

const createRelativeAuthorizationRecordedFetch = ({firstResponseUrl = '', firstLink, recordHeaders = []} = {}) => {
	const seenRequests = [];
	let callCount = 0;

	return {
		seenRequests,
		async fetchFunction(input, options) {
			callCount++;
			const requestRecord = {
				url: typeof input === 'string' ? 'https://example.com/api?page=1' : input.toString(),
				authorization: new Headers(options.headers).get('authorization'),
			};

			for (const [key, headerName] of recordHeaders) {
				requestRecord[key] = new Headers(options.headers).get(headerName);
			}

			seenRequests.push(requestRecord);

			if (callCount === 1) {
				return {
					ok: true,
					status: 200,
					url: firstResponseUrl,
					headers: {
						get(name) {
							if (name === 'Link') {
								return firstLink;
							}

							return undefined;
						},
					},
					json: async () => [1],
				};
			}

			return {
				ok: true,
				status: 200,
				url: input.toString(),
				headers: {
					get() {
						return undefined;
					},
				},
				json: async () => [2],
			};
		},
	};
};

const createAbsoluteStringCurrentUrlPaginator = nextUrl => ({
	requestLimit: 2,
	paginate({currentUrl}) {
		if (typeof currentUrl === 'string') {
			return {url: new URL(nextUrl)};
		}

		return false;
	},
});

const createRelativeCurrentUrlPaginator = nextPageOptions => ({
	requestLimit: 2,
	paginate({currentUrl}) {
		if (currentUrl === '/api?page=1') {
			return nextPageOptions;
		}

		return false;
	},
});

const setMockLocation = (t, href = 'https://example.com/') => {
	const previousLocation = globalThis.location;
	Object.defineProperty(globalThis, 'location', {
		value: new URL(href),
		configurable: true,
		writable: true,
	});
	t.teardown(() => {
		if (previousLocation === undefined) {
			delete globalThis.location;
			return;
		}

		Object.defineProperty(globalThis, 'location', {
			value: previousLocation,
			configurable: true,
			writable: true,
		});
	});
};

const crossOriginNextUrl = 'https://evil.example/?page=2';

const paginateToCrossOriginWithAuthorization = ({response}) => {
	if (new URL(response.url).hostname === 'api.example.com') {
		return {
			url: new URL(crossOriginNextUrl),
			headers: {
				authorization: 'Bearer replacement',
			},
		};
	}

	return false;
};

test.serial('paginate - retrieves all items with Link header', async t => {
	globalThis.fetch = createPaginatedMockFetch([[1, 2], [3, 4], [5]]);

	const items = await paginate.all('http://example.com/?page=1');
	t.deepEqual(items, [1, 2, 3, 4, 5]);
});

test.serial('paginate - async iterator works', async t => {
	globalThis.fetch = createPaginatedMockFetch([[1, 2], [3]]);

	const items = [];
	for await (const item of paginate('http://example.com/?page=1')) {
		items.push(item);
	}

	t.deepEqual(items, [1, 2, 3]);
});

test.serial('paginate - stops when no Link header', async t => {
	globalThis.fetch = async url => ({
		ok: true,
		status: 200,
		url: url.toString(),
		headers: {
			get() {
				return undefined;
			},
		},
		json: async () => [1, 2, 3],
	});

	const items = await paginate.all('http://example.com/');
	t.deepEqual(items, [1, 2, 3]);
});

test.serial('paginate - stops when Link header is empty', async t => {
	globalThis.fetch = async url => ({
		ok: true,
		status: 200,
		url: url.toString(),
		headers: {
			get(name) {
				if (name === 'Link') {
					return '';
				}

				return undefined;
			},
		},
		json: async () => [1, 2],
	});

	const items = await paginate.all('http://example.com/');
	t.deepEqual(items, [1, 2]);
});

test.serial('paginate - preserves Request configuration across pages', async t => {
	const seenRequests = [];
	const mockFetch = async (input, options) => {
		const request = input instanceof Request ? input : new Request(input, options);
		const pageParameter = new URL(request.url).searchParams.get('page');
		const page = pageParameter ? Number.parseInt(pageParameter, 10) : 1;
		const body = request.body ? await request.text() : undefined;

		seenRequests.push({
			url: request.url,
			method: request.method,
			authorization: request.headers.get('authorization'),
			body,
		});

		return {
			ok: true,
			status: 200,
			url: request.url,
			headers: {
				get(name) {
					if (name === 'Link' && page === 1) {
						return '<http://example.com/?page=2>; rel="next"';
					}

					return undefined;
				},
			},
			json: async () => [page],
		};
	};

	const items = await paginate.all(new Request('http://example.com/?page=1', {
		method: 'POST',
		headers: {
			authorization: 'Bearer secret',
		},
		body: 'page request body',
	}), {fetchFunction: mockFetch});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'http://example.com/?page=1',
			method: 'POST',
			authorization: 'Bearer secret',
			body: 'page request body',
		},
		{
			url: 'http://example.com/?page=2',
			method: 'POST',
			authorization: 'Bearer secret',
			body: 'page request body',
		},
	]);
});

test.serial('paginate - URL input preserves init.body for withJsonBody on the first request', async t => {
	const seenRequests = [];
	const mockFetch = async (input, options) => {
		const request = input instanceof Request ? input : new Request(input, options);
		seenRequests.push({
			url: request.url,
			body: await request.text(),
			contentType: request.headers.get('content-type'),
		});

		return {
			ok: true,
			status: 200,
			url: request.url,
			headers: {
				get() {
					return undefined;
				},
			},
			json: async () => [1],
		};
	};

	await paginate.all('https://example.com/api', {
		method: 'POST',
		body: {foo: 1},
		fetchFunction: withJsonBody(mockFetch),
	});

	t.deepEqual(seenRequests, [{
		url: 'https://example.com/api',
		body: '{"foo":1}',
		contentType: 'application/json',
	}]);
});

test.serial('paginate - URL input preserves replayable init.body for withRetry on the first request', async t => {
	let callCount = 0;
	const seenBodies = [];
	const fetchFunction = withRetry(async (input, options) => {
		const request = input instanceof Request ? input : new Request(input, options);
		callCount++;
		seenBodies.push(await request.text());

		return Response.json([1], {
			status: callCount === 1 ? 503 : 200,
			headers: {'content-type': 'application/json'},
		});
	}, {
		retries: 1,
		backoff: () => 0,
	});

	const items = await paginate.all('https://example.com/api', {
		method: 'PUT',
		body: '{"foo":1}',
		headers: {'content-type': 'application/json'},
		fetchFunction,
	});

	t.deepEqual(items, [1]);
	t.is(callCount, 2);
	t.deepEqual(seenBodies, ['{"foo":1}', '{"foo":1}']);
});

test.serial('paginate - drops inherited sensitive state when the next page changes origin', async t => {
	const {seenRequests, fetchFunction} = createRecordedRequestFetch({
		nextLink: `<${crossOriginNextUrl}>; rel="next"`,
		includeBody: true,
		recordHeaders: ['cookie', 'proxy-authorization'],
	});

	const items = await paginate.all(new Request('https://api.example.com/?page=1', {
		method: 'POST',
		headers: {
			...redirectedCredentialHeaders,
		},
		body: 'page request body',
	}), {fetchFunction});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/?page=1',
			authorization: 'Bearer secret',
			cookie: 'session=abc123',
			'proxy-authorization': 'Basic c2VjcmV0',
			body: 'page request body',
		},
		{
			url: 'https://evil.example/?page=2',
			authorization: null,
			cookie: null,
			'proxy-authorization': null,
			body: undefined,
		},
	]);
});

test.serial('paginate - drops Authorization for URL input when the next page changes origin', async t => {
	const {seenRequests, fetchFunction} = createRecordedRequestFetch({
		nextLink: `<${crossOriginNextUrl}>; rel="next"`,
	});

	const items = await paginate.all('https://api.example.com/?page=1', {
		headers: {
			authorization: 'Bearer secret',
		},
		fetchFunction,
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/?page=1',
			authorization: 'Bearer secret',
		},
		{
			url: 'https://evil.example/?page=2',
			authorization: null,
		},
	]);
});

test.serial('paginate - drops inherited headers when the next page changes origin', async t => {
	const {seenRequests, fetchFunction} = createRecordedRequestFetch({
		nextLink: `<${crossOriginNextUrl}>; rel="next"`,
		recordHeaders: ['x-api-key', 'private-token'],
	});

	const items = await paginate.all('https://api.example.com/?page=1', {
		headers: {
			'x-api-key': 'secret-key',
			'private-token': 'secret-token',
		},
		fetchFunction,
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/?page=1',
			authorization: null,
			'x-api-key': 'secret-key',
			'private-token': 'secret-token',
		},
		{
			url: 'https://evil.example/?page=2',
			authorization: null,
			'x-api-key': null,
			'private-token': null,
		},
	]);
});

test.serial('paginate - drops Authorization case-insensitively when the next page changes origin', async t => {
	const {seenRequests, fetchFunction} = createRecordedRequestFetch({
		nextLink: `<${crossOriginNextUrl}>; rel="next"`,
		recordHeaders: ['x-api-key'],
	});

	const items = await paginate.all('https://api.example.com/?page=1', {
		headers: {
			Authorization: 'Bearer secret',
			'x-api-key': 'secret-key',
		},
		fetchFunction,
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/?page=1',
			authorization: 'Bearer secret',
			'x-api-key': 'secret-key',
		},
		{
			url: 'https://evil.example/?page=2',
			authorization: null,
			'x-api-key': null,
		},
	]);
});

test.serial('paginate - preserves explicit Authorization overrides on cross-origin next pages', async t => {
	const {seenRequests, fetchFunction} = createRecordedRequestFetch();

	const items = await paginate.all(new Request('https://api.example.com/?page=1', {
		headers: {
			authorization: 'Bearer secret',
		},
	}), {
		fetchFunction,
		pagination: {
			paginate: paginateToCrossOriginWithAuthorization,
		},
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/?page=1',
			authorization: 'Bearer secret',
		},
		{
			url: 'https://evil.example/?page=2',
			authorization: 'Bearer replacement',
		},
	]);
});

test.serial('paginate - preserves explicit Authorization overrides on cross-origin next pages for URL input', async t => {
	const {seenRequests, fetchFunction} = createRecordedRequestFetch();

	const items = await paginate.all('https://api.example.com/?page=1', {
		headers: {
			authorization: 'Bearer secret',
		},
		fetchFunction,
		pagination: {
			paginate: paginateToCrossOriginWithAuthorization,
		},
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/?page=1',
			authorization: 'Bearer secret',
		},
		{
			url: 'https://evil.example/?page=2',
			authorization: 'Bearer replacement',
		},
	]);
});

test.serial('paginate - preserves inherited headers on same-origin next pages', async t => {
	const {seenRequests, fetchFunction} = createRecordedRequestFetch({
		nextLink: '<https://api.example.com/?page=2>; rel="next"',
		recordHeaders: ['x-api-key', 'accept'],
	});

	const items = await paginate.all('https://api.example.com/?page=1', {
		headers: {
			'x-api-key': 'secret-key',
			accept: 'application/json',
		},
		fetchFunction,
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/?page=1',
			authorization: null,
			'x-api-key': 'secret-key',
			accept: 'application/json',
		},
		{
			url: 'https://api.example.com/?page=2',
			authorization: null,
			'x-api-key': 'secret-key',
			accept: 'application/json',
		},
	]);
});

test.serial('paginate - preserves explicit next-page headers while dropping inherited cross-origin headers', async t => {
	const {seenRequests, fetchFunction} = createRecordedRequestFetch({
		recordHeaders: ['x-api-key', 'accept'],
	});

	const items = await paginate.all('https://api.example.com/?page=1', {
		headers: {
			'x-api-key': 'secret-key',
			accept: 'application/json',
		},
		fetchFunction,
		pagination: {
			paginate({response}) {
				if (response.url !== 'https://api.example.com/?page=1') {
					return false;
				}

				return {
					url: new URL(crossOriginNextUrl),
					headers: {
						'x-api-key': 'replacement-key',
					},
				};
			},
		},
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/?page=1',
			authorization: null,
			'x-api-key': 'secret-key',
			accept: 'application/json',
		},
		{
			url: 'https://evil.example/?page=2',
			authorization: null,
			'x-api-key': 'replacement-key',
			accept: null,
		},
	]);
});

test.serial('paginate - does not reapply withHeaders Authorization defaults after cross-origin pagination strips them', async t => {
	const {seenRequests, fetchFunction} = createRecordedRequestFetch({
		nextLink: `<${crossOriginNextUrl}>; rel="next"`,
	});
	const fetchWithHeaders = withHeaders(fetchFunction, {
		authorization: 'Bearer secret',
	});

	const items = await paginate.all('https://api.example.com/?page=1', {
		fetchFunction: fetchWithHeaders,
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/?page=1',
			authorization: 'Bearer secret',
		},
		{
			url: 'https://evil.example/?page=2',
			authorization: null,
		},
	]);
});

test.serial('paginate - drops inherited withHeaders defaults after a cross-origin redirect', async t => {
	const seenRequests = [];
	const fetchWithHeaders = withHeaders(async (input, options) => {
		const request = input instanceof Request ? input : new Request(input, options);
		const page = seenRequests.length + 1;

		seenRequests.push({
			url: request.url,
			authorization: request.headers.get('authorization'),
			accept: request.headers.get('accept'),
			xApiVersion: request.headers.get('x-api-version'),
		});

		return {
			ok: true,
			status: 200,
			url: page === 1 ? 'https://cdn.example.net/?page=1' : request.url,
			headers: {
				get(name) {
					if (name === 'Link' && page === 1) {
						return redirectedNextPageLink;
					}

					return undefined;
				},
			},
			json: async () => [page],
		};
	}, {
		authorization: 'Bearer secret',
		accept: 'application/json',
		'x-api-version': '2026-03',
	});

	const items = await paginate.all('https://api.example.com/?page=1', {
		fetchFunction: fetchWithHeaders,
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/?page=1',
			authorization: 'Bearer secret',
			accept: 'application/json',
			xApiVersion: '2026-03',
		},
		{
			url: 'https://cdn.example.net/?page=2',
			authorization: null,
			accept: null,
			xApiVersion: null,
		},
	]);
});

test.serial('paginate - stops before fetching an extra page when countLimit is reached', async t => {
	let requestCount = 0;
	const mockFetch = async url => {
		requestCount++;
		const pageParameter = new URL(url).searchParams.get('page');
		const page = pageParameter ? Number.parseInt(pageParameter, 10) : 1;

		return {
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get(name) {
					if (name === 'Link' && page === 1) {
						return '<http://example.com/?page=2>; rel="next"';
					}

					return undefined;
				},
			},
			json: async () => page === 1 ? [1, 2] : [3, 4],
		};
	};

	const items = await paginate.all('http://example.com/?page=1', {
		fetchFunction: mockFetch,
		pagination: {
			countLimit: 2,
		},
	});

	t.deepEqual(items, [1, 2]);
	t.is(requestCount, 1);
});

test.serial('paginate - does not fetch when countLimit is 0', async t => {
	let requestCount = 0;
	const mockFetch = async () => {
		requestCount++;

		return {
			ok: true,
			status: 200,
			url: 'http://example.com/?page=1',
			headers: {
				get() {
					return undefined;
				},
			},
			json: async () => [1, 2],
		};
	};

	const items = await paginate.all('http://example.com/?page=1', {
		fetchFunction: mockFetch,
		pagination: {
			countLimit: 0,
		},
	});

	t.deepEqual(items, []);
	t.is(requestCount, 0);
});

test.serial('paginate - does not call callbacks after countLimit is exhausted', async t => {
	const filterCalls = [];
	const shouldContinueCalls = [];

	const items = await paginate.all('http://example.com/?page=1', {
		fetchFunction: async url => ({
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get() {
					return undefined;
				},
			},
			json: async () => [1, 2],
		}),
		pagination: {
			countLimit: 1,
			filter({item}) {
				filterCalls.push(item);
				return true;
			},
			shouldContinue({item}) {
				shouldContinueCalls.push(item);
				return true;
			},
		},
	});

	t.deepEqual(items, [1]);
	t.deepEqual(filterCalls, [1]);
	t.deepEqual(shouldContinueCalls, [1]);
});

test.serial('paginate - drops Content-Type when a later page changes to GET', async t => {
	const seenRequests = [];

	const items = await paginate.all(new Request('http://example.com/?page=1', {
		method: 'POST',
		headers: {
			authorization: 'Bearer secret',
			'content-type': 'application/json',
		},
		body: JSON.stringify({page: 1}),
	}), {
		async fetchFunction(input, options) {
			const request = input instanceof Request ? input : new Request(input, options);
			const pageParameter = new URL(request.url).searchParams.get('page');
			const page = pageParameter ? Number.parseInt(pageParameter, 10) : 1;
			const body = request.body ? await request.text() : undefined;

			seenRequests.push({
				url: request.url,
				method: request.method,
				authorization: request.headers.get('authorization'),
				contentType: request.headers.get('content-type'),
				body,
			});

			return {
				ok: true,
				status: 200,
				url: request.url,
				headers: {
					get(name) {
						if (name === 'Link' && page === 1) {
							return '<http://example.com/?page=2>; rel="next"';
						}

						return undefined;
					},
				},
				json: async () => [page],
			};
		},
		pagination: {
			paginate({response}) {
				if (response.url.endsWith('page=1')) {
					return {
						url: new URL('http://example.com/?page=2'),
						method: 'GET',
					};
				}

				return false;
			},
		},
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'http://example.com/?page=1',
			method: 'POST',
			authorization: 'Bearer secret',
			contentType: 'application/json',
			body: '{"page":1}',
		},
		{
			url: 'http://example.com/?page=2',
			method: 'GET',
			authorization: 'Bearer secret',
			contentType: null,
			body: undefined,
		},
	]);
});

test.serial('paginate - drops body headers when a later page changes to HEAD', async t => {
	const seenRequests = [];

	const items = await paginate.all(new Request('http://example.com/?page=1', {
		method: 'POST',
		headers: {
			authorization: 'Bearer secret',
			'content-type': 'application/json',
		},
		body: JSON.stringify({page: 1}),
	}), {
		async fetchFunction(input, options) {
			const request = input instanceof Request ? input : new Request(input, options);
			const pageParameter = new URL(request.url).searchParams.get('page');
			const page = pageParameter ? Number.parseInt(pageParameter, 10) : 1;
			const body = request.body ? await request.text() : undefined;

			seenRequests.push({
				url: request.url,
				method: request.method,
				authorization: request.headers.get('authorization'),
				contentType: request.headers.get('content-type'),
				body,
			});

			return {
				ok: true,
				status: 200,
				url: request.url,
				headers: {
					get(name) {
						if (name === 'Link' && page === 1) {
							return '<http://example.com/?page=2>; rel="next"';
						}

						return undefined;
					},
				},
				json: async () => [page],
			};
		},
		pagination: {
			paginate({response}) {
				if (response.url.endsWith('page=1')) {
					return {
						url: new URL('http://example.com/?page=2'),
						method: 'HEAD',
					};
				}

				return false;
			},
		},
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'http://example.com/?page=1',
			method: 'POST',
			authorization: 'Bearer secret',
			contentType: 'application/json',
			body: '{"page":1}',
		},
		{
			url: 'http://example.com/?page=2',
			method: 'HEAD',
			authorization: 'Bearer secret',
			contentType: null,
			body: undefined,
		},
	]);
});

test('paginate - throws when URL input uses GET with an explicit body', async t => {
	await t.throwsAsync(
		paginate.all('http://example.com/?page=1', {
			method: 'GET',
			body: 'page request body',
			fetchFunction: async () => ({
				ok: true,
				status: 200,
				url: 'http://example.com/?page=1',
				headers: {
					get() {
						return undefined;
					},
				},
				json: async () => [1],
			}),
		}),
		{
			instanceOf: TypeError,
			message: 'Request with GET/HEAD method cannot have body.',
		},
	);
});

test.serial('paginate - throws when a later page changes to HEAD with an explicit body', async t => {
	await t.throwsAsync(
		paginate.all(new Request('http://example.com/?page=1', {
			method: 'POST',
			body: 'page request body',
		}), {
			fetchFunction: async input => ({
				ok: true,
				status: 200,
				url: input instanceof Request ? input.url : input.toString(),
				headers: {
					get(name) {
						if (name === 'Link') {
							return '<http://example.com/?page=2>; rel="next"';
						}

						return undefined;
					},
				},
				json: async () => [1],
			}),
			pagination: {
				paginate() {
					return {
						url: new URL('http://example.com/?page=2'),
						method: 'HEAD',
						body: 'cursor=2',
					};
				},
			},
		}),
		{
			instanceOf: TypeError,
			message: 'Request with GET/HEAD method cannot have body.',
		},
	);
});

test.serial('paginate - drops all request-body headers when a later page changes to GET', async t => {
	const seenRequests = [];

	const items = await paginate.all(new Request('http://example.com/?page=1', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'content-encoding': 'gzip',
			'content-language': 'en',
			'content-location': '/page=1',
			'content-range': 'bytes 0-10/11',
		},
		body: JSON.stringify({page: 1}),
	}), {
		async fetchFunction(input, options) {
			const request = input instanceof Request ? input : new Request(input, options);
			const pageParameter = new URL(request.url).searchParams.get('page');
			const page = pageParameter ? Number.parseInt(pageParameter, 10) : 1;

			seenRequests.push({
				url: request.url,
				method: request.method,
				contentType: request.headers.get('content-type'),
				contentEncoding: request.headers.get('content-encoding'),
				contentLanguage: request.headers.get('content-language'),
				contentLocation: request.headers.get('content-location'),
				contentRange: request.headers.get('content-range'),
			});

			return {
				ok: true,
				status: 200,
				url: request.url,
				headers: {
					get(name) {
						if (name === 'Link' && page === 1) {
							return '<http://example.com/?page=2>; rel="next"';
						}

						return undefined;
					},
				},
				json: async () => [page],
			};
		},
		pagination: {
			paginate({response}) {
				if (response.url.endsWith('page=1')) {
					return {
						url: new URL('http://example.com/?page=2'),
						method: 'GET',
					};
				}

				return false;
			},
		},
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'http://example.com/?page=1',
			method: 'POST',
			contentType: 'application/json',
			contentEncoding: 'gzip',
			contentLanguage: 'en',
			contentLocation: '/page=1',
			contentRange: 'bytes 0-10/11',
		},
		{
			url: 'http://example.com/?page=2',
			method: 'GET',
			contentType: null,
			contentEncoding: null,
			contentLanguage: null,
			contentLocation: null,
			contentRange: 'bytes 0-10/11',
		},
	]);
});

test.serial('paginate - drops body headers when URL input with body options changes to GET', async t => {
	const seenRequests = [];

	const items = await paginate.all('http://example.com/?page=1', {
		method: 'POST',
		headers: {
			authorization: 'Bearer secret',
			'content-type': 'application/json',
		},
		body: JSON.stringify({page: 1}),
		async fetchFunction(input, options) {
			const request = new Request(input, options);
			const pageParameter = new URL(request.url).searchParams.get('page');
			const page = pageParameter ? Number.parseInt(pageParameter, 10) : 1;
			const body = request.body ? await request.text() : undefined;

			seenRequests.push({
				url: request.url,
				method: request.method,
				authorization: request.headers.get('authorization'),
				contentType: request.headers.get('content-type'),
				body,
			});

			return {
				ok: true,
				status: 200,
				url: request.url,
				headers: {
					get(name) {
						if (name === 'Link' && page === 1) {
							return '<http://example.com/?page=2>; rel="next"';
						}

						return undefined;
					},
				},
				json: async () => [page],
			};
		},
		pagination: {
			paginate({response}) {
				if (response.url.endsWith('page=1')) {
					return {
						url: new URL('http://example.com/?page=2'),
						method: 'GET',
					};
				}

				return false;
			},
		},
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'http://example.com/?page=1',
			method: 'POST',
			authorization: 'Bearer secret',
			contentType: 'application/json',
			body: '{"page":1}',
		},
		{
			url: 'http://example.com/?page=2',
			method: 'GET',
			authorization: 'Bearer secret',
			contentType: null,
			body: undefined,
		},
	]);
});

test.serial('paginate - drops body headers when URL input with body options changes to HEAD', async t => {
	const seenRequests = [];

	const items = await paginate.all('http://example.com/?page=1', {
		method: 'POST',
		headers: {
			authorization: 'Bearer secret',
			'content-type': 'application/json',
		},
		body: JSON.stringify({page: 1}),
		async fetchFunction(input, options) {
			const request = new Request(input, options);
			const pageParameter = new URL(request.url).searchParams.get('page');
			const page = pageParameter ? Number.parseInt(pageParameter, 10) : 1;
			const body = request.body ? await request.text() : undefined;

			seenRequests.push({
				url: request.url,
				method: request.method,
				authorization: request.headers.get('authorization'),
				contentType: request.headers.get('content-type'),
				body,
			});

			return {
				ok: true,
				status: 200,
				url: request.url,
				headers: {
					get(name) {
						if (name === 'Link' && page === 1) {
							return '<http://example.com/?page=2>; rel="next"';
						}

						return undefined;
					},
				},
				json: async () => [page],
			};
		},
		pagination: {
			paginate({response}) {
				if (response.url.endsWith('page=1')) {
					return {
						url: new URL('http://example.com/?page=2'),
						method: 'HEAD',
					};
				}

				return false;
			},
		},
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'http://example.com/?page=1',
			method: 'POST',
			authorization: 'Bearer secret',
			contentType: 'application/json',
			body: '{"page":1}',
		},
		{
			url: 'http://example.com/?page=2',
			method: 'HEAD',
			authorization: 'Bearer secret',
			contentType: null,
			body: undefined,
		},
	]);
});

test.serial('paginate - clears an inherited body for URL input when a later page returns body undefined', async t => {
	const seenRequests = [];

	const items = await paginate.all('http://example.com/?page=1', {
		method: 'POST',
		headers: {
			authorization: 'Bearer secret',
			'content-type': 'text/plain',
		},
		body: 'page request body',
		async fetchFunction(input, options) {
			const request = new Request(input, options);
			const pageParameter = new URL(request.url).searchParams.get('page');
			const page = pageParameter ? Number.parseInt(pageParameter, 10) : 1;
			const body = request.body ? await request.text() : undefined;

			seenRequests.push({
				url: request.url,
				method: request.method,
				authorization: request.headers.get('authorization'),
				contentType: request.headers.get('content-type'),
				body,
			});

			return {
				ok: true,
				status: 200,
				url: request.url,
				headers: {
					get(name) {
						if (name === 'Link' && page === 1) {
							return '<http://example.com/?page=2>; rel="next"';
						}

						return undefined;
					},
				},
				json: async () => [page],
			};
		},
		pagination: {
			paginate({response}) {
				if (response.url.endsWith('page=1')) {
					return {
						url: new URL('http://example.com/?page=2'),
						body: undefined,
					};
				}

				return false;
			},
		},
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'http://example.com/?page=1',
			method: 'POST',
			authorization: 'Bearer secret',
			contentType: 'text/plain',
			body: 'page request body',
		},
		{
			url: 'http://example.com/?page=2',
			method: 'POST',
			authorization: 'Bearer secret',
			contentType: null,
			body: undefined,
		},
	]);
});

test.serial('paginate - clears an inherited request body when a later page returns body undefined', async t => {
	const seenRequests = [];

	const items = await paginate.all(new Request('http://example.com/?page=1', {
		method: 'POST',
		headers: {
			'content-type': 'text/plain',
		},
		body: 'page request body',
	}), {
		async fetchFunction(input, options) {
			const request = input instanceof Request ? input : new Request(input, options);
			const pageParameter = new URL(request.url).searchParams.get('page');
			const page = pageParameter ? Number.parseInt(pageParameter, 10) : 1;
			const body = request.body ? await request.text() : undefined;

			seenRequests.push({
				url: request.url,
				method: request.method,
				contentType: request.headers.get('content-type'),
				body,
			});

			return {
				ok: true,
				status: 200,
				url: request.url,
				headers: {
					get(name) {
						if (name === 'Link' && page === 1) {
							return '<http://example.com/?page=2>; rel="next"';
						}

						return undefined;
					},
				},
				json: async () => [page],
			};
		},
		pagination: {
			paginate({response}) {
				if (response.url.endsWith('page=1')) {
					return {
						url: new URL('http://example.com/?page=2'),
						body: undefined,
					};
				}

				return false;
			},
		},
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'http://example.com/?page=1',
			method: 'POST',
			contentType: 'text/plain',
			body: 'page request body',
		},
		{
			url: 'http://example.com/?page=2',
			method: 'POST',
			contentType: null,
			body: undefined,
		},
	]);
});

test.serial('paginate - replacing the body on later pages drops stale inherited body metadata', async t => {
	const seenRequests = [];

	const items = await paginate.all(new Request('http://example.com/?page=1', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'content-language': 'en',
		},
		body: JSON.stringify({page: 1}),
	}), {
		async fetchFunction(input, options) {
			const request = input instanceof Request ? input : new Request(input, options);
			const pageParameter = new URL(request.url).searchParams.get('page');
			const page = pageParameter ? Number.parseInt(pageParameter, 10) : 1;
			const body = request.body ? await request.text() : undefined;

			seenRequests.push({
				url: request.url,
				method: request.method,
				contentType: request.headers.get('content-type'),
				contentLanguage: request.headers.get('content-language'),
				body,
			});

			return {
				ok: true,
				status: 200,
				url: request.url,
				headers: {
					get(name) {
						if (name === 'Link' && page === 1) {
							return '<http://example.com/?page=2>; rel="next"';
						}

						return undefined;
					},
				},
				json: async () => [page],
			};
		},
		pagination: {
			paginate({response}) {
				if (response.url.endsWith('page=1')) {
					return {
						url: new URL('http://example.com/?page=2'),
						body: 'cursor=2',
					};
				}

				return false;
			},
		},
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'http://example.com/?page=1',
			method: 'POST',
			contentType: 'application/json',
			contentLanguage: 'en',
			body: '{"page":1}',
		},
		{
			url: 'http://example.com/?page=2',
			method: 'POST',
			contentType: 'application/json',
			contentLanguage: 'en',
			body: 'cursor=2',
		},
	]);
});

test.serial('paginate - replacing the body on later pages accepts plain-object headers', async t => {
	const seenRequests = [];

	const items = await paginate.all(new Request('http://example.com/?page=1', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
		},
		body: '{"page":1}',
	}), {
		async fetchFunction(input, options) {
			const request = input instanceof Request ? input : new Request(input, options);
			const pageParameter = new URL(request.url).searchParams.get('page');
			const page = pageParameter ? Number.parseInt(pageParameter, 10) : 1;
			const body = request.body ? await request.text() : undefined;

			seenRequests.push({
				url: request.url,
				method: request.method,
				authorization: request.headers.get('authorization'),
				contentType: request.headers.get('content-type'),
				body,
			});

			return {
				ok: true,
				status: 200,
				url: request.url,
				headers: {
					get(name) {
						if (name === 'Link' && page === 1) {
							return '<http://example.com/?page=2>; rel="next"';
						}

						return undefined;
					},
				},
				json: async () => [page],
			};
		},
		pagination: {
			paginate({response}) {
				if (response.url.endsWith('page=1')) {
					return {
						url: new URL('http://example.com/?page=2'),
						headers: {
							authorization: 'Bearer secret',
						},
						body: 'cursor=2',
					};
				}

				return false;
			},
		},
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'http://example.com/?page=1',
			method: 'POST',
			authorization: null,
			contentType: 'application/json',
			body: '{"page":1}',
		},
		{
			url: 'http://example.com/?page=2',
			method: 'POST',
			authorization: 'Bearer secret',
			contentType: 'text/plain;charset=UTF-8',
			body: 'cursor=2',
		},
	]);
});

test.serial('paginate - replacing the body on later pages drops stale inherited metadata for URL input', async t => {
	const seenRequests = [];

	const items = await paginate.all('http://example.com/?page=1', {
		method: 'POST',
		headers: {
			'content-type': 'application/json',
			'content-language': 'en',
		},
		body: '{"page":1}',
		async fetchFunction(input, options) {
			const request = new Request(input, options);
			const pageParameter = new URL(request.url).searchParams.get('page');
			const page = pageParameter ? Number.parseInt(pageParameter, 10) : 1;
			const body = request.body ? await request.text() : undefined;

			seenRequests.push({
				url: request.url,
				method: request.method,
				contentType: request.headers.get('content-type'),
				contentLanguage: request.headers.get('content-language'),
				body,
			});

			return {
				ok: true,
				status: 200,
				url: request.url,
				headers: {
					get(name) {
						if (name === 'Link' && page === 1) {
							return '<http://example.com/?page=2>; rel="next"';
						}

						return undefined;
					},
				},
				json: async () => [page],
			};
		},
		pagination: {
			paginate({response}) {
				if (response.url.endsWith('page=1')) {
					return {
						url: new URL('http://example.com/?page=2'),
						body: 'cursor=2',
					};
				}

				return false;
			},
		},
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'http://example.com/?page=1',
			method: 'POST',
			contentType: 'application/json',
			contentLanguage: 'en',
			body: '{"page":1}',
		},
		{
			url: 'http://example.com/?page=2',
			method: 'POST',
			contentType: 'application/json',
			contentLanguage: 'en',
			body: 'cursor=2',
		},
	]);
});

test.serial('paginate - later page headers replace inherited request headers', async t => {
	const seenRequests = [];

	const items = await paginate.all(new Request('http://example.com/?page=1', {
		method: 'POST',
		headers: {
			authorization: 'Bearer secret',
			accept: 'application/json',
			'content-type': 'application/json',
		},
		body: '{"page":1}',
	}), {
		async fetchFunction(input, options) {
			const request = input instanceof Request ? input : new Request(input, options);
			const pageParameter = new URL(request.url).searchParams.get('page');
			const page = pageParameter ? Number.parseInt(pageParameter, 10) : 1;

			seenRequests.push({
				url: request.url,
				authorization: request.headers.get('authorization'),
				accept: request.headers.get('accept'),
				xPage: request.headers.get('x-page'),
			});

			return {
				ok: true,
				status: 200,
				url: request.url,
				headers: {
					get(name) {
						if (name === 'Link' && page === 1) {
							return '<http://example.com/?page=2>; rel="next"';
						}

						return undefined;
					},
				},
				json: async () => [page],
			};
		},
		pagination: {
			paginate({response}) {
				if (response.url.endsWith('page=1')) {
					return {
						url: new URL('http://example.com/?page=2'),
						headers: {
							'x-page': '2',
						},
					};
				}

				return false;
			},
		},
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'http://example.com/?page=1',
			authorization: 'Bearer secret',
			accept: 'application/json',
			xPage: null,
		},
		{
			url: 'http://example.com/?page=2',
			authorization: null,
			accept: null,
			xPage: '2',
		},
	]);
});

test.serial('paginate - follows Link headers with multiple rel values', async t => {
	const mockFetch = async url => {
		const pageParameter = new URL(url).searchParams.get('page');
		const page = pageParameter ? Number.parseInt(pageParameter, 10) : 1;

		return {
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get(name) {
					if (name === 'Link' && page === 1) {
						return '<http://example.com/?page=2>; rel="next collection"';
					}

					return undefined;
				},
			},
			json: async () => [page],
		};
	};

	const items = await paginate.all('http://example.com/?page=1', {fetchFunction: mockFetch});
	t.deepEqual(items, [1, 2]);
});

test.serial('paginate - follows Link headers with uppercase registered relation types', async t => {
	const mockFetch = async url => {
		const pageParameter = new URL(url).searchParams.get('page');
		const page = pageParameter ? Number.parseInt(pageParameter, 10) : 1;

		return {
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get(name) {
					if (name === 'Link' && page === 1) {
						return '<http://example.com/?page=2>; rel="NEXT"';
					}

					return undefined;
				},
			},
			json: async () => [page],
		};
	};

	const items = await paginate.all('http://example.com/?page=1', {fetchFunction: mockFetch});
	t.deepEqual(items, [1, 2]);
});

test.serial('paginate - follows Link headers with uppercase rel parameter names', async t => {
	const mockFetch = async url => {
		const pageParameter = new URL(url).searchParams.get('page');
		const page = pageParameter ? Number.parseInt(pageParameter, 10) : 1;

		return {
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get(name) {
					if (name === 'Link' && page === 1) {
						return '<http://example.com/?page=2>; REL="next"';
					}

					return undefined;
				},
			},
			json: async () => [page],
		};
	};

	const items = await paginate.all('http://example.com/?page=1', {fetchFunction: mockFetch});
	t.deepEqual(items, [1, 2]);
});

test.serial('paginate - uses the first rel parameter when duplicates are present', async t => {
	const mockFetch = async url => {
		const pageParameter = new URL(url).searchParams.get('page');
		const page = pageParameter ? Number.parseInt(pageParameter, 10) : 1;

		return {
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get(name) {
					if (name === 'Link' && page === 1) {
						return '<http://example.com/?page=2>; rel="next"; rel="prev"';
					}

					return undefined;
				},
			},
			json: async () => [page],
		};
	};

	const items = await paginate.all('http://example.com/?page=1', {fetchFunction: mockFetch});
	t.deepEqual(items, [1, 2]);
});

test.serial('paginate - preserves Request options overrides across pages', async t => {
	const seenRequests = [];
	const mockFetch = async (input, options) => {
		const request = new Request(input, options);
		const pageParameter = new URL(request.url).searchParams.get('page');
		const page = pageParameter ? Number.parseInt(pageParameter, 10) : 1;
		const body = request.body ? await request.text() : undefined;

		seenRequests.push({
			method: request.method,
			authorization: request.headers.get('authorization'),
			accept: request.headers.get('accept'),
			body,
		});

		return {
			ok: true,
			status: 200,
			url: request.url,
			headers: {
				get(name) {
					if (name === 'Link' && page === 1) {
						return '<http://example.com/?page=2>; rel="next"';
					}

					return undefined;
				},
			},
			json: async () => [page],
		};
	};

	const items = await paginate.all(new Request('http://example.com/?page=1', {
		method: 'POST',
		headers: {
			authorization: 'Bearer request',
		},
		body: 'request body',
	}), {
		fetchFunction: mockFetch,
		method: 'PATCH',
		headers: {
			authorization: 'Bearer options',
			accept: 'application/json',
		},
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			method: 'PATCH',
			authorization: 'Bearer options',
			accept: 'application/json',
			body: 'request body',
		},
		{
			method: 'PATCH',
			authorization: 'Bearer options',
			accept: 'application/json',
			body: 'request body',
		},
	]);
});

test.serial('paginate - stops when Link header has no next relation', async t => {
	globalThis.fetch = async url => ({
		ok: true,
		status: 200,
		url: url.toString(),
		headers: {
			get(name) {
				if (name === 'Link') {
					return '<http://example.com/?page=0>; rel="prev"';
				}

				return undefined;
			},
		},
		json: async () => [1, 2],
	});

	const items = await paginate.all('http://example.com/');
	t.deepEqual(items, [1, 2]);
});

test.serial('paginate - handles relative URLs in Link header', async t => {
	let callCount = 0;
	globalThis.fetch = async url => {
		callCount++;

		if (callCount === 1) {
			return {
				ok: true,
				status: 200,
				url: url.toString(),
				headers: {
					get(name) {
						if (name === 'Link') {
							return '</?page=2>; rel="next"';
						}

						return undefined;
					},
				},
				json: async () => [1, 2],
			};
		}

		return {
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get() {
					return undefined;
				},
			},
			json: async () => [3, 4],
		};
	};

	const items = await paginate.all('http://example.com/?page=1');
	t.deepEqual(items, [1, 2, 3, 4]);
});

test.serial('paginate - countLimit works', async t => {
	globalThis.fetch = createPaginatedMockFetch([[1, 2], [3, 4], [5, 6]]);

	const items = await paginate.all('http://example.com/?page=1', {
		pagination: {
			countLimit: 3,
		},
	});

	t.deepEqual(items, [1, 2, 3]);
});

test.serial('paginate - requestLimit works', async t => {
	globalThis.fetch = createPaginatedMockFetch([[1, 2], [3, 4], [5, 6]]);

	const items = await paginate.all('http://example.com/?page=1', {
		pagination: {
			requestLimit: 2,
		},
	});

	t.deepEqual(items, [1, 2, 3, 4]); // Only first 2 pages
});

test.serial('paginate - filter works', async t => {
	globalThis.fetch = createPaginatedMockFetch([[1, 2, 3, 4]]);

	const items = await paginate.all('http://example.com/?page=1', {
		pagination: {
			filter: ({item}) => item % 2 === 0, // Only even numbers
		},
	});

	t.deepEqual(items, [2, 4]);
});

test.serial('paginate - shouldContinue works', async t => {
	globalThis.fetch = createPaginatedMockFetch([[1, 2, 3, 4, 5]]);

	const items = await paginate.all('http://example.com/?page=1', {
		pagination: {
			shouldContinue: ({item}) => item < 3, // Stop when item >= 3
		},
	});

	t.deepEqual(items, [1, 2, 3]);
});

test.serial('paginate - shouldContinue is only called after filter returns true', async t => {
	globalThis.fetch = createPaginatedMockFetch([[1, 2, 3, 4]]);

	const shouldContinueCalls = [];
	const items = await paginate.all('http://example.com/?page=1', {
		pagination: {
			filter({item}) {
				return item % 2 === 0; // Only even numbers
			},
			shouldContinue({item}) {
				shouldContinueCalls.push(item);
				return true;
			},
		},
	});

	t.deepEqual(items, [2, 4]);
	t.deepEqual(shouldContinueCalls, [2, 4]); // Only called for filtered items
});

test.serial('paginate - shouldContinue sees the terminal item in currentItems and allItems', async t => {
	globalThis.fetch = createPaginatedMockFetch([[1, 2, 3]]);

	const states = [];
	const items = await paginate.all('http://example.com/?page=1', {
		pagination: {
			stackAllItems: true,
			shouldContinue({item, currentItems, allItems}) {
				states.push({
					item,
					currentItems: [...currentItems],
					allItems: [...allItems],
				});
				return item < 2;
			},
		},
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(states, [
		{item: 1, currentItems: [1], allItems: [1]},
		{item: 2, currentItems: [1, 2], allItems: [1, 2]},
	]);
});

test.serial('paginate - shouldContinue stops before fetching the next page after yielding the terminal item', async t => {
	let requestCount = 0;
	globalThis.fetch = async url => {
		requestCount++;
		const pageParameter = new URL(url).searchParams.get('page');
		const page = pageParameter ? Number.parseInt(pageParameter, 10) : 1;

		return {
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get(name) {
					if (name === 'Link' && page === 1) {
						return '<http://example.com/?page=2>; rel="next"';
					}

					return undefined;
				},
			},
			json: async () => page === 1 ? [1, 2, 3] : [4, 5, 6],
		};
	};

	const items = await paginate.all('http://example.com/?page=1', {
		pagination: {
			shouldContinue: ({item}) => item < 2,
		},
	});

	t.deepEqual(items, [1, 2]);
	t.is(requestCount, 1);
});

test.serial('paginate - backoff delays between requests', async t => {
	globalThis.fetch = createPaginatedMockFetch([[1], [2], [3]]);

	const start = Date.now();
	await paginate.all('http://example.com/?page=1', {
		pagination: {
			backoff: 50,
		},
	});
	const duration = Date.now() - start;

	// Should have at least 2 delays (between page 1->2 and 2->3)
	t.true(duration >= 100);
});

test.serial('paginate - aborts during backoff before the next request', async t => {
	const abortController = new AbortController();
	let requestCount = 0;

	const iteration = paginate.all('http://example.com/?page=1', {
		signal: abortController.signal,
		async fetchFunction(url) {
			requestCount++;
			const pageParameter = new URL(url).searchParams.get('page');
			const page = pageParameter ? Number.parseInt(pageParameter, 10) : 1;

			if (page === 1) {
				queueMicrotask(() => {
					abortController.abort(new Error('stop now'));
				});
			} else {
				throw new Error('unexpected second request');
			}

			return {
				ok: true,
				status: 200,
				url: url.toString(),
				headers: {
					get(name) {
						if (name === 'Link' && page === 1) {
							return '<http://example.com/?page=2>; rel="next"';
						}

						return undefined;
					},
				},
				json: async () => [page],
			};
		},
		pagination: {
			backoff: 50,
		},
	});

	await t.throwsAsync(iteration, {name: 'Error', message: 'stop now'});
	t.is(requestCount, 1);
});

test.serial('paginate - aborts during backoff for Request input signals before the next request', async t => {
	const abortController = new AbortController();
	let requestCount = 0;

	const iteration = paginate.all(new Request('http://example.com/?page=1', {
		signal: abortController.signal,
	}), {
		async fetchFunction(input, options) {
			requestCount++;
			const request = input instanceof Request ? input : new Request(input, options);
			const pageParameter = new URL(request.url).searchParams.get('page');
			const page = pageParameter ? Number.parseInt(pageParameter, 10) : 1;

			if (page === 1) {
				queueMicrotask(() => {
					abortController.abort(new Error('stop request signal'));
				});
			} else {
				throw new Error('unexpected second request');
			}

			return {
				ok: true,
				status: 200,
				url: request.url,
				headers: {
					get(name) {
						if (name === 'Link' && page === 1) {
							return '<http://example.com/?page=2>; rel="next"';
						}

						return undefined;
					},
				},
				json: async () => [page],
			};
		},
		pagination: {
			backoff: 50,
		},
	});

	await t.throwsAsync(iteration, {name: 'Error', message: 'stop request signal'});
	t.is(requestCount, 1);
});

test.serial('paginate - does not schedule timers when backoff is zero', async t => {
	globalThis.fetch = createPaginatedMockFetch([[1], [2], [3]]);

	const originalSetTimeout = globalThis.setTimeout;
	const delays = [];
	globalThis.setTimeout = (callback, milliseconds, ...arguments_) => {
		delays.push(milliseconds);
		return originalSetTimeout(callback, milliseconds, ...arguments_);
	};

	try {
		await paginate.all('http://example.com/?page=1');
	} finally {
		globalThis.setTimeout = originalSetTimeout;
	}

	t.deepEqual(delays, []);
});

test.serial('paginate - stackAllItems false keeps allItems empty', async t => {
	globalThis.fetch = createPaginatedMockFetch([[1, 2], [3, 4]]);

	const allItemsSizes = [];
	await paginate.all('http://example.com/?page=1', {
		pagination: {
			stackAllItems: false,
			filter({allItems}) {
				allItemsSizes.push(allItems.length);
				return true;
			},
		},
	});

	t.true(allItemsSizes.every(size => size === 0));
});

test.serial('paginate - stackAllItems true keeps allItems', async t => {
	globalThis.fetch = createPaginatedMockFetch([[1, 2], [3, 4]]);

	const allItemsSizes = [];
	await paginate.all('http://example.com/?page=1', {
		pagination: {
			stackAllItems: true,
			filter({allItems}) {
				allItemsSizes.push(allItems.length);
				return true;
			},
		},
	});

	t.deepEqual(allItemsSizes, [0, 1, 2, 3]);
});

test.serial('paginate - custom transform works', async t => {
	globalThis.fetch = async url => ({
		ok: true,
		status: 200,
		url: url.toString(),
		headers: {
			get() {
				return undefined;
			},
		},
		json: async () => ({items: [1, 2, 3]}),
	});

	const items = await paginate.all('http://example.com/', {
		pagination: {
			async transform(response) {
				const data = await response.json();
				return data.items;
			},
		},
	});

	t.deepEqual(items, [1, 2, 3]);
});

test.serial('paginate - custom paginate function works', async t => {
	let callCount = 0;
	globalThis.fetch = async url => {
		callCount++;
		const urlObject = new URL(url);
		const page = Number.parseInt(urlObject.searchParams.get('page') || '1', 10);

		const responseData = {
			items: [page],
			hasMore: page < 3,
		};

		return {
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get() {
					return undefined;
				},
			},
			bodyUsed: false,
			async json() {
				if (this.bodyUsed) {
					throw new TypeError('Body has already been consumed');
				}

				this.bodyUsed = true;
				// Store data on response for paginate function to access
				this._data = responseData;
				return responseData;
			},
		};
	};

	const items = await paginate.all('http://example.com/?page=1', {
		pagination: {
			async transform(response) {
				const data = await response.json();
				return data.items;
			},
			async paginate({response}) {
				// Access the cached data instead of calling json() again
				const data = response._data;
				if (!data.hasMore) {
					return false;
				}

				const urlObject = new URL(response.url);
				const currentPage = Number.parseInt(urlObject.searchParams.get('page') || '1', 10);
				return {
					url: new URL(`http://example.com/?page=${currentPage + 1}`),
				};
			},
		},
	});

	t.deepEqual(items, [1, 2, 3]);
	t.is(callCount, 3);
});

test.serial('paginate - throws if transform does not return array', async t => {
	globalThis.fetch = async url => ({
		ok: true,
		status: 200,
		url: url.toString(),
		headers: {
			get() {
				return undefined;
			},
		},
		json: async () => ({not: 'an array'}),
	});

	await t.throwsAsync(
		async () => paginate.all('http://example.com/'),
		{message: /must return an array/},
	);
});

test.serial('paginate - throws if paginate returns non-URL url', async t => {
	globalThis.fetch = async url => ({
		ok: true,
		status: 200,
		url: url.toString(),
		headers: {
			get() {
				return undefined;
			},
		},
		json: async () => [1],
	});

	await t.throwsAsync(
		async () => paginate.all('http://example.com/', {
			pagination: {
				paginate: () => ({url: 'not a URL instance'}),
			},
		}),
		{message: /URL instance/},
	);
});

test.serial('paginate - throws if paginate returns a non-object truthy value', async t => {
	let requestCount = 0;

	globalThis.fetch = async url => {
		requestCount++;

		return {
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get() {
					return undefined;
				},
			},
			json: async () => [1],
		};
	};

	await t.throwsAsync(
		async () => paginate.all('http://example.com/', {
			pagination: {
				paginate: () => 'http://example.com/?page=2',
			},
		}),
		{message: /paginate must return an object or false/},
	);

	t.is(requestCount, 1);
});

test.serial('paginate - throws if paginate returns an invalid url value', async t => {
	globalThis.fetch = async url => ({
		ok: true,
		status: 200,
		url: url.toString(),
		headers: {
			get() {
				return undefined;
			},
		},
		json: async () => [1],
	});

	await t.throwsAsync(
		async () => paginate.all('http://example.com/', {
			pagination: {
				paginate: () => ({url: ''}),
			},
		}),
		{message: /paginate must return an object with url as a URL instance/},
	);
});

test.serial('paginate - repeats the same request when paginate returns an empty object', async t => {
	let requestCount = 0;

	globalThis.fetch = async url => {
		requestCount++;

		return {
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get() {
					return undefined;
				},
			},
			json: async () => [1],
		};
	};

	const items = await paginate.all('http://example.com/', {
		pagination: {
			paginate: () => ({}),
			requestLimit: 2,
		},
	});

	t.deepEqual(items, [1, 1]);
	t.is(requestCount, 2);
});

test.serial('paginate - throws if paginate returns a URL instance directly', async t => {
	let requestCount = 0;

	globalThis.fetch = async url => {
		requestCount++;

		return {
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get() {
					return undefined;
				},
			},
			json: async () => [1],
		};
	};

	await t.throwsAsync(
		async () => paginate.all('http://example.com/', {
			pagination: {
				paginate: () => new URL('http://example.com/?page=2'),
			},
		}),
		{message: /paginate must return an object or false/},
	);

	t.is(requestCount, 1);
});

test.serial('paginate - throws if paginate returns an array', async t => {
	let requestCount = 0;

	globalThis.fetch = async url => {
		requestCount++;

		return {
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get() {
					return undefined;
				},
			},
			json: async () => [1],
		};
	};

	await t.throwsAsync(
		async () => paginate.all('http://example.com/', {
			pagination: {
				paginate: () => [],
			},
		}),
		{message: /paginate must return an object or false/},
	);

	t.is(requestCount, 1);
});

test.serial('paginate - validates transform is a function', async t => {
	await t.throwsAsync(
		async () => paginate.all('http://example.com/', {
			pagination: {
				transform: 'not a function',
			},
		}),
		{message: /transform must be a function/},
	);
});

test.serial('paginate - validates paginate is a function', async t => {
	await t.throwsAsync(
		async () => paginate.all('http://example.com/', {
			pagination: {
				paginate: 'not a function',
			},
		}),
		{message: /paginate must be a function/},
	);
});

test.serial('paginate - validates filter is a function', async t => {
	await t.throwsAsync(
		async () => paginate.all('http://example.com/', {
			pagination: {
				filter: 'not a function',
			},
		}),
		{message: /filter must be a function/},
	);
});

test.serial('paginate - validates shouldContinue is a function', async t => {
	await t.throwsAsync(
		async () => paginate.all('http://example.com/', {
			pagination: {
				shouldContinue: 'not a function',
			},
		}),
		{message: /shouldContinue must be a function/},
	);
});

test.serial('paginate - validates countLimit is a number', async t => {
	await t.throwsAsync(
		async () => paginate.all('http://example.com/', {
			pagination: {
				countLimit: 'not a number',
			},
		}),
		{message: /countLimit must be a number/},
	);
});

test.serial('paginate - validates countLimit is an integer', async t => {
	await t.throwsAsync(
		async () => paginate.all('http://example.com/', {
			pagination: {
				countLimit: 1.5,
			},
		}),
		{message: /countLimit must be an integer/},
	);
});

test.serial('paginate - validates requestLimit is a number', async t => {
	await t.throwsAsync(
		async () => paginate.all('http://example.com/', {
			pagination: {
				requestLimit: 'not a number',
			},
		}),
		{message: /requestLimit must be a number/},
	);
});

test.serial('paginate - validates requestLimit is an integer', async t => {
	await t.throwsAsync(
		async () => paginate.all('http://example.com/', {
			pagination: {
				requestLimit: 1.5,
			},
		}),
		{message: /requestLimit must be an integer/},
	);
});

test.serial('paginate - validates backoff is a number', async t => {
	await t.throwsAsync(
		async () => paginate.all('http://example.com/', {
			pagination: {
				backoff: 'not a number',
			},
		}),
		{message: /backoff must be a number/},
	);
});

test.serial('paginate - handles empty pages', async t => {
	globalThis.fetch = createPaginatedMockFetch([[1, 2], [], [3]]);

	const items = await paginate.all('http://example.com/?page=1');
	t.deepEqual(items, [1, 2, 3]);
});

test.serial('paginate - currentItems tracks current page items', async t => {
	globalThis.fetch = createPaginatedMockFetch([[1, 2], [3, 4, 5]]);

	const currentItemsLog = [];
	await paginate.all('http://example.com/?page=1', {
		pagination: {
			filter({currentItems}) {
				currentItemsLog.push([...currentItems]);
				return true;
			},
		},
	});

	t.deepEqual(currentItemsLog, [
		[], // First item of page 1
		[1], // Second item of page 1
		[], // First item of page 2
		[3], // Second item of page 2
		[3, 4], // Third item of page 2
	]);
});

test.serial('paginate - handles Link header with multiple relations', async t => {
	let callCount = 0;
	globalThis.fetch = async url => {
		callCount++;
		const linkHeader = callCount === 1
			? '<http://example.com/?page=1>; rel="prev", <http://example.com/?page=2>; rel="next", <http://example.com/?page=10>; rel="last"'
			: undefined;

		return {
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get(name) {
					if (name === 'Link') {
						return linkHeader;
					}

					return undefined;
				},
			},
			json: async () => callCount === 1 ? [1, 2] : [3, 4],
		};
	};

	const items = await paginate.all('http://example.com/', {
		pagination: {
			requestLimit: 2,
		},
	});

	t.deepEqual(items, [1, 2, 3, 4]);
});

test.serial('paginate - handles quoted rel values in Link header', async t => {
	let callCount = 0;
	globalThis.fetch = async url => {
		callCount++;

		if (callCount === 1) {
			return {
				ok: true,
				status: 200,
				url: url.toString(),
				headers: {
					get(name) {
						if (name === 'Link') {
							return '<http://example.com/?page=2>; rel="next"'; // Quoted
						}

						return undefined;
					},
				},
				json: async () => [1],
			};
		}

		return {
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get() {
					return undefined;
				},
			},
			json: async () => [2],
		};
	};

	const items = await paginate.all('http://example.com/');
	t.deepEqual(items, [1, 2]);
});

test.serial('paginate - handles apostrophes inside Link header URLs', async t => {
	let callCount = 0;
	globalThis.fetch = async url => {
		callCount++;

		if (callCount === 1) {
			return {
				ok: true,
				status: 200,
				url: url.toString(),
				headers: {
					get(name) {
						if (name === 'Link') {
							return '<http://example.com/?tag=Bob\'s&page=2>; rel="next"';
						}

						return undefined;
					},
				},
				json: async () => [1],
			};
		}

		return {
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get() {
					return undefined;
				},
			},
			json: async () => [2],
		};
	};

	const items = await paginate.all('http://example.com/?page=1');
	t.deepEqual(items, [1, 2]);
});

test.serial('paginate - handles relative starting URLs once pagination advances', async t => {
	let callCount = 0;
	const mockFetch = async url => {
		callCount++;

		if (callCount === 1) {
			t.is(url, '/api?page=1');

			return {
				ok: true,
				status: 200,
				url: 'https://example.com/api?page=1',
				headers: {
					get(name) {
						if (name === 'Link') {
							return '<https://example.com/api?page=2>; rel="next"';
						}

						return undefined;
					},
				},
				json: async () => [1],
			};
		}

		t.true(url instanceof URL);
		t.is(url.toString(), 'https://example.com/api?page=2');

		return {
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get() {
					return undefined;
				},
			},
			json: async () => [2],
		};
	};

	const items = await paginate.all('/api?page=1', {fetchFunction: mockFetch});
	t.deepEqual(items, [1, 2]);
});

test.serial('paginate - handles custom fetch responses with an empty response url', async t => {
	let callCount = 0;
	const seenRequests = [];
	const fetchFunction = async (input, options) => {
		const request = input instanceof Request ? input : new Request(input, options);
		callCount++;

		seenRequests.push({
			url: request.url,
			authorization: request.headers.get('authorization'),
		});

		if (callCount === 1) {
			return Response.json([1], {
				headers: {
					Link: '<https://evil.example/api?page=2>; rel="next"',
					'content-type': 'application/json',
				},
			});
		}

		return Response.json([2], {
			headers: {
				'content-type': 'application/json',
			},
		});
	};

	const items = await paginate.all(new Request('https://api.example.com/api?page=1', {
		headers: {
			authorization: 'Bearer secret',
		},
	}), {fetchFunction});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/api?page=1',
			authorization: 'Bearer secret',
		},
		{
			url: 'https://evil.example/api?page=2',
			authorization: null,
		},
	]);
});

test.serial('paginate - drops inherited Authorization on cross-origin next pages from absolute string input when response url is empty', async t => {
	const {seenRequests, fetchFunction} = createEmptyResponseUrlRecordedRequestFetch();

	const items = await paginate.all('https://api.example.com/api?page=1', {
		headers: {
			authorization: 'Bearer secret',
		},
		fetchFunction,
		pagination: createAbsoluteStringCurrentUrlPaginator('https://evil.example/api?page=2'),
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/api?page=1',
			authorization: 'Bearer secret',
		},
		{
			url: 'https://evil.example/api?page=2',
			authorization: null,
		},
	]);
});

test.serial('paginate - drops inherited Authorization case-insensitively on cross-origin next pages from absolute string input when response url is empty', async t => {
	const {seenRequests, fetchFunction} = createEmptyResponseUrlRecordedRequestFetch({
		recordHeaders: [['xApiKey', 'x-api-key']],
	});

	const items = await paginate.all('https://api.example.com/api?page=1', {
		headers: {
			Authorization: 'Bearer secret',
			'x-api-key': 'secret-key',
		},
		fetchFunction,
		pagination: createAbsoluteStringCurrentUrlPaginator('https://evil.example/api?page=2'),
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/api?page=1',
			authorization: 'Bearer secret',
			xApiKey: 'secret-key',
		},
		{
			url: 'https://evil.example/api?page=2',
			authorization: null,
			xApiKey: null,
		},
	]);
});

test.serial('paginate - preserves inherited Authorization on same-origin next pages from absolute string input when response url is empty', async t => {
	const {seenRequests, fetchFunction} = createEmptyResponseUrlRecordedRequestFetch();

	const items = await paginate.all('https://api.example.com/api?page=1', {
		headers: {
			authorization: 'Bearer secret',
		},
		fetchFunction,
		pagination: createAbsoluteStringCurrentUrlPaginator('https://api.example.com/api?page=2'),
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/api?page=1',
			authorization: 'Bearer secret',
		},
		{
			url: 'https://api.example.com/api?page=2',
			authorization: 'Bearer secret',
		},
	]);
});

test.serial('paginate - handles relative input with an empty response url when the next page is absolute', async t => {
	setMockLocation(t);
	let callCount = 0;

	const items = await paginate.all('/api?page=1', {
		async fetchFunction(url) {
			callCount++;

			if (callCount === 1) {
				t.is(url, '/api?page=1');

				return Response.json([1], {
					headers: {
						Link: '<https://example.com/api?page=2>; rel="next"',
						'content-type': 'application/json',
					},
				});
			}

			t.true(url instanceof URL);
			t.is(url.toString(), 'https://example.com/api?page=2');

			return Response.json([2], {
				headers: {
					'content-type': 'application/json',
				},
			});
		},
	});

	t.deepEqual(items, [1, 2]);
});

test.serial('paginate - drops inherited Authorization after a redirected relative request', async t => {
	setMockLocation(t);
	const {seenRequests, fetchFunction} = createRelativeAuthorizationRecordedFetch({
		firstResponseUrl: 'https://cdn.example.net/api?page=1',
		firstLink: '<https://cdn.example.net/api?page=2>; rel="next"',
	});

	const items = await paginate.all('/api?page=1', {
		headers: {
			authorization: 'Bearer secret',
		},
		fetchFunction,
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://example.com/api?page=1',
			authorization: 'Bearer secret',
		},
		{
			url: 'https://cdn.example.net/api?page=2',
			authorization: null,
		},
	]);
});

test.serial('paginate - preserves explicit Authorization overrides after a redirected relative request', async t => {
	setMockLocation(t);
	const {seenRequests, fetchFunction} = createRelativeAuthorizationRecordedFetch({
		firstResponseUrl: 'https://cdn.example.net/api?page=1',
	});

	const items = await paginate.all('/api?page=1', {
		headers: {
			authorization: 'Bearer secret',
		},
		fetchFunction,
		pagination: {
			requestLimit: 2,
			paginate({currentUrl}) {
				if (currentUrl instanceof URL && currentUrl.href === 'https://cdn.example.net/api?page=1') {
					return {
						url: new URL('https://cdn.example.net/api?page=2'),
						headers: {
							authorization: 'Bearer replacement',
						},
					};
				}

				return false;
			},
		},
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://example.com/api?page=1',
			authorization: 'Bearer secret',
		},
		{
			url: 'https://cdn.example.net/api?page=2',
			authorization: 'Bearer replacement',
		},
	]);
});

test.serial('paginate - drops inherited Authorization before absolute next pages from relative input when response url is empty', async t => {
	setMockLocation(t);
	const {seenRequests, fetchFunction} = createRelativeAuthorizationRecordedFetch();

	const items = await paginate.all('/api?page=1', {
		headers: {
			authorization: 'Bearer secret',
		},
		fetchFunction,
		pagination: createRelativeCurrentUrlPaginator({
			url: new URL('https://evil.example/api?page=2'),
		}),
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://example.com/api?page=1',
			authorization: 'Bearer secret',
		},
		{
			url: 'https://evil.example/api?page=2',
			authorization: null,
		},
	]);
});

test.serial('paginate - preserves explicit Authorization overrides before absolute next pages from relative input when response url is empty', async t => {
	setMockLocation(t);
	const {seenRequests, fetchFunction} = createRelativeAuthorizationRecordedFetch();

	const items = await paginate.all('/api?page=1', {
		headers: {
			authorization: 'Bearer secret',
		},
		fetchFunction,
		pagination: createRelativeCurrentUrlPaginator({
			url: new URL('https://evil.example/api?page=2'),
			headers: {
				authorization: 'Bearer replacement',
			},
		}),
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://example.com/api?page=1',
			authorization: 'Bearer secret',
		},
		{
			url: 'https://evil.example/api?page=2',
			authorization: 'Bearer replacement',
		},
	]);
});

test.serial('paginate - preserves explicit Authorization overrides across later same-origin pages', async t => {
	const seenRequests = [];

	const items = await paginate.all('https://api.example.com/?page=1', {
		headers: {
			authorization: 'Bearer secret',
		},
		async fetchFunction(input, options) {
			const request = input instanceof Request ? input : new Request(input, options);
			const page = seenRequests.length + 1;

			seenRequests.push({
				url: request.url,
				authorization: request.headers.get('authorization'),
			});

			return {
				ok: true,
				status: 200,
				url: request.url,
				headers: {
					get() {
						return undefined;
					},
				},
				json: async () => [page],
			};
		},
		pagination: {
			requestLimit: 3,
			paginate({currentUrl}) {
				if (currentUrl.href === 'https://api.example.com/?page=1') {
					return {
						url: new URL('https://cdn.example.net/?page=2'),
						headers: {
							authorization: 'Bearer replacement',
						},
					};
				}

				if (currentUrl.href === 'https://cdn.example.net/?page=2') {
					return {
						url: new URL('https://cdn.example.net/?page=3'),
					};
				}

				return false;
			},
		},
	});

	t.deepEqual(items, [1, 2, 3]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/?page=1',
			authorization: 'Bearer secret',
		},
		{
			url: 'https://cdn.example.net/?page=2',
			authorization: 'Bearer replacement',
		},
		{
			url: 'https://cdn.example.net/?page=3',
			authorization: 'Bearer replacement',
		},
	]);
});

test.serial('paginate - allows relative input with a body for custom fetch functions', async t => {
	const {seenCalls, fetchFunction} = createRelativeInputRecordedFetch();

	const items = await paginate.all('/api?page=1', {
		method: 'POST',
		headers: {
			'content-type': 'text/plain',
		},
		body: 'page request body',
		fetchFunction,
	});

	t.deepEqual(items, [1]);
	t.deepEqual(seenCalls, [
		{
			input: '/api?page=1',
			method: 'POST',
			body: 'page request body',
			contentType: 'text/plain',
		},
	]);
});

test.serial('paginate - replays streamed bodies for absolute URL input across pages', async t => {
	const seenRequests = [];
	const bodyStream = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('page request body'));
			controller.close();
		},
	});

	const items = await paginate.all('https://api.example.com/?page=1', {
		method: 'POST',
		headers: {
			'content-type': 'text/plain',
		},
		body: bodyStream,
		duplex: 'half',
		async fetchFunction(input, options) {
			const request = input instanceof Request ? input : new Request(input, options);
			const page = seenRequests.length + 1;
			const body = request.body ? await request.text() : undefined;

			seenRequests.push({
				url: request.url,
				body,
				contentType: request.headers.get('content-type'),
			});

			return {
				ok: true,
				status: 200,
				url: request.url,
				headers: {
					get(name) {
						if (name === 'Link' && page < 2) {
							return `<https://api.example.com/?page=${page + 1}>; rel="next"`;
						}

						return undefined;
					},
				},
				json: async () => [page],
			};
		},
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/?page=1',
			body: 'page request body',
			contentType: 'text/plain',
		},
		{
			url: 'https://api.example.com/?page=2',
			body: 'page request body',
			contentType: 'text/plain',
		},
	]);
});

test.serial('paginate - allows later pages to add a body while the current url is still relative', async t => {
	const {seenCalls, fetchFunction} = createRelativeInputRecordedFetch();

	const items = await paginate.all('/api?page=1', {
		fetchFunction,
		pagination: createRelativeCurrentUrlPaginator({
			body: 'cursor=2',
			headers: {
				'content-type': 'text/plain',
			},
		}),
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenCalls, [
		{
			input: '/api?page=1',
			method: undefined,
			body: undefined,
			contentType: undefined,
		},
		{
			input: '/api?page=1',
			method: undefined,
			body: 'cursor=2',
			contentType: 'text/plain',
		},
	]);
});

test.serial('paginate - drops body headers for relative input when a later page switches to GET', async t => {
	const {seenCalls, fetchFunction} = createRelativeInputRecordedFetch();

	const items = await paginate.all('/api?page=1', {
		method: 'POST',
		headers: {
			'content-type': 'text/plain',
		},
		body: 'page request body',
		fetchFunction,
		pagination: createRelativeCurrentUrlPaginator({
			method: 'GET',
		}),
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenCalls, [
		{
			input: '/api?page=1',
			method: 'POST',
			body: 'page request body',
			contentType: 'text/plain',
		},
		{
			input: '/api?page=1',
			method: 'GET',
			body: undefined,
			contentType: null,
		},
	]);
});

test.serial('paginate - drops body headers for relative input when a later page switches to HEAD', async t => {
	const {seenCalls, fetchFunction} = createRelativeInputRecordedFetch();

	const items = await paginate.all('/api?page=1', {
		method: 'POST',
		headers: {
			'content-type': 'text/plain',
		},
		body: 'page request body',
		fetchFunction,
		pagination: createRelativeCurrentUrlPaginator({
			method: 'HEAD',
		}),
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenCalls, [
		{
			input: '/api?page=1',
			method: 'POST',
			body: 'page request body',
			contentType: 'text/plain',
		},
		{
			input: '/api?page=1',
			method: 'HEAD',
			body: undefined,
			contentType: null,
		},
	]);
});

test.serial('paginate - clears an inherited body for relative input when a later page returns body undefined', async t => {
	const {seenCalls, fetchFunction} = createRelativeInputRecordedFetch();

	const items = await paginate.all('/api?page=1', {
		method: 'POST',
		headers: {
			'content-type': 'text/plain',
		},
		body: 'page request body',
		fetchFunction,
		pagination: createRelativeCurrentUrlPaginator({
			body: undefined,
		}),
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenCalls, [
		{
			input: '/api?page=1',
			method: 'POST',
			body: 'page request body',
			contentType: 'text/plain',
		},
		{
			input: '/api?page=1',
			method: 'POST',
			body: undefined,
			contentType: null,
		},
	]);
});

test.serial('paginate - handles valueless Link extension parameters', async t => {
	let callCount = 0;
	globalThis.fetch = async url => {
		callCount++;

		if (callCount === 1) {
			return {
				ok: true,
				status: 200,
				url: url.toString(),
				headers: {
					get(name) {
						if (name === 'Link') {
							return '<http://example.com/?page=2>; rel="next"; foo';
						}

						return undefined;
					},
				},
				json: async () => [1],
			};
		}

		return {
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get() {
					return undefined;
				},
			},
			json: async () => [2],
		};
	};

	const items = await paginate.all('http://example.com/?page=1');
	t.deepEqual(items, [1, 2]);
});

test.serial('paginate - handles apostrophes inside unquoted Link parameter values across multiple entries', async t => {
	let callCount = 0;
	globalThis.fetch = async url => {
		callCount++;

		if (callCount === 1) {
			return {
				ok: true,
				status: 200,
				url: url.toString(),
				headers: {
					get(name) {
						if (name === 'Link') {
							return '<http://example.com/?page=2>; rel="next"; foo=bar\'baz, <http://example.com/?page=3>; rel="last"';
						}

						return undefined;
					},
				},
				json: async () => [1],
			};
		}

		return {
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get() {
					return undefined;
				},
			},
			json: async () => [2],
		};
	};

	const items = await paginate.all('http://example.com/?page=1');
	t.deepEqual(items, [1, 2]);
});

test.serial('paginate - handles apostrophes inside Link header URLs across multiple entries', async t => {
	let callCount = 0;
	globalThis.fetch = async url => {
		callCount++;

		if (callCount === 1) {
			return {
				ok: true,
				status: 200,
				url: url.toString(),
				headers: {
					get(name) {
						if (name === 'Link') {
							return '<http://example.com/?page=1>; rel="prev", <http://example.com/?tag=Bob\'s&page=2>; rel="next", <http://example.com/?page=3>; rel="last"';
						}

						return undefined;
					},
				},
				json: async () => [1],
			};
		}

		return {
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get() {
					return undefined;
				},
			},
			json: async () => [2],
		};
	};

	const items = await paginate.all('http://example.com/?page=1');
	t.deepEqual(items, [1, 2]);
});

test('parseLinkHeader - handles escaped quotes inside quoted Link header parameters', t => {
	const links = parseLinkHeader('<http://example.com/?page=1>; rel="prev"; title="Previous \\"page\\"", <http://example.com/?page=2>; rel="next"; title="Next \\"page\\""');

	t.deepEqual(links, [
		{
			url: 'http://example.com/?page=1',
			parameters: {
				rel: 'prev',
				title: 'Previous "page"',
			},
		},
		{
			url: 'http://example.com/?page=2',
			parameters: {
				rel: 'next',
				title: 'Next "page"',
			},
		},
	]);
});

test.serial('paginate - handles apostrophes inside quoted Link header parameters across multiple entries', async t => {
	let callCount = 0;
	globalThis.fetch = async url => {
		callCount++;

		if (callCount === 1) {
			return {
				ok: true,
				status: 200,
				url: url.toString(),
				headers: {
					get(name) {
						if (name === 'Link') {
							return '<http://example.com/?page=1>; rel="prev"; title="Bob\'s previous page", <http://example.com/?page=2>; rel="next"; title="Bob\'s next page"';
						}

						return undefined;
					},
				},
				json: async () => [1],
			};
		}

		return {
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get() {
					return undefined;
				},
			},
			json: async () => [2],
		};
	};

	const items = await paginate.all('http://example.com/?page=1');
	t.deepEqual(items, [1, 2]);
});

test.serial('paginate - handles delimiters inside URLs across multiple Link header entries', async t => {
	let callCount = 0;
	globalThis.fetch = async url => {
		callCount++;

		if (callCount === 1) {
			return {
				ok: true,
				status: 200,
				url: url.toString(),
				headers: {
					get(name) {
						if (name === 'Link') {
							return '<http://example.com/?page=1&tags=a,b>; rel="prev", <http://example.com/?page=2&cursor=a;b>; rel="next", <http://example.com/?page=10>; rel="last"';
						}

						return undefined;
					},
				},
				json: async () => [1],
			};
		}

		return {
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get() {
					return undefined;
				},
			},
			json: async () => [2],
		};
	};

	const items = await paginate.all('http://example.com/');
	t.deepEqual(items, [1, 2]);
});

test.serial('paginate - handles delimiters inside quoted Link header parameters across multiple entries', async t => {
	let callCount = 0;
	globalThis.fetch = async url => {
		callCount++;

		if (callCount === 1) {
			return {
				ok: true,
				status: 200,
				url: url.toString(),
				headers: {
					get(name) {
						if (name === 'Link') {
							return '<http://example.com/?page=1>; rel="prev"; title="Previous, page; still previous", <http://example.com/?page=2>; rel="next"; title="Next, page; still next"';
						}

						return undefined;
					},
				},
				json: async () => [1],
			};
		}

		return {
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get() {
					return undefined;
				},
			},
			json: async () => [2],
		};
	};

	const items = await paginate.all('http://example.com/');
	t.deepEqual(items, [1, 2]);
});

// New tests for edge cases and validations

test.serial('paginate - handles trailing semicolons in Link header', async t => {
	let callCount = 0;
	globalThis.fetch = async url => {
		callCount++;

		if (callCount === 1) {
			return {
				ok: true,
				status: 200,
				url: url.toString(),
				headers: {
					get(name) {
						if (name === 'Link') {
							return '<http://example.com/?page=2>; rel="next"; '; // Trailing semicolon
						}

						return undefined;
					},
				},
				json: async () => [1],
			};
		}

		return {
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get() {
					return undefined;
				},
			},
			json: async () => [2],
		};
	};

	const items = await paginate.all('http://example.com/');
	t.deepEqual(items, [1, 2]);
});

test.serial('paginate - normalizes double-quoted parameter values', async t => {
	let callCount = 0;
	globalThis.fetch = async url => {
		callCount++;

		if (callCount === 1) {
			return {
				ok: true,
				status: 200,
				url: url.toString(),
				headers: {
					get(name) {
						if (name === 'Link') {
							return '<http://example.com/?page=2>; rel="next"; title="Next Page"';
						}

						return undefined;
					},
				},
				json: async () => [1],
			};
		}

		return {
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get() {
					return undefined;
				},
			},
			json: async () => [2],
		};
	};

	const items = await paginate.all('http://example.com/');
	t.deepEqual(items, [1, 2]);
});

test.serial('paginate - rejects single-quoted Link parameter values with delimiters', async t => {
	globalThis.fetch = async url => ({
		ok: true,
		status: 200,
		url: url.toString(),
		headers: {
			get(name) {
				if (name === 'Link') {
					return '<http://example.com/?page=2>; rel="next"; title=\'Next, page\'';
				}

				return undefined;
			},
		},
		json: async () => [1],
	});

	await t.throwsAsync(
		async () => paginate.all('http://example.com/'),
		{message: /Invalid Link header format/},
	);
});

test('parseLinkHeader - unescapes quoted-pair characters in parameter values', t => {
	const [link] = parseLinkHeader('<http://example.com/?page=2>; rel="next"; title="Next \\"page\\""');

	t.is(link.parameters.title, 'Next "page"');
});

test('parseLinkHeader - unescapes escaped delimiters and backslashes in quoted parameter values', t => {
	const [link] = parseLinkHeader('<http://example.com/?page=2>; rel="next"; title="Next \\\\, page\\; still next"');

	t.is(link.parameters.title, 'Next \\, page; still next');
});

test('parseLinkHeader - keeps the first duplicate parameter value', t => {
	const [link] = parseLinkHeader('<http://example.com/?page=2>; rel="next"; rel="prev"; title="Next"');

	t.deepEqual(link.parameters, {
		rel: 'next',
		title: 'Next',
	});
});

test('parseLinkHeader - keeps valueless extension parameters as empty strings', t => {
	const [link] = parseLinkHeader('<http://example.com/?page=2>; rel="next"; foo; bar=');

	t.deepEqual(link.parameters, {
		rel: 'next',
		foo: '',
		bar: '',
	});
});

test.serial('paginate - validates stackAllItems is a boolean', async t => {
	globalThis.fetch = async () => ({
		ok: true,
		status: 200,
		url: 'http://example.com/',
		headers: {get() {}},
		json: async () => [1],
	});

	await t.throwsAsync(
		async () => paginate.all('http://example.com/', {
			pagination: {
				stackAllItems: 'true', // String instead of boolean
			},
		}),
		{message: /stackAllItems must be a boolean/},
	);
});

test.serial('paginate - validates countLimit is non-negative', async t => {
	globalThis.fetch = async () => ({
		ok: true,
		status: 200,
		url: 'http://example.com/',
		headers: {get() {}},
		json: async () => [1],
	});

	await t.throwsAsync(
		async () => paginate.all('http://example.com/', {
			pagination: {
				countLimit: -1,
			},
		}),
		{message: /countLimit must be non-negative/},
	);
});

test.serial('paginate - validates requestLimit is non-negative', async t => {
	globalThis.fetch = async () => ({
		ok: true,
		status: 200,
		url: 'http://example.com/',
		headers: {get() {}},
		json: async () => [1],
	});

	await t.throwsAsync(
		async () => paginate.all('http://example.com/', {
			pagination: {
				requestLimit: -1,
			},
		}),
		{message: /requestLimit must be non-negative/},
	);
});

test.serial('paginate - validates backoff is non-negative', async t => {
	globalThis.fetch = async () => ({
		ok: true,
		status: 200,
		url: 'http://example.com/',
		headers: {get() {}},
		json: async () => [1],
	});

	await t.throwsAsync(
		async () => paginate.all('http://example.com/', {
			pagination: {
				backoff: -1,
			},
		}),
		{message: /backoff must be non-negative/},
	);
});

test.serial('paginate - countLimit of 0 yields no items', async t => {
	globalThis.fetch = createPaginatedMockFetch([[1, 2], [3, 4]]);

	const items = await paginate.all('http://example.com/?page=1', {
		pagination: {
			countLimit: 0,
		},
	});

	t.deepEqual(items, []);
});

test.serial('paginate - requestLimit of 0 makes no requests', async t => {
	let callCount = 0;
	globalThis.fetch = async () => {
		callCount++;
		return {
			ok: true,
			status: 200,
			url: 'http://example.com/',
			headers: {get() {}},
			json: async () => [1],
		};
	};

	const items = await paginate.all('http://example.com/', {
		pagination: {
			requestLimit: 0,
		},
	});

	t.deepEqual(items, []);
	t.is(callCount, 0);
});

test.serial('paginate - requestLimit of 1 makes exactly 1 request', async t => {
	let callCount = 0;
	globalThis.fetch = async url => {
		callCount++;
		const pageParameter = new URL(url).searchParams.get('page');
		const page = pageParameter ? Number.parseInt(pageParameter, 10) : 1;

		return {
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get(name) {
					if (name === 'Link' && page === 1) {
						return '<http://example.com/?page=2>; rel="next"';
					}

					return undefined;
				},
			},
			json: async () => [page * 10, (page * 10) + 1],
		};
	};

	const items = await paginate.all('http://example.com/?page=1', {
		pagination: {
			requestLimit: 1,
		},
	});

	t.deepEqual(items, [10, 11]);
	t.is(callCount, 1);
});

test.serial('paginate - throws for countLimit NaN', async t => {
	await t.throwsAsync(
		async () => paginate.all('http://example.com/', {
			pagination: {
				countLimit: Number.NaN,
			},
		}),
		{message: /countLimit must not be NaN/},
	);
});

test.serial('paginate - throws for requestLimit NaN', async t => {
	await t.throwsAsync(
		async () => paginate.all('http://example.com/', {
			pagination: {
				requestLimit: Number.NaN,
			},
		}),
		{message: /requestLimit must not be NaN/},
	);
});

test.serial('paginate - throws for backoff NaN', async t => {
	await t.throwsAsync(
		async () => paginate.all('http://example.com/', {
			pagination: {
				backoff: Number.NaN,
			},
		}),
		{message: /backoff must not be NaN/},
	);
});

test.serial('paginate - throws for backoff Infinity', async t => {
	await t.throwsAsync(
		async () => paginate.all('http://example.com/', {
			pagination: {
				backoff: Number.POSITIVE_INFINITY,
			},
		}),
		{message: /backoff must be finite/},
	);
});

test.serial('paginate - passes currentUrl to the paginate callback', async t => {
	const seenUrls = [];

	const items = await paginate.all('http://example.com/?page=1', {
		fetchFunction: async url => ({
			ok: true,
			status: 200,
			url: url.toString(),
			headers: {
				get() {
					return undefined;
				},
			},
			json: async () => [1],
		}),
		pagination: {
			requestLimit: 3,
			paginate({currentUrl}) {
				seenUrls.push(currentUrl instanceof URL ? currentUrl.href : currentUrl);

				if (seenUrls.length < 3) {
					return {url: new URL(`http://example.com/?page=${seenUrls.length + 1}`)};
				}

				return false;
			},
		},
	});

	t.deepEqual(items, [1, 1, 1]);
	t.deepEqual(seenUrls, [
		'http://example.com/?page=1',
		'http://example.com/?page=2',
		'http://example.com/?page=3',
	]);
});

test.serial('paginate - passes the response url to the paginate callback after redirects', async t => {
	const seenUrls = [];

	const items = await paginate.all('https://api.example.com/?page=1', {
		async fetchFunction(url) {
			const requestedUrl = url.toString();
			const pageParameter = new URL(requestedUrl).searchParams.get('page');
			const page = pageParameter ? Number.parseInt(pageParameter, 10) : 1;
			const responseUrl = page === 1 ? 'https://cdn.example.net/?page=1' : requestedUrl;

			return {
				ok: true,
				status: 200,
				url: responseUrl,
				headers: {
					get() {
						return undefined;
					},
				},
				json: async () => [page],
			};
		},
		pagination: {
			requestLimit: 2,
			paginate({currentUrl}) {
				seenUrls.push(currentUrl.href);

				if (seenUrls.length === 1) {
					return {url: new URL('https://cdn.example.net/?page=2')};
				}

				return false;
			},
		},
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenUrls, [
		'https://cdn.example.net/?page=1',
		'https://cdn.example.net/?page=2',
	]);
});

test.serial('paginate - drops inherited Authorization after a cross-origin redirect before the next page', async t => {
	const {seenRequests, fetchFunction} = createRedirectedRecordedRequestFetch({
		nextLink: redirectedNextPageLink,
	});

	const items = await paginate.all('https://api.example.com/?page=1', {
		headers: {
			authorization: 'Bearer secret',
		},
		fetchFunction,
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/?page=1',
			authorization: 'Bearer secret',
		},
		{
			url: 'https://cdn.example.net/?page=2',
			authorization: null,
		},
	]);
});

test.serial('paginate - drops inherited Authorization after a cross-origin redirect before the next page for Request input', async t => {
	const {seenRequests, fetchFunction} = createRedirectedRecordedRequestFetch({
		nextLink: redirectedNextPageLink,
		includeBody: true,
	});

	const items = await paginate.all(new Request('https://api.example.com/?page=1', {
		method: 'POST',
		headers: {
			authorization: 'Bearer secret',
		},
		body: 'page request body',
	}), {
		fetchFunction,
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/?page=1',
			authorization: 'Bearer secret',
			body: 'page request body',
		},
		{
			url: 'https://cdn.example.net/?page=2',
			authorization: null,
			body: undefined,
		},
	]);
});

test.serial('paginate - keeps inherited Request bodies cleared across multiple cross-origin pages after a redirect', async t => {
	const seenRequests = [];

	const items = await paginate.all(new Request('https://api.example.com/?page=1', {
		method: 'POST',
		headers: {
			authorization: 'Bearer secret',
		},
		body: 'page request body',
	}), {
		async fetchFunction(input, options) {
			const request = input instanceof Request ? input : new Request(input, options);
			const page = seenRequests.length + 1;

			seenRequests.push({
				url: request.url,
				authorization: request.headers.get('authorization'),
				body: request.body ? await request.text() : undefined,
			});

			return {
				ok: true,
				status: 200,
				url: page === 1 ? 'https://cdn.example.net/?page=1' : request.url,
				headers: {
					get() {
						return undefined;
					},
				},
				json: async () => [page],
			};
		},
		pagination: {
			requestLimit: 3,
			paginate({currentUrl}) {
				if (currentUrl.href === 'https://cdn.example.net/?page=1') {
					return {url: new URL('https://cdn.example.net/?page=2')};
				}

				if (currentUrl.href === 'https://cdn.example.net/?page=2') {
					return {url: new URL('https://cdn.example.net/?page=3')};
				}

				return false;
			},
		},
	});

	t.deepEqual(items, [1, 2, 3]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/?page=1',
			authorization: 'Bearer secret',
			body: 'page request body',
		},
		{
			url: 'https://cdn.example.net/?page=2',
			authorization: null,
			body: undefined,
		},
		{
			url: 'https://cdn.example.net/?page=3',
			authorization: null,
			body: undefined,
		},
	]);
});

test.serial('paginate - preserves explicit Authorization overrides after a cross-origin redirect', async t => {
	const {seenRequests, fetchFunction} = createRedirectedRecordedRequestFetch();

	const items = await paginate.all('https://api.example.com/?page=1', {
		headers: {
			authorization: 'Bearer secret',
		},
		fetchFunction,
		pagination: createRedirectedPaginationOptions({
			url: new URL('https://cdn.example.net/?page=2'),
			headers: {
				authorization: 'Bearer replacement',
			},
		}),
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/?page=1',
			authorization: 'Bearer secret',
		},
		{
			url: 'https://cdn.example.net/?page=2',
			authorization: 'Bearer replacement',
		},
	]);
});

test.serial('paginate - preserves explicit Cookie and Proxy-Authorization overrides after a cross-origin redirect', async t => {
	const {seenRequests, fetchFunction} = createRedirectedRecordedRequestFetch({
		recordHeaders: redirectedCredentialRecordHeaders,
	});

	const items = await paginate.all('https://api.example.com/?page=1', {
		headers: redirectedCredentialHeaders,
		fetchFunction,
		pagination: createRedirectedPaginationOptions({
			url: new URL('https://cdn.example.net/?page=2'),
			headers: {
				cookie: 'session=override',
				'proxy-authorization': 'Basic cmVwbGFjZW1lbnQ=',
			},
		}),
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/?page=1',
			authorization: 'Bearer secret',
			cookie: 'session=abc123',
			proxyAuthorization: 'Basic c2VjcmV0',
		},
		{
			url: 'https://cdn.example.net/?page=2',
			authorization: null,
			cookie: 'session=override',
			proxyAuthorization: 'Basic cmVwbGFjZW1lbnQ=',
		},
	]);
});

test.serial('paginate - preserves explicit body overrides after a cross-origin redirect', async t => {
	const {seenRequests, fetchFunction} = createRedirectedRecordedRequestFetch({
		includeBody: true,
	});

	const items = await paginate.all(new Request('https://api.example.com/?page=1', {
		method: 'POST',
		headers: {
			authorization: 'Bearer secret',
			'content-type': 'text/plain',
		},
		body: 'page request body',
	}), {
		fetchFunction,
		pagination: createRedirectedPaginationOptions({
			url: new URL('https://cdn.example.net/?page=2'),
			method: 'POST',
			headers: {
				'content-type': 'application/x-www-form-urlencoded',
			},
			body: 'cursor=2',
		}),
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/?page=1',
			authorization: 'Bearer secret',
			body: 'page request body',
		},
		{
			url: 'https://cdn.example.net/?page=2',
			authorization: null,
			body: 'cursor=2',
		},
	]);
});

test.serial('paginate - drops inherited Cookie and Proxy-Authorization after a cross-origin redirect before the next page', async t => {
	const {items, seenRequests} = await paginateWithRedirectedCredentialHeaders('<https://cdn.example.net/?page=2>; rel="next"');

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/?page=1',
			authorization: 'Bearer secret',
			cookie: 'session=abc123',
			proxyAuthorization: 'Basic c2VjcmV0',
		},
		{
			url: 'https://cdn.example.net/?page=2',
			authorization: null,
			cookie: null,
			proxyAuthorization: null,
		},
	]);
});

test.serial('paginate - keeps inherited Cookie and Proxy-Authorization cleared when pagination returns to the original origin after a redirect', async t => {
	const {items, seenRequests} = await paginateWithRedirectedCredentialHeaders('<https://api.example.com/?page=2>; rel="next"');

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/?page=1',
			authorization: 'Bearer secret',
			cookie: 'session=abc123',
			proxyAuthorization: 'Basic c2VjcmV0',
		},
		{
			url: 'https://api.example.com/?page=2',
			authorization: null,
			cookie: null,
			proxyAuthorization: null,
		},
	]);
});

test.serial('paginate - keeps inherited Authorization cleared when pagination returns to the original origin after a redirect', async t => {
	const {seenRequests, fetchFunction} = createRedirectedRecordedRequestFetch({
		nextLink: '<https://api.example.com/?page=2>; rel="next"',
	});

	const items = await paginate.all('https://api.example.com/?page=1', {
		headers: {
			authorization: 'Bearer secret',
		},
		fetchFunction,
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/?page=1',
			authorization: 'Bearer secret',
		},
		{
			url: 'https://api.example.com/?page=2',
			authorization: null,
		},
	]);
});

test.serial('paginate - preserves inherited sensitive state after a redirected same-origin response', async t => {
	const seenRequests = [];

	const items = await paginate.all(new Request('https://api.example.com/?page=1', {
		method: 'POST',
		headers: {
			...redirectedCredentialHeaders,
			'content-type': 'text/plain',
		},
		body: 'page request body',
	}), {
		async fetchFunction(input, options) {
			const request = input instanceof Request ? input : new Request(input, options);
			const page = seenRequests.length + 1;

			seenRequests.push(await createRequestRecord(request, {
				includeBody: true,
				recordHeaders: redirectedCredentialRecordHeaders,
			}));

			return {
				ok: true,
				status: 200,
				url: request.url,
				redirected: page === 1,
				headers: {
					get(name) {
						if (name === 'Link' && page === 1) {
							return '<https://api.example.com/?page=2>; rel="next"';
						}

						return undefined;
					},
				},
				json: async () => [page],
			};
		},
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/?page=1',
			authorization: 'Bearer secret',
			cookie: 'session=abc123',
			proxyAuthorization: 'Basic c2VjcmV0',
			body: 'page request body',
		},
		{
			url: 'https://api.example.com/?page=2',
			authorization: 'Bearer secret',
			cookie: 'session=abc123',
			proxyAuthorization: 'Basic c2VjcmV0',
			body: 'page request body',
		},
	]);
});

test.serial('paginate - drops inherited content headers after a redirected bodyless request', async t => {
	const seenRequests = [];

	const items = await paginate.all('https://api.example.com/?page=1', {
		method: 'POST',
		headers: {
			authorization: 'Bearer secret',
			'content-type': 'application/json',
			'content-language': 'en',
		},
		async fetchFunction(input, options) {
			const request = input instanceof Request ? input : new Request(input, options);
			const page = seenRequests.length + 1;

			seenRequests.push({
				url: request.url,
				authorization: request.headers.get('authorization'),
				contentType: request.headers.get('content-type'),
				contentLanguage: request.headers.get('content-language'),
			});

			return {
				ok: true,
				status: 200,
				url: page === 1 ? 'https://cdn.example.net/?page=1' : request.url,
				redirected: page === 1,
				headers: {
					get(name) {
						if (name === 'Link' && page === 1) {
							return redirectedNextPageLink;
						}

						return undefined;
					},
				},
				json: async () => [page],
			};
		},
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests, [
		{
			url: 'https://api.example.com/?page=1',
			authorization: 'Bearer secret',
			contentType: 'application/json',
			contentLanguage: 'en',
		},
		{
			url: 'https://cdn.example.net/?page=2',
			authorization: null,
			contentType: null,
			contentLanguage: null,
		},
	]);
});

test.serial('paginate - resolves relative Link headers against the response url after redirects', async t => {
	const {seenRequests, fetchFunction} = createRedirectedRecordedRequestFetch({
		redirectUrl: 'https://cdn.example.net/path/?page=1',
		nextLink: '</path/?page=2>; rel="next"',
	});

	const items = await paginate.all('https://api.example.com/?page=1', {
		fetchFunction,
	});

	t.deepEqual(items, [1, 2]);
	t.deepEqual(seenRequests.map(request => request.url), [
		'https://api.example.com/?page=1',
		'https://cdn.example.net/path/?page=2',
	]);
});

test('parseLinkHeader - throws for invalid format', t => {
	t.throws(
		() => parseLinkHeader('not a valid link'),
		{message: /Invalid Link header format/},
	);
});

test('parseLinkHeader - throws for unterminated quoted rel value', t => {
	t.throws(
		() => parseLinkHeader('<http://example.com/?page=2>; rel="next'),
		{message: /Invalid Link header format/},
	);
});

test('parseLinkHeader - throws for unterminated quoted parameter before the next entry', t => {
	t.throws(
		() => parseLinkHeader('<http://example.com/?page=2>; title="unterminated, <http://example.com/?page=3>; rel="next"'),
		{message: /Invalid Link header format/},
	);
});

test('parseLinkHeader - throws for trailing unterminated quoted parameter', t => {
	t.throws(
		() => parseLinkHeader('<http://example.com/?page=2>; rel="next"; title="unterminated'),
		{message: /Invalid Link header format/},
	);
});

test('parseLinkHeader - throws for dangling escape in quoted parameter', t => {
	t.throws(
		() => parseLinkHeader('<http://example.com/?page=2>; rel="next"; title="unterminated\\'),
		{message: /Invalid Link header format/},
	);
});

test('parseLinkHeader - throws for empty parameter name', t => {
	t.throws(
		() => parseLinkHeader('<http://example.com/?page=2>; ="next"'),
		{message: /Invalid Link header format/},
	);
});

test('parseLinkHeader - throws for empty parameter name after a valid parameter', t => {
	t.throws(
		() => parseLinkHeader('<http://example.com/?page=2>; rel=next; =foo'),
		{message: /Invalid Link header format/},
	);
});

test('parseLinkHeader - throws for whitespace inside a parameter name', t => {
	t.throws(
		() => parseLinkHeader('<http://example.com/?page=2>; re l=next'),
		{message: /Invalid Link header format/},
	);
});

test('parseLinkHeader - throws for quoted parameter names', t => {
	t.throws(
		() => parseLinkHeader('<http://example.com/?page=2>; "rel"=next'),
		{message: /Invalid Link header format/},
	);
});

test('parseLinkHeader - throws for invalid token characters in an unquoted value', t => {
	t.throws(
		() => parseLinkHeader('<http://example.com/?page=2>; rel=@next'),
		{message: /Invalid Link header format/},
	);
});

test('parseLinkHeader - throws for invalid delimiters in an unquoted value', t => {
	t.throws(
		() => parseLinkHeader('<http://example.com/?page=2>; rel=n(ext'),
		{message: /Invalid Link header format/},
	);
});

test('parseLinkHeader - throws for unterminated URL angle bracket', t => {
	t.throws(
		() => parseLinkHeader('<http://example.com/?page=2'),
		{message: /Invalid Link header format/},
	);
});

test('parseLinkHeader - parses link with no parameters', t => {
	const links = parseLinkHeader('<http://example.com/>');
	t.deepEqual(links, [{url: 'http://example.com/', parameters: {}}]);
});

test('parseLinkHeader - handles empty URL', t => {
	const links = parseLinkHeader('<>; rel="next"');
	t.deepEqual(links, [{url: '', parameters: {rel: 'next'}}]);
});

test.serial('paginate - accepts URL instance as input', async t => {
	const mockFetch = async url => ({
		ok: true,
		status: 200,
		url: url.toString(),
		headers: {
			get() {
				return undefined;
			},
		},
		json: async () => [1, 2],
	});

	const items = await paginate.all(new URL('http://example.com/?page=1'), {fetchFunction: mockFetch});
	t.deepEqual(items, [1, 2]);
});

test.serial('paginate - throws if paginate returns null', async t => {
	globalThis.fetch = async url => ({
		ok: true,
		status: 200,
		url: url.toString(),
		headers: {
			get() {
				return undefined;
			},
		},
		json: async () => [1],
	});

	await t.throwsAsync(
		async () => paginate.all('http://example.com/', {
			pagination: {
				paginate: () => null,
			},
		}),
		{message: /paginate must return an object or false/},
	);
});

test.serial('paginate - throws if paginate returns undefined', async t => {
	globalThis.fetch = async url => ({
		ok: true,
		status: 200,
		url: url.toString(),
		headers: {
			get() {
				return undefined;
			},
		},
		json: async () => [1],
	});

	await t.throwsAsync(
		async () => paginate.all('http://example.com/', {
			pagination: {
				paginate() {},
			},
		}),
		{message: /paginate must return an object or false/},
	);
});
