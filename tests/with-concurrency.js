import test from 'ava';
import {
	withConcurrency,
	withHeaders,
	withTimeout,
} from '../source/index.js';
import {
	defersConcurrencySlotSymbol,
	waitForConcurrencySlotSymbol,
} from '../source/utilities.js';

const sleep = async milliseconds => new Promise(resolve => {
	setTimeout(resolve, milliseconds);
});

const createMockFetch = ({delay: delayMs = 0} = {}) => {
	const calls = [];
	const mockFetch = async (url, _options = {}) => {
		calls.push({url, time: Date.now()});
		if (delayMs > 0) {
			await sleep(delayMs);
		}

		return {ok: true, status: 200, url};
	};

	mockFetch.calls = calls;
	return mockFetch;
};

test('passes through requests within the concurrency limit', async t => {
	const mockFetch = createMockFetch({delay: 50});
	const limitedFetch = withConcurrency(mockFetch, {maxConcurrentRequests: 3});

	await Promise.all([
		limitedFetch('/a'),
		limitedFetch('/b'),
		limitedFetch('/c'),
	]);

	t.is(mockFetch.calls.length, 3);
});

test('limits concurrent requests', async t => {
	let activeCount = 0;
	let maxActive = 0;
	const mockFetch = async url => {
		activeCount++;
		maxActive = Math.max(maxActive, activeCount);
		await sleep(50);
		activeCount--;
		return {ok: true, status: 200, url};
	};

	const limitedFetch = withConcurrency(mockFetch, {maxConcurrentRequests: 2});

	await Promise.all([
		limitedFetch('/a'),
		limitedFetch('/b'),
		limitedFetch('/c'),
		limitedFetch('/d'),
	]);

	t.is(maxActive, 2);
});

test('queued requests execute as slots free up', async t => {
	const order = [];
	const mockFetch = async url => {
		order.push(`start:${url}`);
		await sleep(50);
		order.push(`end:${url}`);
		return {ok: true, status: 200, url};
	};

	const limitedFetch = withConcurrency(mockFetch, {maxConcurrentRequests: 1});

	await Promise.all([
		limitedFetch('/a'),
		limitedFetch('/b'),
		limitedFetch('/c'),
	]);

	t.deepEqual(order, [
		'start:/a',
		'end:/a',
		'start:/b',
		'end:/b',
		'start:/c',
		'end:/c',
	]);
});

test('respects abort signal while waiting', async t => {
	const mockFetch = async url => {
		await sleep(100);
		return {ok: true, status: 200, url};
	};

	const limitedFetch = withConcurrency(mockFetch, {maxConcurrentRequests: 1});

	const first = limitedFetch('/a');

	const controller = new AbortController();
	const promise = limitedFetch('/b', {signal: controller.signal});

	setTimeout(() => {
		controller.abort();
	}, 20);

	await t.throwsAsync(promise, {name: 'AbortError'});
	await first;
});

test('respects already-aborted signal', async t => {
	const mockFetch = async url => {
		await sleep(100);
		return {ok: true, status: 200, url};
	};

	const limitedFetch = withConcurrency(mockFetch, {maxConcurrentRequests: 1});

	const first = limitedFetch('/a');

	const controller = new AbortController();
	controller.abort();

	await t.throwsAsync(
		limitedFetch('/b', {signal: controller.signal}),
		{name: 'AbortError'},
	);

	await first;
});

test('preserves custom abort reason while waiting', async t => {
	const mockFetch = async url => {
		await sleep(100);
		return {ok: true, status: 200, url};
	};

	const limitedFetch = withConcurrency(mockFetch, {maxConcurrentRequests: 1});

	const first = limitedFetch('/a');

	const controller = new AbortController();
	const reason = new Error('stop waiting');
	const promise = limitedFetch('/b', {signal: controller.signal});

	setTimeout(() => {
		controller.abort(reason);
	}, 20);

	const error = await t.throwsAsync(promise);
	t.is(error, reason);
	await first;
});

test('aborted request does not consume a concurrency slot', async t => {
	let activeCount = 0;
	let maxActive = 0;
	const mockFetch = async url => {
		activeCount++;
		maxActive = Math.max(maxActive, activeCount);
		await sleep(50);
		activeCount--;
		return {ok: true, status: 200, url};
	};

	const limitedFetch = withConcurrency(mockFetch, {maxConcurrentRequests: 1});

	const first = limitedFetch('/a');

	const controller = new AbortController();
	const abortedPromise = limitedFetch('/b', {signal: controller.signal});
	controller.abort();
	await t.throwsAsync(abortedPromise, {name: 'AbortError'});

	await first;
	await limitedFetch('/c');

	t.is(maxActive, 1);
});

test('fetch errors do not leak concurrency slots', async t => {
	let callCount = 0;
	const mockFetch = async () => {
		callCount++;

		if (callCount === 1) {
			throw new TypeError('fetch failed');
		}

		return new Response('ok', {status: 200});
	};

	const limitedFetch = withConcurrency(mockFetch, {maxConcurrentRequests: 1});

	await t.throwsAsync(limitedFetch('/a'), {instanceOf: TypeError, message: 'fetch failed'});
	const response = await limitedFetch('/b');
	t.is(response.status, 200);
	t.is(callCount, 2);
});

test('deferred inner waits do not consume concurrency slots before fetch starts', async t => {
	const actualStarts = [];
	const mockFetch = async url => {
		actualStarts.push({url, time: Date.now()});
		await sleep(100);
		return new Response('ok');
	};

	const deferredFetch = async (url, options = {}) => {
		if (url === '/b') {
			await sleep(150);
		}

		await options[waitForConcurrencySlotSymbol]?.();
		return mockFetch(url, options);
	};

	deferredFetch[defersConcurrencySlotSymbol] = true;

	const limitedFetch = withConcurrency(deferredFetch, {maxConcurrentRequests: 2});

	await Promise.all([
		limitedFetch('/a'),
		limitedFetch('/b'),
		limitedFetch('/c'),
	]);

	t.deepEqual(actualStarts.map(call => call.url), ['/a', '/c', '/b']);
	t.true(actualStarts[1].time - actualStarts[0].time < 50);
});

test('nested concurrency wrappers still enforce the outer limit', async t => {
	let activeCount = 0;
	let maxActive = 0;
	const mockFetch = async () => {
		activeCount++;
		maxActive = Math.max(maxActive, activeCount);
		await sleep(50);
		activeCount--;
		return new Response('ok');
	};

	const limitedFetch = withConcurrency(
		withConcurrency(mockFetch, {maxConcurrentRequests: 5}),
		{maxConcurrentRequests: 1},
	);

	await Promise.all([
		limitedFetch('/a'),
		limitedFetch('/b'),
		limitedFetch('/c'),
	]);

	t.is(maxActive, 1);
});

test('response bodies do not keep the slot after fetch resolves', async t => {
	const calls = [];
	const mockFetch = async url => {
		calls.push(url);

		if (url === '/a') {
			return new Response(new ReadableStream({
				pull() {},
			}));
		}

		return new Response('ok');
	};

	const limitedFetch = withConcurrency(mockFetch, {maxConcurrentRequests: 1});
	const firstResponse = await limitedFetch('/a');
	const secondResponsePromise = limitedFetch('/b');

	await sleep(20);
	t.deepEqual(calls, ['/a', '/b']);

	const secondResponse = await secondResponsePromise;
	t.deepEqual(calls, ['/a', '/b']);
	t.is(firstResponse.status, 200);
	t.is(await secondResponse.text(), 'ok');
});

test('forwards request arguments to the inner fetch', async t => {
	let receivedUrl;
	let receivedOptions;
	const mockFetch = async (url, options = {}) => {
		receivedUrl = url;
		receivedOptions = options;
		return {ok: true, status: 200};
	};

	const limitedFetch = withConcurrency(mockFetch, {maxConcurrentRequests: 10});

	await limitedFetch('https://example.com/api', {
		method: 'POST',
		headers: {'Content-Type': 'application/json'},
		body: '{"key":"value"}',
	});

	t.is(receivedUrl, 'https://example.com/api');
	t.is(receivedOptions.method, 'POST');
	t.is(receivedOptions.body, '{"key":"value"}');
	t.deepEqual(receivedOptions.headers, {'Content-Type': 'application/json'});
});

test('copyFetchMetadata propagates timeout through withConcurrency', async t => {
	const mockFetch = async () => new Response(null, {status: 200});
	const fetchWithTimeout = withTimeout(mockFetch, 5000);
	const limitedFetch = withConcurrency(fetchWithTimeout, {maxConcurrentRequests: 5});
	const outerFetch = withHeaders(limitedFetch, {'X-Test': '1'});
	const {timeoutDurationSymbol} = await import('../source/utilities.js');

	t.is(outerFetch[timeoutDurationSymbol], 5000);
});

test('inner withTimeout applies while waiting for a concurrency slot', async t => {
	const mockFetch = async (_url, options = {}) => new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			resolve({ok: true, status: 200});
		}, 500);

		options.signal?.addEventListener('abort', () => {
			clearTimeout(timer);
			reject(options.signal.reason);
		}, {once: true});
	});

	// First request holds the slot for 500ms; timeout is 50ms so second request times out while queued
	const limitedFetch = withConcurrency(withTimeout(mockFetch, 50), {maxConcurrentRequests: 1});

	const first = limitedFetch('/a');

	const start = Date.now();
	await t.throwsAsync(limitedFetch('/b'), {name: 'TimeoutError'});
	const elapsed = Date.now() - start;
	t.true(elapsed < 100, `Expected < 100ms, got ${elapsed}ms`);

	await t.throwsAsync(first, {name: 'TimeoutError'});
});

test('respects Request signal while waiting', async t => {
	const mockFetch = async url => {
		await sleep(100);
		return {ok: true, status: 200, url};
	};

	const limitedFetch = withConcurrency(mockFetch, {maxConcurrentRequests: 1});

	const first = limitedFetch('/a');

	const controller = new AbortController();
	const request = new Request('https://example.com', {signal: controller.signal});
	const promise = limitedFetch(request);

	setTimeout(() => {
		controller.abort();
	}, 20);

	await t.throwsAsync(promise, {name: 'AbortError'});
	await first;
});

test('preserves FIFO order for queued requests', async t => {
	const order = [];
	const mockFetch = async url => {
		order.push(url);
		await sleep(20);
		return {ok: true, status: 200, url};
	};

	const limitedFetch = withConcurrency(mockFetch, {maxConcurrentRequests: 1});

	await Promise.all([
		limitedFetch('/a'),
		limitedFetch('/b'),
		limitedFetch('/c'),
	]);

	t.deepEqual(order, ['/a', '/b', '/c']);
});

test('aborting the queued head allows the next queued request to proceed', async t => {
	const mockFetch = createMockFetch({delay: 50});
	const limitedFetch = withConcurrency(mockFetch, {maxConcurrentRequests: 1});

	const first = limitedFetch('/a');

	const controller = new AbortController();
	const abortedPromise = limitedFetch('/b', {signal: controller.signal});
	const thirdPromise = limitedFetch('/c');

	controller.abort();
	await t.throwsAsync(abortedPromise, {name: 'AbortError'});

	await first;
	await thirdPromise;

	t.deepEqual(
		mockFetch.calls.map(call => call.url),
		['/a', '/c'],
	);
});

test('options.signal takes precedence over Request signal', async t => {
	const mockFetch = createMockFetch({delay: 50});
	const limitedFetch = withConcurrency(mockFetch, {maxConcurrentRequests: 1});

	const first = limitedFetch('/a');
	await first;

	const requestController = new AbortController();
	requestController.abort();
	const request = new Request('https://example.com', {signal: requestController.signal});

	const optionsController = new AbortController();
	const response = await limitedFetch(request, {signal: optionsController.signal});
	t.is(response.status, 200);
});

test('throws on non-integer maxConcurrentRequests', t => {
	t.throws(() => withConcurrency(fetch, {maxConcurrentRequests: 2.5}), {
		instanceOf: TypeError,
	});
});

test('throws on zero maxConcurrentRequests', t => {
	t.throws(() => withConcurrency(fetch, {maxConcurrentRequests: 0}), {
		instanceOf: TypeError,
	});
});

test('throws on negative maxConcurrentRequests', t => {
	t.throws(() => withConcurrency(fetch, {maxConcurrentRequests: -1}), {
		instanceOf: TypeError,
	});
});
