import test from 'ava';
import {
	pipeline,
	withBaseUrl,
	withDeduplication,
	withHttpError,
	withTimeout,
} from '../source/index.js';

const createMockFetch = (status = 200) => {
	let callCount = 0;

	const mockFetch = async () => {
		callCount++;
		return Response.json({callCount}, {
			status,
			headers: {'content-type': 'application/json'},
		});
	};

	Object.defineProperty(mockFetch, 'callCount', {get: () => callCount});
	return mockFetch;
};

const createDelayedMockFetch = ({delay = 50, status = 200} = {}) => {
	let callCount = 0;

	const mockFetch = async () => {
		callCount++;
		const currentCount = callCount;
		await new Promise(resolve => {
			setTimeout(resolve, delay);
		});
		return Response.json({callCount: currentCount}, {
			status,
			headers: {'content-type': 'application/json'},
		});
	};

	Object.defineProperty(mockFetch, 'callCount', {get: () => callCount});
	return mockFetch;
};

const createAbortableDelayedFetch = delay => {
	let callCount = 0;

	const mockFetch = async (url, options = {}) => new Promise((resolve, reject) => {
		callCount++;

		const timer = setTimeout(() => {
			resolve(new Response(url));
		}, delay);

		const onAbort = () => {
			clearTimeout(timer);
			const error = new Error('The operation was aborted');
			error.name = 'AbortError';
			reject(error);
		};

		if (options.signal?.aborted) {
			onAbort();
			return;
		}

		options.signal?.addEventListener('abort', onAbort, {once: true});
	});

	Object.defineProperty(mockFetch, 'callCount', {get: () => callCount});
	return mockFetch;
};

const expectConcurrentJson = async (t, fetchFunction, calls, {callCount, responses = [{callCount: 1}, {callCount: 1}]}) => {
	const [response1, response2] = await Promise.all(calls);

	t.is(fetchFunction.callCount, callCount);
	t.deepEqual(await response1.json(), responses[0]);
	t.deepEqual(await response2.json(), responses[1]);
};

test('concurrent GETs to same URL make only one fetch call', async t => {
	const mockFetch = createDelayedMockFetch();
	const deduplicatedFetch = withDeduplication()(mockFetch);

	await expectConcurrentJson(t, mockFetch, [
		deduplicatedFetch('https://example.com/api'),
		deduplicatedFetch('https://example.com/api'),
	], {callCount: 1});
});

test('each caller gets an independent response body', async t => {
	const mockFetch = createDelayedMockFetch();
	const deduplicatedFetch = withDeduplication()(mockFetch);

	const [response1, response2] = await Promise.all([
		deduplicatedFetch('https://example.com/api'),
		deduplicatedFetch('https://example.com/api'),
	]);

	// Consume first body completely, then verify second is still readable
	const text1 = await response1.text();
	const text2 = await response2.text();
	t.is(text1, JSON.stringify({callCount: 1}));
	t.is(text1, text2);
});

test('different URLs are not deduplicated', async t => {
	const mockFetch = createDelayedMockFetch();
	const deduplicatedFetch = withDeduplication()(mockFetch);

	await Promise.all([
		deduplicatedFetch('https://example.com/a'),
		deduplicatedFetch('https://example.com/b'),
	]);

	t.is(mockFetch.callCount, 2);
});

test('non-GET requests pass through without deduplication', async t => {
	const mockFetch = createDelayedMockFetch();
	const deduplicatedFetch = withDeduplication()(mockFetch);

	await Promise.all([
		deduplicatedFetch('https://example.com/api', {method: 'POST'}),
		deduplicatedFetch('https://example.com/api', {method: 'POST'}),
	]);

	t.is(mockFetch.callCount, 2);
});

test('sequential GETs each make their own fetch call', async t => {
	const mockFetch = createMockFetch();
	const deduplicatedFetch = withDeduplication()(mockFetch);

	const response1 = await deduplicatedFetch('https://example.com/api');
	const data1 = await response1.json();

	const response2 = await deduplicatedFetch('https://example.com/api');
	const data2 = await response2.json();

	t.is(mockFetch.callCount, 2);
	t.deepEqual(data1, {callCount: 1});
	t.deepEqual(data2, {callCount: 2});
});

test('reused deduplication wrapper keeps in-flight state per wrapped fetch function', async t => {
	const deduplicate = withDeduplication();
	const firstFetch = createDelayedMockFetch();
	const secondFetch = createDelayedMockFetch();
	const deduplicatedFetchA = deduplicate(firstFetch);
	const deduplicatedFetchB = deduplicate(secondFetch);

	const [responseA, responseB] = await Promise.all([
		deduplicatedFetchA('https://example.com/api'),
		deduplicatedFetchB('https://example.com/api'),
	]);

	t.deepEqual(await responseA.json(), {callCount: 1});
	t.deepEqual(await responseB.json(), {callCount: 1});
	t.is(firstFetch.callCount, 1);
	t.is(secondFetch.callCount, 1);
});

test('single caller returns the original response without cloning', async t => {
	let cloneCount = 0;
	const response = {
		clone() {
			cloneCount++;
			return {cloned: true};
		},
	};

	const deduplicatedFetch = withDeduplication()(async () => response);

	const result = await deduplicatedFetch('https://example.com/api');

	t.is(result, response);
	t.is(cloneCount, 0);
});

test('multiple waiters only clone for additional callers', async t => {
	let cloneCount = 0;
	const cloneResults = [{id: 2}, {id: 3}];
	const response = {
		id: 1,
		clone() {
			return {
				...cloneResults[cloneCount++],
			};
		},
	};

	const deduplicatedFetch = withDeduplication()(async () => response);

	const [firstResponse, secondResponse, thirdResponse] = await Promise.all([
		deduplicatedFetch('https://example.com/api'),
		deduplicatedFetch('https://example.com/api'),
		deduplicatedFetch('https://example.com/api'),
	]);

	t.is(firstResponse, response);
	t.deepEqual(secondResponse, {id: 2});
	t.deepEqual(thirdResponse, {id: 3});
	t.is(cloneCount, 2);
});

test('error from fetch propagates to all waiters', async t => {
	const error = new Error('Network failure');
	let callCount = 0;

	const mockFetch = async () => {
		callCount++;
		await new Promise(resolve => {
			setTimeout(resolve, 50);
		});
		throw error;
	};

	const deduplicatedFetch = withDeduplication()(mockFetch);

	const [error1, error2] = await Promise.all([
		t.throwsAsync(() => deduplicatedFetch('https://example.com/api')),
		t.throwsAsync(() => deduplicatedFetch('https://example.com/api')),
	]);

	t.is(callCount, 1);
	t.is(error1.message, 'Network failure');
	t.is(error2.message, 'Network failure');
});

test('error from fetch propagates to every waiter in a larger batch', async t => {
	const error = new Error('Network failure');
	let callCount = 0;

	const mockFetch = async () => {
		callCount++;
		await new Promise(resolve => {
			setTimeout(resolve, 50);
		});
		throw error;
	};

	const deduplicatedFetch = withDeduplication()(mockFetch);

	const errors = await Promise.all([
		t.throwsAsync(() => deduplicatedFetch('https://example.com/api')),
		t.throwsAsync(() => deduplicatedFetch('https://example.com/api')),
		t.throwsAsync(() => deduplicatedFetch('https://example.com/api')),
	]);

	t.is(callCount, 1);

	for (const currentError of errors) {
		t.is(currentError, error);
	}
});

test('after error, next request starts a fresh fetch', async t => {
	let callCount = 0;

	const mockFetch = async () => {
		callCount++;

		if (callCount === 1) {
			throw new Error('Transient failure');
		}

		return new Response('ok', {status: 200});
	};

	const deduplicatedFetch = withDeduplication()(mockFetch);

	await t.throwsAsync(() => deduplicatedFetch('https://example.com/api'));
	t.is(callCount, 1);

	const response = await deduplicatedFetch('https://example.com/api');
	t.is(callCount, 2);
	t.is(response.status, 200);
});

test('Request objects are not deduplicated', async t => {
	const mockFetch = createDelayedMockFetch();
	const deduplicatedFetch = withDeduplication()(mockFetch);

	const [response1, response2] = await Promise.all([
		deduplicatedFetch(new Request('https://example.com/api')),
		deduplicatedFetch(new Request('https://example.com/api')),
	]);

	t.is(mockFetch.callCount, 2);
	const data1 = await response1.json();
	const data2 = await response2.json();
	t.deepEqual(data1, {callCount: 1});
	t.deepEqual(data2, {callCount: 2});
});

test('URL objects are deduplicated', async t => {
	const mockFetch = createDelayedMockFetch();
	const deduplicatedFetch = withDeduplication()(mockFetch);

	await expectConcurrentJson(t, mockFetch, [
		deduplicatedFetch(new URL('https://example.com/api')),
		deduplicatedFetch(new URL('https://example.com/api')),
	], {callCount: 1});
});

test('equivalent absolute URL string and URL object are deduplicated', async t => {
	const mockFetch = createDelayedMockFetch();
	const deduplicatedFetch = withDeduplication()(mockFetch);

	await expectConcurrentJson(t, mockFetch, [
		deduplicatedFetch('https://example.com'),
		deduplicatedFetch(new URL('https://example.com')),
	], {callCount: 1});
});

test('Request with non-GET method passes through', async t => {
	const mockFetch = createDelayedMockFetch();
	const deduplicatedFetch = withDeduplication()(mockFetch);

	await Promise.all([
		deduplicatedFetch(new Request('https://example.com/api', {method: 'POST'})),
		deduplicatedFetch(new Request('https://example.com/api', {method: 'POST'})),
	]);

	t.is(mockFetch.callCount, 2);
});

test('strips fragment from URL for deduplication key', async t => {
	const mockFetch = createDelayedMockFetch();
	const deduplicatedFetch = withDeduplication()(mockFetch);

	const [response1, response2] = await Promise.all([
		deduplicatedFetch('https://example.com/api#foo'),
		deduplicatedFetch('https://example.com/api#bar'),
	]);

	t.is(mockFetch.callCount, 1);
	const data1 = await response1.json();
	const data2 = await response2.json();
	t.deepEqual(data1, {callCount: 1});
	t.deepEqual(data2, {callCount: 1});
});

test('works with withBaseUrl', async t => {
	const mockFetch = createDelayedMockFetch();
	const deduplicatedFetch = pipeline(
		mockFetch,
		withBaseUrl('https://example.com'),
		withDeduplication(),
	);

	await expectConcurrentJson(t, mockFetch, [
		deduplicatedFetch('/api'),
		deduplicatedFetch('/api'),
	], {callCount: 1});
});

test('preserves custom URL resolution metadata for outer wrappers', async t => {
	const {resolveRequestUrlSymbol} = await import('../source/utilities.js');
	const mockFetch = createDelayedMockFetch();
	mockFetch[resolveRequestUrlSymbol] = urlOrRequest => new URL(urlOrRequest, 'https://example.com');
	const deduplicatedFetch = withHttpError()(withDeduplication()(mockFetch));

	await expectConcurrentJson(t, mockFetch, [
		deduplicatedFetch('/api'),
		deduplicatedFetch('/api#fragment'),
	], {callCount: 1});
});

test('explicit {method: "GET"} is not deduplicated', async t => {
	const mockFetch = createDelayedMockFetch();
	const deduplicatedFetch = withDeduplication()(mockFetch);

	await expectConcurrentJson(t, mockFetch, [
		deduplicatedFetch('https://example.com/api', {method: 'GET'}),
		deduplicatedFetch('https://example.com/api'),
	], {callCount: 2, responses: [{callCount: 1}, {callCount: 2}]});
});

test('lowercase method in RequestInit is not deduplicated', async t => {
	const mockFetch = createDelayedMockFetch();
	const deduplicatedFetch = withDeduplication()(mockFetch);

	await expectConcurrentJson(t, mockFetch, [
		deduplicatedFetch('https://example.com/api', {method: 'get'}),
		deduplicatedFetch('https://example.com/api'),
	], {callCount: 2, responses: [{callCount: 1}, {callCount: 2}]});
});

test('different query parameters are not deduplicated', async t => {
	const mockFetch = createDelayedMockFetch();
	const deduplicatedFetch = withDeduplication()(mockFetch);

	await Promise.all([
		deduplicatedFetch('https://example.com/api?page=1'),
		deduplicatedFetch('https://example.com/api?page=2'),
	]);

	t.is(mockFetch.callCount, 2);
});

test('string URL and Request with same URL are not deduplicated', async t => {
	const mockFetch = createDelayedMockFetch();
	const deduplicatedFetch = withDeduplication()(mockFetch);

	await expectConcurrentJson(t, mockFetch, [
		deduplicatedFetch('https://example.com/api'),
		deduplicatedFetch(new Request('https://example.com/api')),
	], {callCount: 2, responses: [{callCount: 1}, {callCount: 2}]});
});

test('GET requests with RequestInit are not deduplicated', async t => {
	const mockFetch = createDelayedMockFetch();
	const deduplicatedFetch = withDeduplication()(mockFetch);

	await expectConcurrentJson(t, mockFetch, [
		deduplicatedFetch('https://example.com/api', {cache: 'reload'}),
		deduplicatedFetch('https://example.com/api', {cache: 'force-cache'}),
	], {callCount: 2, responses: [{callCount: 1}, {callCount: 2}]});
});

test('explicit empty RequestInit is deduplicated', async t => {
	const mockFetch = createDelayedMockFetch();
	const deduplicatedFetch = withDeduplication()(mockFetch);

	await expectConcurrentJson(t, mockFetch, [
		deduplicatedFetch('https://example.com/api', {}),
		deduplicatedFetch('https://example.com/api', {}),
	], {callCount: 1});
});

test('withTimeout preserves timeout semantics for concurrent callers', async t => {
	const slowFetch = createAbortableDelayedFetch(100);
	const deduplicatedFetch = withDeduplication()(slowFetch);
	const fetchWithTimeout = withTimeout(10)(deduplicatedFetch);

	await t.throwsAsync(() => Promise.all([
		fetchWithTimeout('https://example.com/api'),
		fetchWithTimeout('https://example.com/api'),
	]), {name: 'AbortError'});

	t.is(slowFetch.callCount, 2);
});

test('works through withHttpError wrapper normalization', async t => {
	const mockFetch = createDelayedMockFetch();
	const deduplicatedFetch = withHttpError()(withDeduplication()(mockFetch));

	await expectConcurrentJson(t, mockFetch, [
		deduplicatedFetch('https://example.com/api'),
		deduplicatedFetch('https://example.com/api'),
	], {callCount: 1});
});

test('explicit empty RequestInit stays transparent through withHttpError normalization', async t => {
	const mockFetch = createDelayedMockFetch();
	const deduplicatedFetch = withHttpError()(withDeduplication()(mockFetch));

	await expectConcurrentJson(t, mockFetch, [
		deduplicatedFetch('https://example.com/api', {}),
		deduplicatedFetch('https://example.com/api', {}),
	], {callCount: 1});
});

test('inner timeouts disable deduplication so each call keeps its own timeout budget', async t => {
	const slowFetch = createAbortableDelayedFetch(200);
	const timedFetch = withTimeout(80)(slowFetch);
	const deduplicatedFetch = withDeduplication()(timedFetch);
	const startedAt = performance.now();

	const firstRequest = t.throwsAsync(() => deduplicatedFetch('https://example.com/api'), {name: 'AbortError'});

	await new Promise(resolve => {
		setTimeout(resolve, 50);
	});

	await t.throwsAsync(() => deduplicatedFetch('https://example.com/api'), {name: 'AbortError'});
	await firstRequest;

	t.is(slowFetch.callCount, 2);
	t.true(performance.now() - startedAt >= 110);
});

test('preserves timeout metadata for outer wrappers', async t => {
	const {timeoutDurationSymbol} = await import('../source/utilities.js');
	const mockFetch = async () => new Response('ok');
	mockFetch[timeoutDurationSymbol] = 5000;
	const deduplicatedFetch = withDeduplication()(mockFetch);
	const outerFetch = withHttpError()(deduplicatedFetch);

	t.is(deduplicatedFetch[timeoutDurationSymbol], 5000);
	t.is(outerFetch[timeoutDurationSymbol], 5000);
});

test('non-OK responses are still deduplicated', async t => {
	const mockFetch = createDelayedMockFetch({status: 500});
	const deduplicatedFetch = withDeduplication()(mockFetch);

	const [response1, response2] = await Promise.all([
		deduplicatedFetch('https://example.com/api'),
		deduplicatedFetch('https://example.com/api'),
	]);

	t.is(mockFetch.callCount, 1);
	t.is(response1.status, 500);
	t.is(response2.status, 500);
});

test('many concurrent requests all deduplicated', async t => {
	const mockFetch = createDelayedMockFetch();
	const deduplicatedFetch = withDeduplication()(mockFetch);

	const responses = await Promise.all(
		Array.from({length: 10}, () => deduplicatedFetch('https://example.com/api')),
	);

	t.is(mockFetch.callCount, 1);

	const results = await Promise.all(responses.map(response => response.json()));
	for (const data of results) {
		t.deepEqual(data, {callCount: 1});
	}
});

test('relative path strings are deduplicated using the raw string as key', async t => {
	const mockFetch = createDelayedMockFetch();
	const deduplicatedFetch = withDeduplication()(mockFetch);

	const [response1, response2] = await Promise.all([
		deduplicatedFetch('/api/users'),
		deduplicatedFetch('/api/users'),
	]);

	t.is(mockFetch.callCount, 1);
	t.deepEqual(await response1.json(), {callCount: 1});
	t.deepEqual(await response2.json(), {callCount: 1});
});
