import test from 'ava';
import {withRetry} from '../source/with-retry.js';
import {withBaseUrl} from '../source/with-base-url.js';
import {
	pipeline,
	withHeaders,
	withHttpError,
	withTimeout,
	withUploadProgress,
} from '../source/index.js';
import {timeoutDurationSymbol} from '../source/utilities.js';

const createMockFetch = responses => {
	let callCount = 0;
	const calls = [];

	const mockFetch = async (url, options) => {
		const index = callCount++;
		calls.push({url, options});

		if (index < responses.length) {
			const item = responses[index];

			if (item instanceof Error) {
				throw item;
			}

			return item;
		}

		return new Response('ok', {status: 200});
	};

	Object.defineProperty(mockFetch, 'callCount', {get: () => callCount});
	Object.defineProperty(mockFetch, 'calls', {get: () => calls});
	return mockFetch;
};

const createResponse = (status, headers = {}) =>
	new Response(null, {status, headers});

const networkError = () => new TypeError('fetch failed');

test('succeeds on first attempt without retry', async t => {
	const mockFetch = createMockFetch([createResponse(200)]);
	const fetchWithRetry = withRetry(mockFetch);

	const response = await fetchWithRetry('https://example.com');
	t.is(response.status, 200);
	t.is(mockFetch.callCount, 1);
});

test('retries on network error and succeeds', async t => {
	const mockFetch = createMockFetch([
		networkError(),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {backoff: () => 0});

	const response = await fetchWithRetry('https://example.com');
	t.is(response.status, 200);
	t.is(mockFetch.callCount, 2);
});

test('retries on network error and succeeds for Request input', async t => {
	const mockFetch = createMockFetch([
		networkError(),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {backoff: () => 0});
	const request = new Request('https://example.com');

	const response = await fetchWithRetry(request);
	t.is(response.status, 200);
	t.is(mockFetch.callCount, 2);
});

test('retries on network error for Request input with overridden body', async t => {
	const mockFetch = createMockFetch([
		networkError(),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {backoff: () => 0});
	const request = new Request('https://example.com', {method: 'PUT'});

	const response = await fetchWithRetry(request, {body: 'data'});
	t.is(response.status, 200);
	t.is(mockFetch.callCount, 2);
});

test('retries on retriable status code and succeeds', async t => {
	const mockFetch = createMockFetch([
		createResponse(503),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {backoff: () => 0});

	const response = await fetchWithRetry('https://example.com');
	t.is(response.status, 200);
	t.is(mockFetch.callCount, 2);
});

test('does not retry on non-retriable status code', async t => {
	const mockFetch = createMockFetch([createResponse(400)]);
	const fetchWithRetry = withRetry(mockFetch, {backoff: () => 0});

	const response = await fetchWithRetry('https://example.com');
	t.is(response.status, 400);
	t.is(mockFetch.callCount, 1);
});

test('does not retry non-retriable methods by default', async t => {
	const mockFetch = createMockFetch([createResponse(503)]);
	const fetchWithRetry = withRetry(mockFetch, {backoff: () => 0});

	const response = await fetchWithRetry('https://example.com', {method: 'POST'});
	t.is(response.status, 503);
	t.is(mockFetch.callCount, 1);
});

test('retries POST when added to methods', async t => {
	const mockFetch = createMockFetch([
		createResponse(503),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {
		methods: ['POST'],
		backoff: () => 0,
	});

	const response = await fetchWithRetry('https://example.com', {method: 'POST'});
	t.is(response.status, 200);
	t.is(mockFetch.callCount, 2);
});

test('methods are case-insensitive', async t => {
	const mockFetch = createMockFetch([
		createResponse(503),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {backoff: () => 0});

	const response = await fetchWithRetry('https://example.com', {method: 'get'});
	t.is(response.status, 200);
	t.is(mockFetch.callCount, 2);
});

test('respects retries count', async t => {
	const mockFetch = createMockFetch([
		createResponse(503),
		createResponse(503),
		createResponse(503),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {retries: 2, backoff: () => 0});

	const response = await fetchWithRetry('https://example.com');
	t.is(response.status, 503);
	t.is(mockFetch.callCount, 3); // 1 initial + 2 retries
});

test('returns last response when all retries exhausted', async t => {
	const mockFetch = createMockFetch([
		createResponse(500),
		createResponse(502),
		createResponse(503),
	]);
	const fetchWithRetry = withRetry(mockFetch, {retries: 2, backoff: () => 0});

	const response = await fetchWithRetry('https://example.com');
	t.is(response.status, 503);
	t.is(mockFetch.callCount, 3);
});

test('throws last error when all retries exhausted on network errors', async t => {
	const mockFetch = createMockFetch([
		networkError(),
		networkError(),
		networkError(),
	]);
	const fetchWithRetry = withRetry(mockFetch, {retries: 2, backoff: () => 0});

	await t.throwsAsync(
		() => fetchWithRetry('https://example.com'),
		{instanceOf: TypeError},
	);
	t.is(mockFetch.callCount, 3);
});

test('does not retry non-TypeError exceptions', async t => {
	const mockFetch = createMockFetch([new Error('some error')]);
	const fetchWithRetry = withRetry(mockFetch, {backoff: () => 0});

	await t.throwsAsync(
		() => fetchWithRetry('https://example.com'),
		{message: 'some error'},
	);
	t.is(mockFetch.callCount, 1);
});

test('retries: 0 means no retries', async t => {
	const mockFetch = createMockFetch([createResponse(503)]);
	const fetchWithRetry = withRetry(mockFetch, {retries: 0});

	const response = await fetchWithRetry('https://example.com');
	t.is(response.status, 503);
	t.is(mockFetch.callCount, 1);
});

test('does not retry deterministic TypeErrors from invalid requests', async t => {
	let callCount = 0;
	const countingFetch = async (...arguments_) => {
		callCount++;
		return fetch(...arguments_);
	};

	const fetchWithRetry = withRetry(countingFetch, {retries: 2, backoff: () => 0});

	await t.throwsAsync(
		() => fetchWithRetry('http://[invalid-url'),
		{instanceOf: TypeError},
	);

	t.is(callCount, 1);
});

test('does not snapshot stream bodies when retries are disabled', async t => {
	const streamBody = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('hello'));
			controller.close();
		},
	});

	const mockFetch = createMockFetch([createResponse(200)]);
	const fetchWithRetry = withRetry(mockFetch, {retries: 0});

	await fetchWithRetry('https://example.com', {method: 'PUT', body: streamBody});
	t.is(mockFetch.callCount, 1);
	t.is(mockFetch.calls[0].options.body, streamBody);
});

test('does not retry ReadableStream bodies', async t => {
	const mockFetch = createMockFetch([
		createResponse(503),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {backoff: () => 0});
	const body = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('hello'));
			controller.close();
		},
	});

	const response = await fetchWithRetry('https://example.com', {
		method: 'PUT',
		body,
	});

	t.is(response.status, 503);
	t.is(mockFetch.callCount, 1);
	t.is(mockFetch.calls[0].options.body, body);
});

test('does not retry AsyncIterable bodies', async t => {
	const mockFetch = createMockFetch([
		createResponse(503),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {backoff: () => 0});
	const body = {
		async * [Symbol.asyncIterator]() {
			yield new TextEncoder().encode('hello');
		},
	};

	const response = await fetchWithRetry('https://example.com', {
		method: 'PUT',
		body,
		duplex: 'half',
	});

	t.is(response.status, 503);
	t.is(mockFetch.callCount, 1);
	t.is(mockFetch.calls[0].options.body, body);
});

test('custom backoff function is called with correct attempt number', async t => {
	const backoffCalls = [];
	const mockFetch = createMockFetch([
		createResponse(503),
		createResponse(503),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {
		retries: 3,
		backoff(attemptNumber) {
			backoffCalls.push(attemptNumber);
			return 0;
		},
	});

	await fetchWithRetry('https://example.com');
	t.deepEqual(backoffCalls, [1, 2]);
});

test('Retry-After header with integer seconds retries', async t => {
	const mockFetch = createMockFetch([
		createResponse(429, {'Retry-After': '0'}),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {backoff: () => 0});

	const response = await fetchWithRetry('https://example.com');
	t.is(response.status, 200);
	t.is(mockFetch.callCount, 2);
});

test('Retry-After: 0 uses zero delay instead of backoff', async t => {
	let backoffCalled = false;
	const mockFetch = createMockFetch([
		createResponse(429, {'Retry-After': '0'}),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {
		backoff() {
			backoffCalled = true;
			return 0;
		},
	});

	await fetchWithRetry('https://example.com');
	t.false(backoffCalled);
});

test('Retry-After exceeding maxRetryAfter stops retry', async t => {
	const mockFetch = createMockFetch([
		createResponse(429, {'Retry-After': '120'}),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {
		maxRetryAfter: 60_000,
		backoff: () => 0,
	});

	const response = await fetchWithRetry('https://example.com');
	t.is(response.status, 429);
	t.is(mockFetch.callCount, 1);
});

test('shouldRetry returning false stops retry on network error', async t => {
	const mockFetch = createMockFetch([
		networkError(),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {
		backoff: () => 0,
		shouldRetry: () => false,
	});

	await t.throwsAsync(
		() => fetchWithRetry('https://example.com'),
		{instanceOf: TypeError},
	);
	t.is(mockFetch.callCount, 1);
});

test('shouldRetry returning false stops retry on status code', async t => {
	const mockFetch = createMockFetch([
		createResponse(503),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {
		backoff: () => 0,
		shouldRetry: () => false,
	});

	const response = await fetchWithRetry('https://example.com');
	t.is(response.status, 503);
	t.is(mockFetch.callCount, 1);
});

test('shouldRetry receives correct context for network error', async t => {
	const contexts = [];
	const mockFetch = createMockFetch([
		networkError(),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {
		retries: 3,
		backoff: () => 0,
		shouldRetry(context) {
			contexts.push(context);
			return true;
		},
	});

	await fetchWithRetry('https://example.com');

	t.is(contexts.length, 1);
	t.true(contexts[0].error instanceof TypeError);
	t.is(contexts[0].response, undefined);
	t.is(contexts[0].attemptNumber, 1);
	t.is(contexts[0].retriesLeft, 3);
});

test('shouldRetry receives correct context for status code retry', async t => {
	const contexts = [];
	const mockFetch = createMockFetch([
		createResponse(503),
		createResponse(502),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {
		retries: 3,
		backoff: () => 0,
		shouldRetry(context) {
			contexts.push({
				hasError: context.error !== undefined,
				status: context.response?.status,
				attemptNumber: context.attemptNumber,
				retriesLeft: context.retriesLeft,
			});
			return true;
		},
	});

	await fetchWithRetry('https://example.com');

	t.is(contexts.length, 2);

	t.is(contexts[0].hasError, false);
	t.is(contexts[0].status, 503);
	t.is(contexts[0].attemptNumber, 1);
	t.is(contexts[0].retriesLeft, 3);

	t.is(contexts[1].hasError, false);
	t.is(contexts[1].status, 502);
	t.is(contexts[1].attemptNumber, 2);
	t.is(contexts[1].retriesLeft, 2);
});

test('async shouldRetry is supported', async t => {
	const mockFetch = createMockFetch([
		createResponse(503),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {
		backoff: () => 0,
		shouldRetry: () => Promise.resolve(true),
	});

	const response = await fetchWithRetry('https://example.com');
	t.is(response.status, 200);
});

test('abort signal cancels during backoff', async t => {
	const mockFetch = createMockFetch([
		createResponse(503),
		createResponse(200),
	]);
	const controller = new AbortController();
	const fetchWithRetry = withRetry(mockFetch, {
		backoff: () => 60_000,
	});

	setTimeout(() => {
		controller.abort();
	}, 50);

	await t.throwsAsync(
		() => fetchWithRetry('https://example.com', {signal: controller.signal}),
		{name: 'AbortError'},
	);
	t.is(mockFetch.callCount, 1);
});

test('does not retry bare Request body', async t => {
	const mockFetch = createMockFetch([createResponse(503)]);
	const fetchWithRetry = withRetry(mockFetch, {backoff: () => 0});
	const request = new Request('https://example.com', {
		method: 'PUT',
		body: 'data',
	});

	const response = await fetchWithRetry(request);
	t.is(response.status, 503);
	t.is(mockFetch.callCount, 1);
});

test('retries when body is provided in options (replayable)', async t => {
	const mockFetch = createMockFetch([
		createResponse(503),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {backoff: () => 0});

	const response = await fetchWithRetry('https://example.com', {
		method: 'PUT',
		body: 'data',
	});
	t.is(response.status, 200);
	t.is(mockFetch.callCount, 2);
});

test('preserves withUploadProgress when wrapping streamed uploads', async t => {
	const progressEvents = [];
	let callCount = 0;
	let transferredBytes = 0;
	const mockFetch = async (_url, options = {}) => {
		callCount++;

		for await (const chunk of options.body) {
			transferredBytes += chunk.byteLength;
		}

		return new Response(null, {status: 503});
	};

	const fetchWithRetry = pipeline(
		mockFetch,
		f => withRetry(f, {retries: 1, backoff: () => 0}),
		f => withUploadProgress(f, {
			onProgress(progress) {
				progressEvents.push(progress);
			},
		}),
	);
	const body = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('hello'));
			controller.close();
		},
	});

	const response = await fetchWithRetry('https://example.com', {
		method: 'PUT',
		body,
		duplex: 'half',
	});

	t.is(response.status, 503);
	t.is(callCount, 1);
	t.is(transferredBytes, 5);
	t.true(progressEvents.length > 0);
	t.like(progressEvents.at(-1), {
		percent: 1,
		transferredBytes: 5,
		totalBytes: 5,
	});
});

test('Request body overrides strip inherited body headers when retrying', async t => {
	let callCount = 0;
	const contentTypes = [];
	const contentLengths = [];
	const mockFetch = async (urlOrRequest, options = {}) => {
		callCount++;
		const request = new Request(urlOrRequest, options);
		contentTypes.push(request.headers.get('content-type'));
		contentLengths.push(request.headers.get('content-length'));

		return new Response(null, {status: callCount === 1 ? 503 : 200});
	};

	const fetchWithRetry = withRetry(mockFetch, {backoff: () => 0});
	const formData = new FormData();
	formData.append('field', 'value');
	const request = new Request('https://example.com/api', {
		method: 'PUT',
		body: 'original-body',
		headers: {
			'content-type': 'text/plain;charset=UTF-8',
			'content-length': '999',
		},
	});

	const response = await fetchWithRetry(request, {body: formData});
	t.is(response.status, 200);
	t.true(contentTypes[0].startsWith('multipart/form-data; boundary='));
	t.true(contentTypes[1].startsWith('multipart/form-data; boundary='));
	t.is(contentLengths[0], null);
	t.is(contentLengths[1], null);
});

test('Request body overrides strip inherited body headers when retried through inner withHeaders', async t => {
	let callCount = 0;
	const contentTypes = [];
	const contentLengths = [];
	const mockFetch = async (urlOrRequest, options = {}) => {
		callCount++;
		const request = new Request(urlOrRequest, options);
		contentTypes.push(request.headers.get('content-type'));
		contentLengths.push(request.headers.get('content-length'));

		return new Response(null, {status: callCount === 1 ? 503 : 200});
	};

	const fetchWithRetry = withRetry(withHeaders(mockFetch, {'x-default': 'value'}), {backoff: () => 0});
	const formData = new FormData();
	formData.append('field', 'value');
	const request = new Request('https://example.com/api', {
		method: 'PUT',
		body: 'original-body',
		headers: {
			'content-type': 'text/plain;charset=UTF-8',
			'content-length': '999',
		},
	});

	const response = await fetchWithRetry(request, {body: formData});
	t.is(response.status, 200);
	t.true(contentTypes[0].startsWith('multipart/form-data; boundary='));
	t.true(contentTypes[1].startsWith('multipart/form-data; boundary='));
	t.is(contentLengths[0], null);
	t.is(contentLengths[1], null);
});

test('Request body overrides strip inherited body headers when retried through outer withHeaders', async t => {
	let callCount = 0;
	const contentTypes = [];
	const contentLengths = [];
	const mockFetch = async (urlOrRequest, options = {}) => {
		callCount++;
		const request = new Request(urlOrRequest, options);
		contentTypes.push(request.headers.get('content-type'));
		contentLengths.push(request.headers.get('content-length'));

		return new Response(null, {status: callCount === 1 ? 503 : 200});
	};

	const fetchWithRetry = withHeaders(withRetry(mockFetch, {backoff: () => 0}), {'x-default': 'value'});
	const formData = new FormData();
	formData.append('field', 'value');
	const request = new Request('https://example.com/api', {
		method: 'PUT',
		body: 'original-body',
		headers: {
			'content-type': 'text/plain;charset=UTF-8',
			'content-length': '999',
		},
	});

	const response = await fetchWithRetry(request, {body: formData});
	t.is(response.status, 200);
	t.true(contentTypes[0].startsWith('multipart/form-data; boundary='));
	t.true(contentTypes[1].startsWith('multipart/form-data; boundary='));
	t.is(contentLengths[0], null);
	t.is(contentLengths[1], null);
});

test('composes with withHttpError in pipeline', async t => {
	const mockFetch = createMockFetch([
		createResponse(503),
		createResponse(200),
	]);
	const apiFetch = pipeline(
		mockFetch,
		f => withRetry(f, {backoff: () => 0}),
		withHttpError,
	);

	const response = await apiFetch('https://example.com');
	t.is(response.status, 200);
	t.is(mockFetch.callCount, 2);
});

test('retries network errors when composed outside withBaseUrl for relative URLs', async t => {
	const mockFetch = createMockFetch([
		networkError(),
		createResponse(200),
	]);
	const apiFetch = pipeline(
		mockFetch,
		f => withBaseUrl(f, 'https://api.example.com'),
		f => withRetry(f, {backoff: () => 0}),
	);

	const response = await apiFetch('/users');
	t.is(response.status, 200);
	t.is(mockFetch.callCount, 2);
	t.is(mockFetch.calls[0].url, 'https://api.example.com/users');
	t.is(mockFetch.calls[1].url, 'https://api.example.com/users');
});

test('does not retry timeout errors from withTimeout wrappers', async t => {
	let callCount = 0;
	const timedFetch = async (url, options = {}) => {
		callCount++;

		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				resolve(new Response('ok', {status: 200}));
			}, 50);

			options.signal?.addEventListener('abort', () => {
				clearTimeout(timeout);
				const error = new Error('The operation was aborted');
				error.name = 'AbortError';
				reject(error);
			}, {once: true});
		});
	};

	const fetchWithRetry = withRetry(withTimeout(timedFetch, 1), {retries: 1, backoff: () => 0});

	const error = await t.throwsAsync(
		() => fetchWithRetry('https://example.com'),
	);

	t.true(['AbortError', 'TimeoutError'].includes(error.name));
	t.is(callCount, 1);
});

test('withTimeout aborts retry backoff before the next attempt starts', async t => {
	let callCount = 0;
	const mockFetch = async (_url, options = {}) => {
		callCount++;

		if (options.signal?.aborted) {
			throw options.signal.reason;
		}

		return new Response(null, {status: 503});
	};

	const fetchWithRetry = withRetry(withTimeout(mockFetch, 50), {retries: 1, backoff: () => 100});

	const error = await t.throwsAsync(
		() => fetchWithRetry('https://example.com'),
	);

	t.is(error.name, 'TimeoutError');
	t.is(callCount, 1);
});

test('does not retry ReadableStream bodies when wrapping withTimeout', async t => {
	let callCount = 0;
	const timedFetch = async (_url, options = {}) => {
		callCount++;

		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				resolve(new Response(null, {status: 503}));
			}, 50);

			options.signal?.addEventListener('abort', () => {
				clearTimeout(timeout);
				reject(options.signal.reason);
			}, {once: true});
		});
	};

	const fetchWithRetry = withRetry(withTimeout(timedFetch, 10), {retries: 1, backoff: () => 0});
	const streamBody = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('hello'));
			controller.close();
		},
	});

	const error = await t.throwsAsync(
		() => fetchWithRetry('https://example.com', {method: 'PUT', body: streamBody, duplex: 'half'}),
	);

	t.is(error.name, 'TimeoutError');
	t.is(callCount, 1);
});

test('does not retry caller aborts when wrapping withTimeout', async t => {
	let callCount = 0;
	const timedFetch = async (url, options = {}) => {
		callCount++;

		if (options.signal?.aborted) {
			throw options.signal.reason;
		}

		return new Promise((resolve, reject) => {
			options.signal?.addEventListener('abort', () => {
				const error = new Error('The operation was aborted');
				error.name = 'AbortError';
				reject(error);
			}, {once: true});
		});
	};

	const abortController = new AbortController();
	const fetchWithRetry = withRetry(withTimeout(timedFetch, 1000), {retries: 1, backoff: () => 0});
	abortController.abort(new Error('caller aborted'));

	await t.throwsAsync(
		() => fetchWithRetry('https://example.com', {signal: abortController.signal}),
		{message: 'caller aborted'},
	);

	t.is(callCount, 1);
});

test('propagates metadata via copyFetchMetadata', t => {
	const mockFetch = createMockFetch([createResponse(200)]);
	mockFetch[timeoutDurationSymbol] = 5000;

	const fetchWithRetry = withRetry(mockFetch);
	t.is(fetchWithRetry[timeoutDurationSymbol], 5000);
});

test('custom statusCodes option', async t => {
	const mockFetch = createMockFetch([
		createResponse(418),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {
		statusCodes: [418],
		backoff: () => 0,
	});

	const response = await fetchWithRetry('https://example.com');
	t.is(response.status, 200);
	t.is(mockFetch.callCount, 2);
});

test('default status codes are not retried when custom statusCodes overrides them', async t => {
	const mockFetch = createMockFetch([createResponse(503)]);
	const fetchWithRetry = withRetry(mockFetch, {
		statusCodes: [418],
		backoff: () => 0,
	});

	const response = await fetchWithRetry('https://example.com');
	t.is(response.status, 503);
	t.is(mockFetch.callCount, 1);
});

test('throws on invalid retries value', t => {
	t.throws(() => withRetry(fetch, {retries: -1}), {
		instanceOf: TypeError,
		message: '`retries` must be a non-negative integer.',
	});

	t.throws(() => withRetry(fetch, {retries: 1.5}), {
		instanceOf: TypeError,
		message: '`retries` must be a non-negative integer.',
	});
});

test('extracts method from Request object', async t => {
	const mockFetch = createMockFetch([createResponse(503)]);
	const fetchWithRetry = withRetry(mockFetch, {backoff: () => 0});

	const request = new Request('https://example.com', {method: 'POST'});
	const response = await fetchWithRetry(request, {});
	t.is(response.status, 503);
	t.is(mockFetch.callCount, 1); // POST not retried
});

test('defaults to GET method when not specified', async t => {
	const mockFetch = createMockFetch([
		createResponse(503),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {backoff: () => 0});

	const response = await fetchWithRetry('https://example.com');
	t.is(response.status, 200);
	t.is(mockFetch.callCount, 2); // GET is retried
});

const verifyRetriableStatus = async (t, status) => {
	const mockFetch = createMockFetch([
		createResponse(status),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {backoff: () => 0});

	const response = await fetchWithRetry('https://example.com');
	t.is(response.status, 200);
	t.is(mockFetch.callCount, 2);
};

for (const status of [408, 429, 500, 502, 503, 504]) {
	test(`retries on status ${status}`, verifyRetriableStatus, status);
}

test('Retry-After with HTTP-date format', async t => {
	let backoffCalled = false;
	const futureDate = new Date(Date.now() + 2000).toUTCString();
	const mockFetch = createMockFetch([
		createResponse(429, {'Retry-After': futureDate}),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {
		maxRetryAfter: 10_000,
		backoff() {
			backoffCalled = true;
			return 0;
		},
	});

	const response = await fetchWithRetry('https://example.com');
	t.is(response.status, 200);
	t.is(mockFetch.callCount, 2);
	t.false(backoffCalled);
});

test('Retry-After with past HTTP-date falls back to backoff', async t => {
	const pastDate = new Date(Date.now() - 10_000).toUTCString();
	let backoffCalled = false;
	const mockFetch = createMockFetch([
		createResponse(429, {'Retry-After': pastDate}),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {
		backoff() {
			backoffCalled = true;
			return 0;
		},
	});

	const response = await fetchWithRetry('https://example.com');
	t.is(response.status, 200);
	t.true(backoffCalled);
});

test('Retry-After with invalid string falls back to backoff', async t => {
	let backoffCalled = false;
	const mockFetch = createMockFetch([
		createResponse(429, {'Retry-After': 'garbage'}),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {
		backoff() {
			backoffCalled = true;
			return 0;
		},
	});

	const response = await fetchWithRetry('https://example.com');
	t.is(response.status, 200);
	t.true(backoffCalled);
});

test('retries: 0 does not retry network errors', async t => {
	const mockFetch = createMockFetch([networkError()]);
	const fetchWithRetry = withRetry(mockFetch, {retries: 0});

	await t.throwsAsync(
		() => fetchWithRetry('https://example.com'),
		{instanceOf: TypeError},
	);
	t.is(mockFetch.callCount, 1);
});

test('retries: 1 makes exactly 2 total attempts', async t => {
	const mockFetch = createMockFetch([
		createResponse(503),
		createResponse(503),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {retries: 1, backoff: () => 0});

	const response = await fetchWithRetry('https://example.com');
	t.is(response.status, 503);
	t.is(mockFetch.callCount, 2);
});

test('async shouldRetry returning false stops retry', async t => {
	const mockFetch = createMockFetch([
		createResponse(503),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {
		backoff: () => 0,
		async shouldRetry() {
			return false;
		},
	});

	const response = await fetchWithRetry('https://example.com');
	t.is(response.status, 503);
	t.is(mockFetch.callCount, 1);
});

test('negative Retry-After integer falls back to backoff', async t => {
	let backoffCalled = false;
	const mockFetch = createMockFetch([
		createResponse(429, {'Retry-After': '-5'}),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {
		backoff() {
			backoffCalled = true;
			return 0;
		},
	});

	const response = await fetchWithRetry('https://example.com');
	t.is(response.status, 200);
	t.true(backoffCalled);
});

test('Retry-After exactly at maxRetryAfter still retries', async t => {
	const mockFetch = createMockFetch([
		createResponse(429, {'Retry-After': '1'}),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {
		maxRetryAfter: 1000,
		backoff: () => 0,
	});

	const response = await fetchWithRetry('https://example.com');
	t.is(response.status, 200);
	t.is(mockFetch.callCount, 2);
});

test('retries with URL object input', async t => {
	const mockFetch = createMockFetch([
		createResponse(503),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {backoff: () => 0});

	const response = await fetchWithRetry(new URL('https://example.com'));
	t.is(response.status, 200);
	t.is(mockFetch.callCount, 2);
});

test('handles mixed network error then status code error across retries', async t => {
	const mockFetch = createMockFetch([
		networkError(),
		createResponse(503),
		createResponse(200),
	]);
	const fetchWithRetry = withRetry(mockFetch, {retries: 3, backoff: () => 0});

	const response = await fetchWithRetry('https://example.com');
	t.is(response.status, 200);
	t.is(mockFetch.callCount, 3);
});
