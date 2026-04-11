import test from 'ava';
import {
	withConcurrency,
	withHeaders,
	withRateLimit,
	withTimeout,
} from '../source/index.js';
import {waitForConcurrencySlotSymbol} from '../source/utilities.js';

const rateLimitTest = test.serial;
const sleep = async milliseconds => new Promise(resolve => {
	setTimeout(resolve, milliseconds);
});

const expectImmediate = async (t, limitedFetch, urlOrRequest, options) => {
	const start = Date.now();
	await limitedFetch(urlOrRequest, options);
	const elapsed = Date.now() - start;
	t.true(elapsed < 50, `Expected < 50ms, got ${elapsed}ms`);
};

const withMockTimers = async ({getDateNow, getPerformanceNow}, callback) => {
	const originalSetTimeout = globalThis.setTimeout;
	const originalClearTimeout = globalThis.clearTimeout;
	const originalDateNow = Date.now;
	const originalPerformanceNow = performance.now;
	let nextTimerId = 0;
	const timers = new Map();

	globalThis.setTimeout = (timerCallback, milliseconds = 0, ...arguments_) => {
		const timerId = ++nextTimerId;
		timers.set(timerId, {
			callback: timerCallback,
			time: getPerformanceNow() + milliseconds,
			arguments: arguments_,
		});
		return timerId;
	};

	globalThis.clearTimeout = timerId => {
		timers.delete(timerId);
	};

	Date.now = getDateNow;
	performance.now = getPerformanceNow;

	const runDueTimers = async () => {
		const nextTimer = [...timers.entries()]
			.filter(([, timer]) => timer.time <= getPerformanceNow())
			.sort((first, second) => first[1].time - second[1].time || first[0] - second[0])[0];

		if (!nextTimer) {
			return;
		}

		const [timerId, timer] = nextTimer;
		timers.delete(timerId);
		timer.callback(...timer.arguments);
		await Promise.resolve();
		await runDueTimers();
	};

	try {
		await callback({runDueTimers});
	} finally {
		globalThis.setTimeout = originalSetTimeout;
		globalThis.clearTimeout = originalClearTimeout;
		Date.now = originalDateNow;
		performance.now = originalPerformanceNow;
	}
};

const createMockFetch = () => {
	const calls = [];
	const mockFetch = async (url, _options = {}) => {
		calls.push({url, time: Date.now()});
		return {ok: true, status: 200, url};
	};

	mockFetch.calls = calls;
	return mockFetch;
};

rateLimitTest('passes through requests within the rate limit', async t => {
	const mockFetch = createMockFetch();
	const limitedFetch = withRateLimit({requestsPerInterval: 3, interval: 1000})(mockFetch);

	await Promise.all([
		limitedFetch('/a'),
		limitedFetch('/b'),
		limitedFetch('/c'),
	]);

	t.is(mockFetch.calls.length, 3);
});

rateLimitTest('reused rate-limit wrapper shares reservations across wrapped fetch functions', async t => {
	let currentTime = 0;
	const limit = withRateLimit({requestsPerInterval: 1, interval: 100});
	const firstFetch = createMockFetch();
	const secondFetch = createMockFetch();
	const limitedFetchA = limit(firstFetch);
	const limitedFetchB = limit(secondFetch);

	await withMockTimers({
		getDateNow: () => currentTime,
		getPerformanceNow: () => currentTime,
	}, async ({runDueTimers}) => {
		await limitedFetchA('/a');

		const secondRequest = limitedFetchB('/b');
		await Promise.resolve();
		t.is(secondFetch.calls.length, 0);

		currentTime = 100;
		await runDueTimers();
		await secondRequest;
	});

	t.is(firstFetch.calls.length, 1);
	t.is(secondFetch.calls.length, 1);
	t.true(secondFetch.calls[0].time >= 100);
});

rateLimitTest('delays requests that exceed the rate limit', async t => {
	const mockFetch = createMockFetch();
	const limitedFetch = withRateLimit({requestsPerInterval: 2, interval: 200})(mockFetch);

	const start = Date.now();

	await limitedFetch('/a');
	await limitedFetch('/b');
	await limitedFetch('/c'); // This should be delayed

	const elapsed = Date.now() - start;
	t.true(elapsed >= 150, `Expected >= 150ms, got ${elapsed}ms`);
});

rateLimitTest('allows requests after the window slides', async t => {
	const mockFetch = createMockFetch();
	const limitedFetch = withRateLimit({requestsPerInterval: 2, interval: 100})(mockFetch);

	await limitedFetch('/a');
	await limitedFetch('/b');

	await sleep(150);
	await expectImmediate(t, limitedFetch, '/c');
	await expectImmediate(t, limitedFetch, '/d');
	t.is(mockFetch.calls.length, 4);
});

rateLimitTest('respects abort signal while waiting', async t => {
	const mockFetch = createMockFetch();
	const limitedFetch = withRateLimit({requestsPerInterval: 1, interval: 5000})(mockFetch);

	// Fill the window
	await limitedFetch('/a');

	const controller = new AbortController();
	const promise = limitedFetch('/b', {signal: controller.signal});

	setTimeout(() => {
		controller.abort();
	}, 50);

	await t.throwsAsync(promise, {name: 'AbortError'});
});

rateLimitTest('respects already-aborted signal', async t => {
	const mockFetch = createMockFetch();
	const limitedFetch = withRateLimit({requestsPerInterval: 1, interval: 5000})(mockFetch);

	// Fill the window
	await limitedFetch('/a');

	const controller = new AbortController();
	controller.abort();

	await t.throwsAsync(
		limitedFetch('/b', {signal: controller.signal}),
		{name: 'AbortError'},
	);
});

rateLimitTest('respects Request signal while waiting when options.signal is absent', async t => {
	const mockFetch = createMockFetch();
	const limitedFetch = withRateLimit({requestsPerInterval: 1, interval: 5000})(mockFetch);

	await limitedFetch('/a');

	const controller = new AbortController();
	const request = new Request('https://example.com', {signal: controller.signal});
	const promise = limitedFetch(request);

	setTimeout(() => {
		controller.abort();
	}, 50);

	await t.throwsAsync(promise, {name: 'AbortError'});
	t.is(mockFetch.calls.length, 1);
});

rateLimitTest('preserves custom abort reason while waiting', async t => {
	const mockFetch = createMockFetch();
	const limitedFetch = withRateLimit({requestsPerInterval: 1, interval: 5000})(mockFetch);

	await limitedFetch('/a');

	const controller = new AbortController();
	const reason = new Error('stop waiting');
	const promise = limitedFetch('/b', {signal: controller.signal});

	setTimeout(() => {
		controller.abort(reason);
	}, 50);

	const error = await t.throwsAsync(promise);
	t.is(error, reason);
	t.is(mockFetch.calls.length, 1);
});

rateLimitTest('aborted request does not consume a rate limit slot', async t => {
	const mockFetch = createMockFetch();
	const limitedFetch = withRateLimit({requestsPerInterval: 1, interval: 200})(mockFetch);

	await limitedFetch('/a');

	// Abort a waiting request
	const controller = new AbortController();
	const abortedPromise = limitedFetch('/b', {signal: controller.signal});
	controller.abort();
	await t.throwsAsync(abortedPromise, {name: 'AbortError'});

	await sleep(250);
	await expectImmediate(t, limitedFetch, '/c');
});

rateLimitTest('aborted deferred concurrency waits do not consume a rate-limit slot', async t => {
	const mockFetch = async url => {
		if (url === '/a') {
			await sleep(100);
		}

		return {ok: true, status: 200, url};
	};

	const limitedFetch = withConcurrency({maxConcurrentRequests: 1})(
		withRateLimit({requestsPerInterval: 2, interval: 1000})(mockFetch),
	);

	const first = limitedFetch('/a');

	const controller = new AbortController();
	const abortedPromise = limitedFetch('/b', {signal: controller.signal});
	setTimeout(() => {
		controller.abort();
	}, 20);

	await t.throwsAsync(abortedPromise, {name: 'AbortError'});
	await first;
	await expectImmediate(t, limitedFetch, '/c');
});

rateLimitTest('aborting after deferred concurrency slot acquisition does not leak a rate-limit reservation', async t => {
	const mockFetch = createMockFetch();
	const limitedFetch = withRateLimit({requestsPerInterval: 1, interval: 100})(mockFetch);
	const controller = new AbortController();

	const abortedPromise = limitedFetch('/a', {
		signal: controller.signal,
		async [waitForConcurrencySlotSymbol]() {
			controller.abort();
		},
	});

	await t.throwsAsync(abortedPromise, {name: 'AbortError'});
	await expectImmediate(t, limitedFetch, '/b');
	t.deepEqual(
		mockFetch.calls.map(call => call.url),
		['/b'],
	);
});

rateLimitTest('deferred concurrency waits still limit actual fetch starts per interval', async t => {
	const starts = [];
	const mockFetch = async url => {
		starts.push({url, time: Date.now()});
		if (url === '/a') {
			await sleep(220);
			return {ok: true, status: 200, url};
		}

		return {ok: true, status: 200, url};
	};

	const limitedFetch = withConcurrency({maxConcurrentRequests: 1})(
		withRateLimit({requestsPerInterval: 2, interval: 100})(mockFetch),
	);

	await Promise.all([
		limitedFetch('/a'),
		limitedFetch('/b'),
		limitedFetch('/c'),
		limitedFetch('/d'),
	]);

	const laterStarts = starts.slice(1).map(call => call.time);
	t.true(laterStarts[2] - laterStarts[0] >= 100, `Expected >= 100ms, got ${laterStarts[2] - laterStarts[0]}ms`);
});

rateLimitTest('already-aborted request does not consume an immediately available rate limit slot', async t => {
	const mockFetch = createMockFetch();
	const limitedFetch = withRateLimit({requestsPerInterval: 1, interval: 100})(mockFetch);

	await limitedFetch('/a');
	await sleep(150);

	const controller = new AbortController();
	controller.abort();

	await t.throwsAsync(
		limitedFetch('/b', {signal: controller.signal}),
		{name: 'AbortError'},
	);

	await expectImmediate(t, limitedFetch, '/c');
	t.deepEqual(
		mockFetch.calls.map(call => call.url),
		['/a', '/c'],
	);
});

rateLimitTest('inner withTimeout applies while waiting for a rate-limit slot', async t => {
	let callCount = 0;
	const mockFetch = async (_url, options = {}) => {
		callCount++;

		if (options.signal?.aborted) {
			const error = new Error('The operation was aborted');
			error.name = 'AbortError';
			throw error;
		}

		return {ok: true, status: 200};
	};

	const limitedFetch = withRateLimit({requestsPerInterval: 1, interval: 200})(withTimeout(50)(mockFetch));

	await limitedFetch('/a');

	const start = Date.now();
	await t.throwsAsync(limitedFetch('/b'), {name: 'TimeoutError'});
	const elapsed = Date.now() - start;

	t.true(elapsed < 150, `Expected < 150ms, got ${elapsed}ms`);
	t.is(callCount, 1);
});

rateLimitTest('inner withTimeout shares a single timeout budget across queueing and fetch', async t => {
	let callCount = 0;
	const mockFetch = async (_url, options = {}) => {
		callCount++;

		if (callCount === 1) {
			return {ok: true, status: 200};
		}

		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				resolve({ok: true, status: 200});
			}, 100);

			options.signal?.addEventListener('abort', () => {
				clearTimeout(timer);
				reject(options.signal.reason);
			}, {once: true});
		});
	};

	const limitedFetch = withRateLimit({requestsPerInterval: 1, interval: 60})(withTimeout(80)(mockFetch));

	await limitedFetch('/a');

	const start = Date.now();
	await t.throwsAsync(limitedFetch('/b'), {name: 'TimeoutError'});
	const elapsed = Date.now() - start;

	t.true(elapsed < 130, `Expected < 130ms, got ${elapsed}ms`);
	t.is(callCount, 2);
});

rateLimitTest('preserves FIFO order for queued requests', async t => {
	let currentTime = 0;
	const calls = [];

	await withMockTimers({
		getDateNow: () => currentTime,
		getPerformanceNow: () => currentTime,
	}, async ({runDueTimers}) => {
		const mockFetch = async url => {
			calls.push(url);
			return {ok: true, status: 200, url};
		};

		const limitedFetch = withRateLimit({requestsPerInterval: 1, interval: 100})(mockFetch);

		await limitedFetch('/a');
		const secondRequestPromise = limitedFetch('/b');

		currentTime = 100;
		const thirdRequestPromise = limitedFetch('/c');

		t.deepEqual(calls, ['/a']);

		await runDueTimers();

		t.deepEqual(calls, ['/a', '/b']);

		currentTime = 200;
		await runDueTimers();
		await Promise.all([secondRequestPromise, thirdRequestPromise]);

		t.deepEqual(calls, ['/a', '/b', '/c']);
	});
});

rateLimitTest('uses a monotonic clock when the wall clock moves backward', async t => {
	let monotonicTime = 0;
	let wallClockTime = 0;
	const calls = [];

	await withMockTimers({
		getDateNow: () => wallClockTime,
		getPerformanceNow: () => monotonicTime,
	}, async ({runDueTimers}) => {
		const mockFetch = async url => {
			calls.push(url);
			return {ok: true, status: 200, url};
		};

		const limitedFetch = withRateLimit({requestsPerInterval: 1, interval: 100})(mockFetch);

		await limitedFetch('/a');
		const secondRequestPromise = limitedFetch('/b');

		monotonicTime = 100;
		wallClockTime = -5000;
		await runDueTimers();
		await secondRequestPromise;

		t.deepEqual(calls, ['/a', '/b']);
	});
});

rateLimitTest('options.signal takes precedence over Request signal', async t => {
	const mockFetch = createMockFetch();
	const limitedFetch = withRateLimit({requestsPerInterval: 1, interval: 100})(mockFetch);
	const requestController = new AbortController();
	requestController.abort();
	const request = new Request('https://example.com', {signal: requestController.signal});

	await limitedFetch('/a');
	await sleep(150);

	const optionsController = new AbortController();
	await expectImmediate(t, limitedFetch, request, {signal: optionsController.signal});
	t.is(mockFetch.calls.length, 2);
});

rateLimitTest('copyFetchMetadata propagates timeout through withRateLimit', async t => {
	const mockFetch = async () => new Response(null, {status: 200});
	const fetchWithTimeout = withTimeout(5000)(mockFetch);
	const limitedFetch = withRateLimit({requestsPerInterval: 1, interval: 100})(fetchWithTimeout);
	const outerFetch = withHeaders({'X-Test': '1'})(limitedFetch);
	const {timeoutDurationSymbol} = await import('../source/utilities.js');

	t.is(outerFetch[timeoutDurationSymbol], 5000);
});

rateLimitTest('aborting the queued head allows the next queued request to proceed', async t => {
	const mockFetch = createMockFetch();
	const limitedFetch = withRateLimit({requestsPerInterval: 1, interval: 100})(mockFetch);

	await limitedFetch('/a');

	const controller = new AbortController();
	const abortedPromise = limitedFetch('/b', {signal: controller.signal});
	const nextRequestPromise = limitedFetch('/c');

	controller.abort();
	await t.throwsAsync(abortedPromise, {name: 'AbortError'});

	await sleep(150);
	await nextRequestPromise;

	t.deepEqual(
		mockFetch.calls.map(call => call.url),
		['/a', '/c'],
	);
});

rateLimitTest('timeout metadata still propagates through outer wrappers', async t => {
	const mockFetch = async () => new Response(null, {status: 200});
	const fetchWithTimeout = withTimeout(5000)(mockFetch);
	const limitedFetch = withRateLimit({requestsPerInterval: 1, interval: 100})(fetchWithTimeout);
	const wrappedFetch = withHeaders({'X-Test': '1'})(limitedFetch);
	const outerFetch = withHeaders({'X-Outer': '1'})(wrappedFetch);
	const {timeoutDurationSymbol} = await import('../source/utilities.js');

	t.is(outerFetch[timeoutDurationSymbol], 5000);
});

rateLimitTest('handles concurrent requests correctly', async t => {
	const mockFetch = createMockFetch();
	const limitedFetch = withRateLimit({requestsPerInterval: 2, interval: 200})(mockFetch);

	const start = Date.now();

	// Fire 4 requests concurrently: first 2 should be immediate, next 2 delayed
	await Promise.all([
		limitedFetch('/a'),
		limitedFetch('/b'),
		limitedFetch('/c'),
		limitedFetch('/d'),
	]);

	const elapsed = Date.now() - start;
	t.is(mockFetch.calls.length, 4);
	t.true(elapsed >= 150, `Expected >= 150ms, got ${elapsed}ms`);
});

rateLimitTest('throws on non-integer requestsPerInterval', t => {
	t.throws(() => withRateLimit({requestsPerInterval: 2.5, interval: 1000})(fetch), {
		instanceOf: TypeError,
	});
});

rateLimitTest('throws on zero requestsPerInterval', t => {
	t.throws(() => withRateLimit({requestsPerInterval: 0, interval: 1000})(fetch), {
		instanceOf: TypeError,
	});
});

rateLimitTest('throws on negative requestsPerInterval', t => {
	t.throws(() => withRateLimit({requestsPerInterval: -1, interval: 1000})(fetch), {
		instanceOf: TypeError,
	});
});

rateLimitTest('throws on zero interval', t => {
	t.throws(() => withRateLimit({requestsPerInterval: 1, interval: 0})(fetch), {
		instanceOf: TypeError,
	});
});

rateLimitTest('throws on negative interval', t => {
	t.throws(() => withRateLimit({requestsPerInterval: 1, interval: -1000})(fetch), {
		instanceOf: TypeError,
	});
});

rateLimitTest('throws on non-finite interval', t => {
	t.throws(() => withRateLimit({requestsPerInterval: 1, interval: Number.POSITIVE_INFINITY})(fetch), {
		instanceOf: TypeError,
	});
});

rateLimitTest('forwards request arguments to the inner fetch', async t => {
	let receivedUrl;
	let receivedOptions;
	const mockFetch = async (url, options = {}) => {
		receivedUrl = url;
		receivedOptions = options;
		return {ok: true, status: 200};
	};

	const limitedFetch = withRateLimit({requestsPerInterval: 10, interval: 1000})(mockFetch);

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

rateLimitTest('fetch errors propagate without corrupting rate limiter state', async t => {
	let callCount = 0;
	const mockFetch = async () => {
		callCount++;

		if (callCount === 2) {
			throw new TypeError('fetch failed');
		}

		return new Response('ok', {status: 200});
	};

	const limitedFetch = withRateLimit({requestsPerInterval: 10, interval: 1000})(mockFetch);

	await limitedFetch('/a');
	await t.throwsAsync(limitedFetch('/b'), {instanceOf: TypeError, message: 'fetch failed'});
	const response = await limitedFetch('/c');
	t.is(response.status, 200);
	t.is(callCount, 3);
});

rateLimitTest('sliding window allows new requests as old ones expire', async t => {
	const mockFetch = createMockFetch();
	const limitedFetch = withRateLimit({requestsPerInterval: 3, interval: 100})(mockFetch);

	// Fill 3 slots
	await limitedFetch('/a');
	await limitedFetch('/b');
	await sleep(60);
	await limitedFetch('/c');

	// Wait for first 2 slots to expire but not the 3rd
	await sleep(60);

	// 2 slots freed (/a and /b expired), 1 still occupied (/c)
	await expectImmediate(t, limitedFetch, '/d');
	await expectImmediate(t, limitedFetch, '/e');
	t.is(mockFetch.calls.length, 5);
});
