import test from 'ava';
import {
	pipeline,
	withBaseUrl,
	withCache,
	withHeaders,
	withSearchParameters,
} from '../source/index.js';
import {blockedDefaultHeaderNamesSymbol, timeoutDurationSymbol} from '../source/utilities.js';

const createMockFetch = (status = 200) => {
	let callCount = 0;

	const mockFetch = async () => {
		callCount++;
		return new Response(JSON.stringify({callCount}), {
			status,
			headers: {'content-type': 'application/json'},
		});
	};

	Object.defineProperty(mockFetch, 'callCount', {get: () => callCount});
	return mockFetch;
};

test('returns cached response for repeated GET requests', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	const response1 = await cachedFetch('https://example.com/api');
	const data1 = await response1.json();

	const response2 = await cachedFetch('https://example.com/api');
	const data2 = await response2.json();

	t.is(mockFetch.callCount, 1);
	t.deepEqual(data1, {callCount: 1});
	t.deepEqual(data2, {callCount: 1});
});

test.serial('cache expires after TTL', async t => {
	const mockFetch = createMockFetch();
	const originalPerformanceNow = performance.now;
	let currentTime = 1000;
	performance.now = () => currentTime;

	try {
		const cachedFetch = withCache(mockFetch, {ttl: 5000});

		await cachedFetch('https://example.com/api');
		t.is(mockFetch.callCount, 1);

		// Still cached
		currentTime = 5999;
		await cachedFetch('https://example.com/api');
		t.is(mockFetch.callCount, 1);

		// Exactly at expiry boundary - should be expired
		currentTime = 6000;
		await cachedFetch('https://example.com/api');
		t.is(mockFetch.callCount, 2);
	} finally {
		performance.now = originalPerformanceNow;
	}
});

test('different URLs are cached independently', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	await cachedFetch('https://example.com/a');
	await cachedFetch('https://example.com/b');
	await cachedFetch('https://example.com/a');
	await cachedFetch('https://example.com/b');

	t.is(mockFetch.callCount, 2);
});

test('non-GET requests pass through', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	await cachedFetch('https://example.com/api', {method: 'POST'});
	await cachedFetch('https://example.com/api', {method: 'POST'});

	t.is(mockFetch.callCount, 2);
});

test('non-GET requests invalidate cache for that URL', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	// Populate cache
	await cachedFetch('https://example.com/api');
	t.is(mockFetch.callCount, 1);

	// POST invalidates cache
	await cachedFetch('https://example.com/api', {method: 'POST'});
	t.is(mockFetch.callCount, 2);

	// GET must re-fetch
	await cachedFetch('https://example.com/api');
	t.is(mockFetch.callCount, 3);
});

test('in-flight mutating requests immediately invalidate cached GET responses', async t => {
	let resolveMutation;
	const mutationPromise = new Promise(resolve => {
		resolveMutation = resolve;
	});
	let getCallCount = 0;

	const mockFetch = async (urlOrRequest, options) => {
		const method = (options?.method ?? (urlOrRequest instanceof Request ? urlOrRequest.method : 'GET')).toUpperCase();

		if (method === 'GET') {
			getCallCount++;
			return new Response(`get-${getCallCount}`);
		}

		await mutationPromise;
		return new Response('mutated');
	};

	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	const initialResponse = await cachedFetch('https://example.com/api');
	t.is(await initialResponse.text(), 'get-1');

	const pendingMutation = cachedFetch('https://example.com/api', {method: 'POST'});
	await Promise.resolve();

	const overlappingGetResponse = await cachedFetch('https://example.com/api');
	t.is(await overlappingGetResponse.text(), 'get-2');

	resolveMutation();
	const mutationResponse = await pendingMutation;
	t.is(await mutationResponse.text(), 'mutated');
	t.is(getCallCount, 2);
});

test('aborted mutating requests do not evict cached GET responses', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	await cachedFetch('https://example.com/api');
	t.is(mockFetch.callCount, 1);

	const abortController = new AbortController();
	abortController.abort();

	await t.throwsAsync(() => cachedFetch('https://example.com/api', {method: 'POST', signal: abortController.signal}), {
		name: 'AbortError',
	});
	t.is(mockFetch.callCount, 1);

	const cachedResponse = await cachedFetch('https://example.com/api');
	t.deepEqual(await cachedResponse.json(), {callCount: 1});
	t.is(mockFetch.callCount, 1);
});

test('aborted mutating Request objects do not evict cached GET responses', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	await cachedFetch('https://example.com/api');
	t.is(mockFetch.callCount, 1);

	const abortController = new AbortController();
	abortController.abort();

	await t.throwsAsync(() => cachedFetch(new Request('https://example.com/api', {method: 'POST', signal: abortController.signal})), {
		name: 'AbortError',
	});
	t.is(mockFetch.callCount, 1);

	const cachedResponse = await cachedFetch('https://example.com/api');
	t.deepEqual(await cachedResponse.json(), {callCount: 1});
	t.is(mockFetch.callCount, 1);
});

test('does not cache non-ok responses', async t => {
	const mockFetch = createMockFetch(404);
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	const response1 = await cachedFetch('https://example.com/api');
	t.is(response1.status, 404);

	const response2 = await cachedFetch('https://example.com/api');
	t.is(response2.status, 404);

	t.is(mockFetch.callCount, 2);
});

test('does not cache 500 responses', async t => {
	const mockFetch = createMockFetch(500);
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	await cachedFetch('https://example.com/api');
	await cachedFetch('https://example.com/api');

	t.is(mockFetch.callCount, 2);
});

test('each cache hit returns independent clone', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	const response1 = await cachedFetch('https://example.com/api');
	const response2 = await cachedFetch('https://example.com/api');

	// Both bodies should be independently consumable
	const data1 = await response1.json();
	const data2 = await response2.json();

	t.deepEqual(data1, {callCount: 1});
	t.deepEqual(data2, {callCount: 1});
});

test('works with Request objects', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	const request = new Request('https://example.com/api');
	await cachedFetch(request);
	await cachedFetch(new Request('https://example.com/api'));

	t.is(mockFetch.callCount, 1);
});

test('works with URL objects', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	const url = new URL('https://example.com/api');
	await cachedFetch(url);
	await cachedFetch(new URL('https://example.com/api'));

	t.is(mockFetch.callCount, 1);
});

test('ranged GET requests are not cached', async t => {
	const calls = [];
	const mockFetch = async (urlOrRequest, options) => {
		calls.push({urlOrRequest, options});
		const headers = new Headers(options?.headers ?? (urlOrRequest instanceof Request ? urlOrRequest.headers : undefined));
		const isRangedRequest = headers.has('range');
		return new Response(isRangedRequest ? 'partial' : 'full', {status: isRangedRequest ? 206 : 200});
	};

	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	const rangedResponse = await cachedFetch('https://example.com/api', {headers: {Range: 'bytes=0-3'}});
	t.is(await rangedResponse.text(), 'partial');

	const fullResponse = await cachedFetch('https://example.com/api');
	t.is(await fullResponse.text(), 'full');

	t.is(calls.length, 2);
});

test('ranged GET requests bypass an existing cached full response', async t => {
	const calls = [];
	const mockFetch = async (urlOrRequest, options) => {
		calls.push({urlOrRequest, options});
		const headers = new Headers(options?.headers ?? (urlOrRequest instanceof Request ? urlOrRequest.headers : undefined));
		const isRangedRequest = headers.has('range');
		return new Response(isRangedRequest ? 'partial' : 'full', {status: isRangedRequest ? 206 : 200});
	};

	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	const fullResponse = await cachedFetch('https://example.com/api');
	t.is(await fullResponse.text(), 'full');

	const rangedResponse = await cachedFetch(new Request('https://example.com/api', {headers: {Range: 'bytes=0-3'}}));
	t.is(await rangedResponse.text(), 'partial');

	const cachedAgainResponse = await cachedFetch('https://example.com/api');
	t.is(await cachedAgainResponse.text(), 'full');

	t.is(calls.length, 2);
});

test('ranged GET requests added by an inner wrapper are not cached', async t => {
	let callCount = 0;
	const mockFetch = async (urlOrRequest, options) => {
		callCount++;
		const headers = new Headers(options?.headers ?? (urlOrRequest instanceof Request ? urlOrRequest.headers : undefined));
		const isRangedRequest = headers.has('range');
		return new Response(isRangedRequest ? `partial-${callCount}` : `full-${callCount}`, {status: isRangedRequest ? 206 : 200});
	};

	const cachedFetch = pipeline(
		mockFetch,
		fetchFunction => withHeaders(fetchFunction, {Range: 'bytes=0-3'}),
		fetchFunction => withCache(fetchFunction, {ttl: 60_000}),
	);

	const firstResponse = await cachedFetch('https://example.com/api');
	t.is(await firstResponse.text(), 'partial-1');

	const secondResponse = await cachedFetch('https://example.com/api');
	t.is(await secondResponse.text(), 'partial-2');

	t.is(callCount, 2);
});

test('ranged GET requests added by an inner wrapper are not cached when the server returns 200', async t => {
	let callCount = 0;
	const mockFetch = async () => {
		callCount++;
		return new Response(`full-${callCount}`, {status: 200});
	};

	const cachedFetch = pipeline(
		mockFetch,
		fetchFunction => withHeaders(fetchFunction, {Range: 'bytes=0-3'}),
		fetchFunction => withCache(fetchFunction, {ttl: 60_000}),
	);

	const firstResponse = await cachedFetch('https://example.com/api');
	t.is(await firstResponse.text(), 'full-1');

	const secondResponse = await cachedFetch('https://example.com/api');
	t.is(await secondResponse.text(), 'full-2');

	t.is(callCount, 2);
});

test('ranged GET requests added by nested inner wrappers are not cached when the server returns 200', async t => {
	let callCount = 0;
	const mockFetch = async () => {
		callCount++;
		return new Response(`full-${callCount}`, {status: 200});
	};

	const cachedFetch = pipeline(
		mockFetch,
		fetchFunction => withHeaders(fetchFunction, {Range: 'bytes=0-3'}),
		fetchFunction => withHeaders(fetchFunction, {'x-test': '1'}),
		fetchFunction => withCache(fetchFunction, {ttl: 60_000}),
	);

	const firstResponse = await cachedFetch('https://example.com/api');
	t.is(await firstResponse.text(), 'full-1');

	const secondResponse = await cachedFetch('https://example.com/api');
	t.is(await secondResponse.text(), 'full-2');

	t.is(callCount, 2);
});

test('ranged GET requests added by an inner wrapper bypass an existing cached full response', async t => {
	let callCount = 0;
	const mockFetch = async () => {
		callCount++;
		return new Response(`full-${callCount}`, {status: 200});
	};

	const cachedFetch = pipeline(
		mockFetch,
		fetchFunction => withHeaders(fetchFunction, {Range: 'bytes=0-3'}),
		fetchFunction => withCache(fetchFunction, {ttl: 60_000}),
	);

	const fullResponse = await cachedFetch('https://example.com/api', {
		[blockedDefaultHeaderNamesSymbol]: ['range'],
	});
	t.is(await fullResponse.text(), 'full-1');

	const rangedResponse = await cachedFetch('https://example.com/api');
	t.is(await rangedResponse.text(), 'full-2');

	t.is(callCount, 2);
});

test('ranged GET requests added by an inner wrapper can be blocked per call and then cached', async t => {
	let callCount = 0;
	const mockFetch = async () => {
		callCount++;
		return new Response(`full-${callCount}`, {status: 200});
	};

	const cachedFetch = pipeline(
		mockFetch,
		fetchFunction => withHeaders(fetchFunction, {Range: 'bytes=0-3'}),
		fetchFunction => withCache(fetchFunction, {ttl: 60_000}),
	);

	const firstResponse = await cachedFetch('https://example.com/api', {
		[blockedDefaultHeaderNamesSymbol]: ['range'],
	});
	t.is(await firstResponse.text(), 'full-1');

	const secondResponse = await cachedFetch('https://example.com/api', {
		[blockedDefaultHeaderNamesSymbol]: ['range'],
	});
	t.is(await secondResponse.text(), 'full-1');

	t.is(callCount, 1);
});

test('blocking an inner Range default for one call does not stop later effective range requests from bypassing cache', async t => {
	let callCount = 0;
	const mockFetch = async () => {
		callCount++;
		return new Response(`full-${callCount}`, {status: 200});
	};

	const cachedFetch = pipeline(
		mockFetch,
		fetchFunction => withHeaders(fetchFunction, {Range: 'bytes=0-3'}),
		fetchFunction => withCache(fetchFunction, {ttl: 60_000}),
	);

	const fullResponse = await cachedFetch('https://example.com/api', {
		[blockedDefaultHeaderNamesSymbol]: ['range'],
	});
	t.is(await fullResponse.text(), 'full-1');

	const cachedResponse = await cachedFetch('https://example.com/api', {
		[blockedDefaultHeaderNamesSymbol]: ['range'],
	});
	t.is(await cachedResponse.text(), 'full-1');

	const rangedResponse = await cachedFetch('https://example.com/api');
	t.is(await rangedResponse.text(), 'full-2');

	t.is(callCount, 2);
});

test('explicit per-call Range headers still bypass cache when an inner Range default is blocked', async t => {
	let callCount = 0;
	const observedRanges = [];
	const mockFetch = async (_urlOrRequest, options) => {
		callCount++;
		observedRanges.push(new Headers(options?.headers).get('range'));
		return new Response(`partial-${callCount}`, {status: 200});
	};

	const cachedFetch = pipeline(
		mockFetch,
		fetchFunction => withHeaders(fetchFunction, {Range: 'bytes=0-3'}),
		fetchFunction => withCache(fetchFunction, {ttl: 60_000}),
	);

	const firstResponse = await cachedFetch('https://example.com/api', {
		headers: {Range: 'bytes=4-7'},
		[blockedDefaultHeaderNamesSymbol]: ['range'],
	});
	t.is(await firstResponse.text(), 'partial-1');

	const secondResponse = await cachedFetch('https://example.com/api', {
		headers: {Range: 'bytes=4-7'},
		[blockedDefaultHeaderNamesSymbol]: ['range'],
	});
	t.is(await secondResponse.text(), 'partial-2');

	t.is(callCount, 2);
	t.deepEqual(observedRanges, ['bytes=4-7', 'bytes=4-7']);
});

test('explicit Request Range headers still bypass cache when an inner Range default is blocked', async t => {
	let callCount = 0;
	const observedRanges = [];
	const mockFetch = async (urlOrRequest, options) => {
		callCount++;
		observedRanges.push(new Headers(options?.headers ?? urlOrRequest.headers).get('range'));
		return new Response(`partial-${callCount}`, {status: 200});
	};

	const cachedFetch = pipeline(
		mockFetch,
		fetchFunction => withHeaders(fetchFunction, {Range: 'bytes=0-3'}),
		fetchFunction => withCache(fetchFunction, {ttl: 60_000}),
	);

	const request = new Request('https://example.com/api', {
		headers: {Range: 'bytes=4-7'},
	});

	const firstResponse = await cachedFetch(request, {
		[blockedDefaultHeaderNamesSymbol]: ['range'],
	});
	t.is(await firstResponse.text(), 'partial-1');

	const secondResponse = await cachedFetch(request, {
		[blockedDefaultHeaderNamesSymbol]: ['range'],
	});
	t.is(await secondResponse.text(), 'partial-2');

	t.is(callCount, 2);
	t.deepEqual(observedRanges, ['bytes=4-7', 'bytes=4-7']);
});

test('Request metadata can block an inner Range default and allow caching', async t => {
	let callCount = 0;
	const observedRanges = [];
	const mockFetch = async (urlOrRequest, options) => {
		callCount++;
		observedRanges.push(new Headers(options?.headers ?? urlOrRequest.headers).get('range'));
		return new Response(`full-${callCount}`, {status: 200});
	};

	const cachedFetch = pipeline(
		mockFetch,
		fetchFunction => withHeaders(fetchFunction, {Range: 'bytes=0-3'}),
		fetchFunction => withCache(fetchFunction, {ttl: 60_000}),
	);

	const request = new Request('https://example.com/api');
	request[blockedDefaultHeaderNamesSymbol] = ['range'];

	const firstResponse = await cachedFetch(request);
	t.is(await firstResponse.text(), 'full-1');

	const secondResponse = await cachedFetch(request);
	t.is(await secondResponse.text(), 'full-1');

	t.is(callCount, 1);
	t.deepEqual(observedRanges, [null]);
});

test('headers metadata can block an inner Range default and allow caching', async t => {
	let callCount = 0;
	const observedRanges = [];
	const mockFetch = async (_urlOrRequest, options) => {
		callCount++;
		observedRanges.push(new Headers(options?.headers).get('range'));
		return new Response(`full-${callCount}`, {status: 200});
	};

	const cachedFetch = pipeline(
		mockFetch,
		fetchFunction => withHeaders(fetchFunction, {Range: 'bytes=0-3'}),
		fetchFunction => withCache(fetchFunction, {ttl: 60_000}),
	);

	const headers = new Headers();
	headers[blockedDefaultHeaderNamesSymbol] = ['range'];

	const firstResponse = await cachedFetch('https://example.com/api', {headers});
	t.is(await firstResponse.text(), 'full-1');

	const secondResponse = await cachedFetch('https://example.com/api', {headers});
	t.is(await secondResponse.text(), 'full-1');

	t.is(callCount, 1);
	t.deepEqual(observedRanges, [null]);
});

test('URL fragments do not create separate cache entries', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	await cachedFetch('https://example.com/api#one');
	await cachedFetch('https://example.com/api#two');

	t.is(mockFetch.callCount, 1);
});

test('Request URL fragments do not create separate cache entries', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	await cachedFetch(new Request('https://example.com/api#one'));
	await cachedFetch(new Request('https://example.com/api#two'));

	t.is(mockFetch.callCount, 1);
});

test('withBaseUrl composition shares a cache entry across equivalent relative URL spellings', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = pipeline(
		mockFetch,
		fetchFunction => withBaseUrl(fetchFunction, 'https://api.example.com/v1'),
		fetchFunction => withCache(fetchFunction, {ttl: 60_000}),
	);

	await cachedFetch('/users');
	await cachedFetch('users');

	t.is(mockFetch.callCount, 1);
});

test('withBaseUrl composition invalidates cached GETs across equivalent relative URL spellings', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = pipeline(
		mockFetch,
		fetchFunction => withBaseUrl(fetchFunction, 'https://api.example.com/v1'),
		fetchFunction => withCache(fetchFunction, {ttl: 60_000}),
	);

	await cachedFetch('/users');
	t.is(mockFetch.callCount, 1);

	await cachedFetch('users', {method: 'POST'});
	t.is(mockFetch.callCount, 2);

	await cachedFetch('/users');
	t.is(mockFetch.callCount, 3);
});

test('withBaseUrl composition shares a cache entry with the equivalent absolute Request URL', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = pipeline(
		mockFetch,
		fetchFunction => withBaseUrl(fetchFunction, 'https://api.example.com/v1'),
		fetchFunction => withCache(fetchFunction, {ttl: 60_000}),
	);

	await cachedFetch('/users');
	await cachedFetch(new Request('https://api.example.com/v1/users'));

	t.is(mockFetch.callCount, 1);
});

test('withSearchParameters composition shares a cache entry across equivalent absolute URL spellings', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = pipeline(
		mockFetch,
		fetchFunction => withSearchParameters(fetchFunction, {apiKey: 'abc'}),
		fetchFunction => withCache(fetchFunction, {ttl: 60_000}),
	);

	await cachedFetch('https://example.com');
	await cachedFetch(new URL('https://example.com/?apiKey=abc'));

	t.is(mockFetch.callCount, 1);
});

test('withBaseUrl composition invalidates cached GETs across equivalent absolute Request URLs', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = pipeline(
		mockFetch,
		fetchFunction => withBaseUrl(fetchFunction, 'https://api.example.com/v1'),
		fetchFunction => withCache(fetchFunction, {ttl: 60_000}),
	);

	await cachedFetch('/users');
	t.is(mockFetch.callCount, 1);

	await cachedFetch(new Request('https://api.example.com/v1/users', {method: 'POST'}));
	t.is(mockFetch.callCount, 2);

	await cachedFetch('/users');
	t.is(mockFetch.callCount, 3);
});

test('nested withBaseUrl composition keys cache entries from the outer resolved URL', async t => {
	const calls = [];
	const mockFetch = async url => {
		calls.push(String(url));
		return new Response(`response-${calls.length}`);
	};

	const cachedFetch = pipeline(
		mockFetch,
		fetchFunction => withBaseUrl(fetchFunction, 'https://inner.example.com'),
		fetchFunction => withBaseUrl(fetchFunction, 'https://outer.example.com'),
		fetchFunction => withCache(fetchFunction, {ttl: 60_000}),
	);

	const firstResponse = await cachedFetch('/users');
	t.is(await firstResponse.text(), 'response-1');

	const secondResponse = await cachedFetch('https://inner.example.com/users');
	t.is(await secondResponse.text(), 'response-2');

	t.deepEqual(calls, [
		'https://outer.example.com/users',
		'https://inner.example.com/users',
	]);
});

test('nested withBaseUrl composition shares a cache entry with the equivalent outer absolute URL', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = pipeline(
		mockFetch,
		fetchFunction => withBaseUrl(fetchFunction, 'https://inner.example.com'),
		fetchFunction => withBaseUrl(fetchFunction, 'https://outer.example.com'),
		fetchFunction => withCache(fetchFunction, {ttl: 60_000}),
	);

	await cachedFetch('/users');
	await cachedFetch('https://outer.example.com/users');

	t.is(mockFetch.callCount, 1);
});

test('nested withBaseUrl composition invalidates cached GETs across equivalent outer absolute URLs', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = pipeline(
		mockFetch,
		fetchFunction => withBaseUrl(fetchFunction, 'https://inner.example.com'),
		fetchFunction => withBaseUrl(fetchFunction, 'https://outer.example.com'),
		fetchFunction => withCache(fetchFunction, {ttl: 60_000}),
	);

	await cachedFetch('/users');
	t.is(mockFetch.callCount, 1);

	await cachedFetch('https://outer.example.com/users', {method: 'POST'});
	t.is(mockFetch.callCount, 2);

	await cachedFetch('/users');
	t.is(mockFetch.callCount, 3);
});

test('detects method from Request object', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	const postRequest = new Request('https://example.com/api', {method: 'POST'});
	await cachedFetch(postRequest);
	await cachedFetch(postRequest);

	t.is(mockFetch.callCount, 2);
});

test('options.method takes precedence over Request.method', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	const getRequest = new Request('https://example.com/api');
	await cachedFetch(getRequest, {method: 'POST'});
	await cachedFetch(getRequest, {method: 'POST'});

	t.is(mockFetch.callCount, 2);
});

test('throws for invalid ttl', t => {
	const mockFetch = createMockFetch();

	t.throws(() => withCache(mockFetch, {ttl: 0}), {instanceOf: TypeError});
	t.throws(() => withCache(mockFetch, {ttl: -1}), {instanceOf: TypeError});
	t.throws(() => withCache(mockFetch, {ttl: Number.POSITIVE_INFINITY}), {instanceOf: TypeError});
	t.throws(() => withCache(mockFetch, {ttl: Number.NaN}), {instanceOf: TypeError});
	t.throws(() => withCache(mockFetch, {ttl: '1000'}), {instanceOf: TypeError});
});

test('preserves metadata via copyFetchMetadata', t => {
	const mockFetch = createMockFetch();
	mockFetch[timeoutDurationSymbol] = 5000;

	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	t.is(cachedFetch[timeoutDurationSymbol], 5000);
});

test('method comparison is case-insensitive', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	await cachedFetch('https://example.com/api', {method: 'get'});
	await cachedFetch('https://example.com/api');

	t.is(mockFetch.callCount, 1);
});

test('PUT invalidates cache', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	await cachedFetch('https://example.com/api');
	await cachedFetch('https://example.com/api', {method: 'PUT'});
	await cachedFetch('https://example.com/api');

	t.is(mockFetch.callCount, 3);
});

test('DELETE invalidates cache', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	await cachedFetch('https://example.com/api');
	await cachedFetch('https://example.com/api', {method: 'DELETE'});
	await cachedFetch('https://example.com/api');

	t.is(mockFetch.callCount, 3);
});

test('fetch rejection does not leave stale cache entry', async t => {
	let callCount = 0;
	const mockFetch = async () => {
		callCount++;
		if (callCount === 1) {
			throw new Error('network error');
		}

		return new Response('ok');
	};

	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	await t.throwsAsync(() => cachedFetch('https://example.com/api'), {message: 'network error'});

	// Should re-fetch, not serve from cache
	const response = await cachedFetch('https://example.com/api');
	t.is(response.ok, true);
	t.is(callCount, 2);
});

test('PATCH invalidates cache', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	await cachedFetch('https://example.com/api');
	await cachedFetch('https://example.com/api', {method: 'PATCH'});
	await cachedFetch('https://example.com/api');

	t.is(mockFetch.callCount, 3);
});

test('HEAD requests are not cached', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	await cachedFetch('https://example.com/api', {method: 'HEAD'});
	await cachedFetch('https://example.com/api', {method: 'HEAD'});

	t.is(mockFetch.callCount, 2);
});

test('HEAD does not invalidate cached GET', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	// Populate cache with GET
	await cachedFetch('https://example.com/api');
	t.is(mockFetch.callCount, 1);

	// HEAD should not evict the cached GET
	await cachedFetch('https://example.com/api', {method: 'HEAD'});
	t.is(mockFetch.callCount, 2);

	// GET should still be cached
	await cachedFetch('https://example.com/api');
	t.is(mockFetch.callCount, 2);
});

test('OPTIONS does not invalidate cached GET', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	await cachedFetch('https://example.com/api');
	t.is(mockFetch.callCount, 1);

	await cachedFetch('https://example.com/api', {method: 'OPTIONS'});
	t.is(mockFetch.callCount, 2);

	// GET should still be cached
	await cachedFetch('https://example.com/api');
	t.is(mockFetch.callCount, 2);
});

test('non-GET requests invalidate cached GET across URL fragments', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	await cachedFetch('https://example.com/api#cached');
	t.is(mockFetch.callCount, 1);

	await cachedFetch('https://example.com/api#mutating', {method: 'POST'});
	t.is(mockFetch.callCount, 2);

	await cachedFetch('https://example.com/api#fresh');
	t.is(mockFetch.callCount, 3);
});

test('Request non-GET invalidates cached GET across URL fragments', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	await cachedFetch(new Request('https://example.com/api#cached'));
	t.is(mockFetch.callCount, 1);

	await cachedFetch(new Request('https://example.com/api#mutating', {method: 'POST'}));
	t.is(mockFetch.callCount, 2);

	await cachedFetch(new Request('https://example.com/api#fresh'));
	t.is(mockFetch.callCount, 3);
});

test('non-ok response is not cached, subsequent ok response is cached', async t => {
	let callCount = 0;
	const mockFetch = async () => {
		callCount++;
		const status = callCount === 1 ? 500 : 200;
		return new Response('data', {status});
	};

	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	const response1 = await cachedFetch('https://example.com/api');
	t.is(response1.status, 500);
	t.is(callCount, 1);

	// Server recovered, should re-fetch and cache
	const response2 = await cachedFetch('https://example.com/api');
	t.is(response2.status, 200);
	t.is(callCount, 2);

	// Now should be cached
	const response3 = await cachedFetch('https://example.com/api');
	t.is(response3.status, 200);
	t.is(callCount, 2);
});

test('concurrent identical GET requests both hit the network', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	const [response1, response2] = await Promise.all([
		cachedFetch('https://example.com/api'),
		cachedFetch('https://example.com/api'),
	]);

	// Both fire since the first hasn't resolved to populate the cache yet
	t.is(mockFetch.callCount, 2);
	t.is(response1.ok, true);
	t.is(response2.ok, true);
});

test('older GETs do not repopulate the cache after a successful write', async t => {
	let resolveInitialGet;
	const initialGetPromise = new Promise(resolve => {
		resolveInitialGet = resolve;
	});
	let getCallCount = 0;

	const mockFetch = async (urlOrRequest, options) => {
		const method = (options?.method ?? (urlOrRequest instanceof Request ? urlOrRequest.method : 'GET')).toUpperCase();
		if (method === 'GET') {
			getCallCount++;
			if (getCallCount === 1) {
				await initialGetPromise;
				return new Response('stale');
			}

			return new Response('fresh');
		}

		return new Response('mutated');
	};

	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	const staleGetPromise = cachedFetch('https://example.com/api');
	await Promise.resolve();

	const mutationResponse = await cachedFetch('https://example.com/api', {method: 'POST'});
	t.is(await mutationResponse.text(), 'mutated');

	resolveInitialGet();
	const staleGetResponse = await staleGetPromise;
	t.is(await staleGetResponse.text(), 'stale');

	const freshGetResponse = await cachedFetch('https://example.com/api');
	t.is(await freshGetResponse.text(), 'fresh');
});

test('older GETs do not repopulate the cache after a successful write from Request input', async t => {
	let resolveInitialGet;
	const initialGetPromise = new Promise(resolve => {
		resolveInitialGet = resolve;
	});
	let getCallCount = 0;

	const mockFetch = async (urlOrRequest, options) => {
		const method = (options?.method ?? (urlOrRequest instanceof Request ? urlOrRequest.method : 'GET')).toUpperCase();
		if (method === 'GET') {
			getCallCount++;
			if (getCallCount === 1) {
				await initialGetPromise;
				return new Response('stale');
			}

			return new Response('fresh');
		}

		return new Response('mutated');
	};

	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	const staleGetPromise = cachedFetch('https://example.com/api');
	await Promise.resolve();

	const mutationResponse = await cachedFetch(new Request('https://example.com/api', {method: 'POST'}));
	t.is(await mutationResponse.text(), 'mutated');

	resolveInitialGet();
	const staleGetResponse = await staleGetPromise;
	t.is(await staleGetResponse.text(), 'stale');

	const freshGetResponse = await cachedFetch('https://example.com/api');
	t.is(await freshGetResponse.text(), 'fresh');
});

test.serial('older GETs do not repopulate the cache after write invalidation outlives the TTL', async t => {
	let resolveInitialGet;
	const initialGetPromise = new Promise(resolve => {
		resolveInitialGet = resolve;
	});
	let currentTime = 1000;
	const originalPerformanceNow = performance.now;
	performance.now = () => currentTime;
	let getCallCount = 0;

	const mockFetch = async (urlOrRequest, options) => {
		const method = (options?.method ?? (urlOrRequest instanceof Request ? urlOrRequest.method : 'GET')).toUpperCase();
		const url = urlOrRequest instanceof Request ? urlOrRequest.url : String(urlOrRequest);

		if (method === 'GET') {
			getCallCount++;
			if (url === 'https://example.com/api' && getCallCount === 1) {
				await initialGetPromise;
				return new Response('stale');
			}

			return new Response(url.endsWith('/api') ? 'fresh' : 'other');
		}

		return new Response('mutated');
	};

	try {
		const cachedFetch = withCache(mockFetch, {ttl: 5000});

		const staleGetPromise = cachedFetch('https://example.com/api');
		await Promise.resolve();

		await cachedFetch('https://example.com/api', {method: 'POST'});

		currentTime = 7000;
		await cachedFetch('https://example.com/other');

		resolveInitialGet();
		const staleGetResponse = await staleGetPromise;
		t.is(await staleGetResponse.text(), 'stale');

		const freshGetResponse = await cachedFetch('https://example.com/api');
		t.is(await freshGetResponse.text(), 'fresh');
	} finally {
		performance.now = originalPerformanceNow;
	}
});

test('older GETs still populate the cache after an aborted write', async t => {
	let resolveInitialGet;
	const initialGetPromise = new Promise(resolve => {
		resolveInitialGet = resolve;
	});
	let getCallCount = 0;

	const mockFetch = async (urlOrRequest, options) => {
		const method = (options?.method ?? (urlOrRequest instanceof Request ? urlOrRequest.method : 'GET')).toUpperCase();
		if (method === 'GET') {
			getCallCount++;
			if (getCallCount === 1) {
				await initialGetPromise;
				return new Response('stale');
			}

			return new Response('fresh');
		}

		return new Response('mutated');
	};

	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	const staleGetPromise = cachedFetch('https://example.com/api');
	await Promise.resolve();

	const abortController = new AbortController();
	abortController.abort();

	await t.throwsAsync(() => cachedFetch('https://example.com/api', {method: 'POST', signal: abortController.signal}), {
		name: 'AbortError',
	});

	resolveInitialGet();
	const staleGetResponse = await staleGetPromise;
	t.is(await staleGetResponse.text(), 'stale');

	const cachedGetResponse = await cachedFetch('https://example.com/api');
	t.is(await cachedGetResponse.text(), 'stale');
});

test('older GETs still populate the cache across overlapping HEAD requests', async t => {
	let resolveInitialGet;
	const initialGetPromise = new Promise(resolve => {
		resolveInitialGet = resolve;
	});
	let getCallCount = 0;

	const mockFetch = async (urlOrRequest, options) => {
		const method = (options?.method ?? (urlOrRequest instanceof Request ? urlOrRequest.method : 'GET')).toUpperCase();
		if (method === 'GET') {
			getCallCount++;
			if (getCallCount === 1) {
				await initialGetPromise;
				return new Response('stale');
			}

			return new Response('fresh');
		}

		return new Response(undefined, {status: 200});
	};

	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	const staleGetPromise = cachedFetch('https://example.com/api');
	await Promise.resolve();

	await cachedFetch('https://example.com/api', {method: 'HEAD'});

	resolveInitialGet();
	const staleGetResponse = await staleGetPromise;
	t.is(await staleGetResponse.text(), 'stale');

	const cachedGetResponse = await cachedFetch('https://example.com/api');
	t.is(await cachedGetResponse.text(), 'stale');
});

test('older GETs still populate the cache when a successful write targets a different URL', async t => {
	let resolveInitialGet;
	const initialGetPromise = new Promise(resolve => {
		resolveInitialGet = resolve;
	});
	let getCallCount = 0;

	const mockFetch = async (urlOrRequest, options) => {
		const method = (options?.method ?? (urlOrRequest instanceof Request ? urlOrRequest.method : 'GET')).toUpperCase();
		const url = urlOrRequest instanceof Request ? urlOrRequest.url : String(urlOrRequest);

		if (method === 'GET') {
			getCallCount++;
			if (url === 'https://example.com/a' && getCallCount === 1) {
				await initialGetPromise;
				return new Response('stale-a');
			}

			return new Response(`fresh-${url.endsWith('/a') ? 'a' : 'b'}`);
		}

		return new Response('mutated-b');
	};

	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	const staleGetPromise = cachedFetch('https://example.com/a');
	await Promise.resolve();

	const mutationResponse = await cachedFetch('https://example.com/b', {method: 'POST'});
	t.is(await mutationResponse.text(), 'mutated-b');

	resolveInitialGet();
	const staleGetResponse = await staleGetPromise;
	t.is(await staleGetResponse.text(), 'stale-a');

	const cachedGetResponse = await cachedFetch('https://example.com/a');
	t.is(await cachedGetResponse.text(), 'stale-a');
});

test('invalidation is scoped to the specific URL', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	await cachedFetch('https://example.com/a');
	await cachedFetch('https://example.com/b');
	t.is(mockFetch.callCount, 2);

	// POST to /a should not invalidate /b
	await cachedFetch('https://example.com/a', {method: 'POST'});
	t.is(mockFetch.callCount, 3);

	await cachedFetch('https://example.com/b');
	t.is(mockFetch.callCount, 3);

	// /a was invalidated and must re-fetch
	await cachedFetch('https://example.com/a');
	t.is(mockFetch.callCount, 4);
});

test('separate withCache instances have independent caches', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch1 = withCache(mockFetch, {ttl: 60_000});
	const cachedFetch2 = withCache(mockFetch, {ttl: 60_000});

	await cachedFetch1('https://example.com/api');
	t.is(mockFetch.callCount, 1);

	// Second instance has its own cache, should fetch again
	await cachedFetch2('https://example.com/api');
	t.is(mockFetch.callCount, 2);

	// Each instance still serves from its own cache
	await cachedFetch1('https://example.com/api');
	await cachedFetch2('https://example.com/api');
	t.is(mockFetch.callCount, 2);
});

test('cached response preserves status and headers', async t => {
	const mockFetch = async () => new Response('body', {
		status: 200,
		statusText: 'OK',
		headers: {'x-custom': 'value', 'content-type': 'text/plain'},
	});

	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	await cachedFetch('https://example.com/api');
	const cached = await cachedFetch('https://example.com/api');

	t.is(cached.status, 200);
	t.is(cached.headers.get('x-custom'), 'value');
	t.is(cached.headers.get('content-type'), 'text/plain');
});

test('cached GET honors aborted option signal', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	await cachedFetch('https://example.com/api');
	t.is(mockFetch.callCount, 1);

	const abortController = new AbortController();
	abortController.abort();

	await t.throwsAsync(() => cachedFetch('https://example.com/api', {signal: abortController.signal}), {
		name: 'AbortError',
	});
	t.is(mockFetch.callCount, 1);
});

test('cached GET honors aborted Request signal', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	await cachedFetch('https://example.com/api');
	t.is(mockFetch.callCount, 1);

	const abortController = new AbortController();
	abortController.abort();

	await t.throwsAsync(() => cachedFetch(new Request('https://example.com/api', {signal: abortController.signal})), {
		name: 'AbortError',
	});
	t.is(mockFetch.callCount, 1);
});

test('cache: no-store bypasses and does not replace a cached GET', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	const cachedResponse = await cachedFetch('https://example.com/api');
	t.deepEqual(await cachedResponse.json(), {callCount: 1});
	t.is(mockFetch.callCount, 1);

	const bypassedResponse = await cachedFetch('https://example.com/api', {cache: 'no-store'});
	t.deepEqual(await bypassedResponse.json(), {callCount: 2});
	t.is(mockFetch.callCount, 2);

	const cachedAgainResponse = await cachedFetch('https://example.com/api');
	t.deepEqual(await cachedAgainResponse.json(), {callCount: 1});
	t.is(mockFetch.callCount, 2);
});

test('Request cache: no-store bypasses and does not replace a cached GET', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	const cachedResponse = await cachedFetch('https://example.com/api');
	t.deepEqual(await cachedResponse.json(), {callCount: 1});
	t.is(mockFetch.callCount, 1);

	const bypassedResponse = await cachedFetch(new Request('https://example.com/api', {cache: 'no-store'}));
	t.deepEqual(await bypassedResponse.json(), {callCount: 2});
	t.is(mockFetch.callCount, 2);

	const cachedAgainResponse = await cachedFetch('https://example.com/api');
	t.deepEqual(await cachedAgainResponse.json(), {callCount: 1});
	t.is(mockFetch.callCount, 2);
});

test('cache: reload bypasses and refreshes a cached GET', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	await cachedFetch('https://example.com/api');
	t.is(mockFetch.callCount, 1);

	const reloadedResponse = await cachedFetch(new Request('https://example.com/api', {cache: 'reload'}));
	t.deepEqual(await reloadedResponse.json(), {callCount: 2});
	t.is(mockFetch.callCount, 2);

	const cachedAgainResponse = await cachedFetch('https://example.com/api');
	t.deepEqual(await cachedAgainResponse.json(), {callCount: 2});
	t.is(mockFetch.callCount, 2);
});

test('cache: no-cache bypasses and refreshes a cached GET', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	await cachedFetch('https://example.com/api');
	t.is(mockFetch.callCount, 1);

	const refreshedResponse = await cachedFetch('https://example.com/api', {cache: 'no-cache'});
	t.deepEqual(await refreshedResponse.json(), {callCount: 2});
	t.is(mockFetch.callCount, 2);

	const cachedAgainResponse = await cachedFetch('https://example.com/api');
	t.deepEqual(await cachedAgainResponse.json(), {callCount: 2});
	t.is(mockFetch.callCount, 2);
});

test.serial('cache: force-cache returns stale cached entry after TTL expiry', async t => {
	const mockFetch = createMockFetch();
	const originalPerformanceNow = performance.now;
	let currentTime = 1000;
	performance.now = () => currentTime;

	try {
		const cachedFetch = withCache(mockFetch, {ttl: 5000});

		await cachedFetch('https://example.com/api');
		t.is(mockFetch.callCount, 1);

		currentTime = 7000;
		const cachedResponse = await cachedFetch('https://example.com/api', {cache: 'force-cache'});
		t.deepEqual(await cachedResponse.json(), {callCount: 1});
		t.is(mockFetch.callCount, 1);
	} finally {
		performance.now = originalPerformanceNow;
	}
});

test('cache: only-if-cached returns 504 on cache miss', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	const response = await cachedFetch('https://example.com/api', {cache: 'only-if-cached'});

	t.is(response.status, 504);
	t.is(mockFetch.callCount, 0);
});

test.serial('cache: only-if-cached returns stale cached entry after TTL expiry', async t => {
	const mockFetch = createMockFetch();
	const originalPerformanceNow = performance.now;
	let currentTime = 1000;
	performance.now = () => currentTime;

	try {
		const cachedFetch = withCache(mockFetch, {ttl: 5000});

		await cachedFetch('https://example.com/api');
		t.is(mockFetch.callCount, 1);

		currentTime = 7000;
		const cachedResponse = await cachedFetch('https://example.com/api', {cache: 'only-if-cached'});
		t.deepEqual(await cachedResponse.json(), {callCount: 1});
		t.is(mockFetch.callCount, 1);
	} finally {
		performance.now = originalPerformanceNow;
	}
});

test('cache: reload does not replace a cached GET when refresh returns non-ok', async t => {
	let callCount = 0;
	const mockFetch = async () => {
		callCount++;
		const status = callCount === 2 ? 500 : 200;
		return new Response(JSON.stringify({callCount}), {status});
	};

	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	const cachedResponse = await cachedFetch('https://example.com/api');
	t.deepEqual(await cachedResponse.json(), {callCount: 1});
	t.is(callCount, 1);

	const reloadedResponse = await cachedFetch('https://example.com/api', {cache: 'reload'});
	t.is(reloadedResponse.status, 500);
	t.is(callCount, 2);

	const cachedAgainResponse = await cachedFetch('https://example.com/api');
	t.deepEqual(await cachedAgainResponse.json(), {callCount: 1});
	t.is(callCount, 2);
});

test('Request cache: reload does not replace a cached GET when refresh returns non-ok', async t => {
	let callCount = 0;
	const mockFetch = async () => {
		callCount++;
		const status = callCount === 2 ? 500 : 200;
		return new Response(JSON.stringify({callCount}), {status});
	};

	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	const cachedResponse = await cachedFetch('https://example.com/api');
	t.deepEqual(await cachedResponse.json(), {callCount: 1});
	t.is(callCount, 1);

	const reloadedResponse = await cachedFetch(new Request('https://example.com/api', {cache: 'reload'}));
	t.is(reloadedResponse.status, 500);
	t.is(callCount, 2);

	const cachedAgainResponse = await cachedFetch('https://example.com/api');
	t.deepEqual(await cachedAgainResponse.json(), {callCount: 1});
	t.is(callCount, 2);
});

test('options.cache takes precedence over Request.cache for no-store', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	await cachedFetch('https://example.com/api');
	t.is(mockFetch.callCount, 1);

	const bypassedResponse = await cachedFetch(new Request('https://example.com/api', {cache: 'reload'}), {cache: 'no-store'});
	t.deepEqual(await bypassedResponse.json(), {callCount: 2});
	t.is(mockFetch.callCount, 2);

	const cachedAgainResponse = await cachedFetch('https://example.com/api');
	t.deepEqual(await cachedAgainResponse.json(), {callCount: 1});
	t.is(mockFetch.callCount, 2);
});

test('options.cache takes precedence over Request.cache for reload', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	await cachedFetch('https://example.com/api');
	t.is(mockFetch.callCount, 1);

	const reloadedResponse = await cachedFetch(new Request('https://example.com/api', {cache: 'no-store'}), {cache: 'reload'});
	t.deepEqual(await reloadedResponse.json(), {callCount: 2});
	t.is(mockFetch.callCount, 2);

	const cachedAgainResponse = await cachedFetch('https://example.com/api');
	t.deepEqual(await cachedAgainResponse.json(), {callCount: 2});
	t.is(mockFetch.callCount, 2);
});

test('options.cache default takes precedence over Request.cache no-store', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	const cachedResponse = await cachedFetch('https://example.com/api');
	t.deepEqual(await cachedResponse.json(), {callCount: 1});
	t.is(mockFetch.callCount, 1);

	const cachedAgainResponse = await cachedFetch(new Request('https://example.com/api', {cache: 'no-store'}), {cache: 'default'});
	t.deepEqual(await cachedAgainResponse.json(), {callCount: 1});
	t.is(mockFetch.callCount, 1);
});

test('options.cache default takes precedence over Request.cache reload', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	const cachedResponse = await cachedFetch('https://example.com/api');
	t.deepEqual(await cachedResponse.json(), {callCount: 1});
	t.is(mockFetch.callCount, 1);

	const cachedAgainResponse = await cachedFetch(new Request('https://example.com/api', {cache: 'reload'}), {cache: 'default'});
	t.deepEqual(await cachedAgainResponse.json(), {callCount: 1});
	t.is(mockFetch.callCount, 1);
});

test('forwards arguments to the underlying fetch', async t => {
	const calls = [];
	const mockFetch = async (...arguments_) => {
		calls.push(arguments_);
		return new Response('ok');
	};

	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	const options = {headers: {Authorization: 'Bearer token'}};
	await cachedFetch('https://example.com/api', options);

	t.is(calls.length, 1);
	t.is(calls[0][0], 'https://example.com/api');
	t.is(calls[0][1], options);
});

test.serial('re-caches after TTL expiry', async t => {
	const mockFetch = createMockFetch();
	const originalPerformanceNow = performance.now;
	let currentTime = 1000;
	performance.now = () => currentTime;

	try {
		const cachedFetch = withCache(mockFetch, {ttl: 5000});

		await cachedFetch('https://example.com/api');
		t.is(mockFetch.callCount, 1);

		// Expire the entry
		currentTime = 7000;
		await cachedFetch('https://example.com/api');
		t.is(mockFetch.callCount, 2);

		// The re-fetched response should now be cached
		await cachedFetch('https://example.com/api');
		t.is(mockFetch.callCount, 2);
	} finally {
		performance.now = originalPerformanceNow;
	}
});

test.serial('expired cache entries are evicted during later requests', async t => {
	const mockFetch = createMockFetch();
	const originalPerformanceNow = performance.now;
	let currentTime = 1000;
	performance.now = () => currentTime;

	try {
		const cachedFetch = withCache(mockFetch, {ttl: 5000});

		await cachedFetch('https://example.com/a');
		t.is(mockFetch.callCount, 1);

		currentTime = 7000;
		await cachedFetch('https://example.com/b');
		t.is(mockFetch.callCount, 2);

		const response = await cachedFetch('https://example.com/a', {cache: 'only-if-cached'});
		t.is(response.status, 504);
		t.is(mockFetch.callCount, 2);
	} finally {
		performance.now = originalPerformanceNow;
	}
});

test.serial('expired invalidation markers are evicted during later requests', async t => {
	const mockFetch = createMockFetch();
	const originalPerformanceNow = performance.now;
	let currentTime = 1000;
	performance.now = () => currentTime;

	try {
		const cachedFetch = withCache(mockFetch, {ttl: 5000});

		await cachedFetch('https://example.com/a', {method: 'POST'});
		t.is(mockFetch.callCount, 1);

		currentTime = 7000;
		await cachedFetch('https://example.com/b');
		t.is(mockFetch.callCount, 2);

		const firstAResponse = await cachedFetch('https://example.com/a');
		t.deepEqual(await firstAResponse.json(), {callCount: 3});
		t.is(mockFetch.callCount, 3);

		const secondAResponse = await cachedFetch('https://example.com/a');
		t.deepEqual(await secondAResponse.json(), {callCount: 3});
		t.is(mockFetch.callCount, 3);
	} finally {
		performance.now = originalPerformanceNow;
	}
});

test('cache is populated after concurrent requests resolve', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	await Promise.all([
		cachedFetch('https://example.com/api'),
		cachedFetch('https://example.com/api'),
	]);
	t.is(mockFetch.callCount, 2);

	// Subsequent call should hit cache
	await cachedFetch('https://example.com/api');
	t.is(mockFetch.callCount, 2);
});

test('mutation during in-flight GET prevents stale caching', async t => {
	let callCount = 0;
	let getResolve;

	const mockFetch = async (url, options = {}) => {
		callCount++;
		const method = options.method ?? 'GET';

		if (method === 'GET' && callCount === 1) {
			// First GET is slow; wait for the mutation to happen
			await new Promise(resolve => {
				getResolve = resolve;
			});

			return new Response(JSON.stringify({stale: true}), {
				status: 200,
				headers: {'content-type': 'application/json'},
			});
		}

		if (method === 'POST') {
			return new Response(null, {status: 200});
		}

		return new Response(JSON.stringify({fresh: true}), {
			status: 200,
			headers: {'content-type': 'application/json'},
		});
	};

	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	// Start a slow GET
	const slowGet = cachedFetch('https://example.com/api');

	// While the GET is in-flight, mutate the same URL
	await cachedFetch('https://example.com/api', {method: 'POST'});

	// Let the slow GET complete
	getResolve();
	const staleResponse = await slowGet;
	t.deepEqual(await staleResponse.json(), {stale: true});

	// The stale GET result should NOT have been cached because the generation changed
	const freshResponse = await cachedFetch('https://example.com/api');
	t.deepEqual(await freshResponse.json(), {fresh: true});
});

test('TRACE method passes through without invalidating cache', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	// Populate cache
	const response1 = await cachedFetch('https://example.com/api');
	t.deepEqual(await response1.json(), {callCount: 1});

	// TRACE should pass through without invalidating
	await cachedFetch('https://example.com/api', {method: 'TRACE'});
	t.is(mockFetch.callCount, 2);

	// Cache should still be intact
	const response3 = await cachedFetch('https://example.com/api');
	t.deepEqual(await response3.json(), {callCount: 1});
	t.is(mockFetch.callCount, 2);
});

test('server 206 without client Range header is not cached', async t => {
	let callCount = 0;
	const mockFetch = async () => {
		callCount++;
		return new Response(`response-${callCount}`, {status: callCount === 1 ? 206 : 200});
	};

	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	// Server returns 206 even though we didn't send a Range header
	const response1 = await cachedFetch('https://example.com/api');
	t.is(response1.status, 206);
	t.is(await response1.text(), 'response-1');

	// Should NOT have been cached
	const response2 = await cachedFetch('https://example.com/api');
	t.is(response2.status, 200);
	t.is(await response2.text(), 'response-2');
	t.is(callCount, 2);
});

test('URLs with different query strings are cached separately', async t => {
	const mockFetch = createMockFetch();
	const cachedFetch = withCache(mockFetch, {ttl: 60_000});

	await cachedFetch('https://example.com/api?page=1');
	await cachedFetch('https://example.com/api?page=2');
	await cachedFetch('https://example.com/api?page=1');

	t.is(mockFetch.callCount, 2);
});
