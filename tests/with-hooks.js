import test from 'ava';
import {
	withHooks,
	withTimeout,
	withBaseUrl,
	withHeaders,
	withJsonBody,
	withTokenRefresh,
	pipeline,
} from '../source/index.js';
import {resolveRequestHeadersSymbol, timeoutDurationSymbol} from '../source/utilities.js';

const createCapturingFetch = () => {
	const calls = [];

	const mockFetch = async (urlOrRequest, options = {}) => {
		calls.push({urlOrRequest, options});
		return new Response('ok', {status: 200});
	};

	mockFetch.calls = calls;
	return mockFetch;
};

const createRecordingHooks = contexts => ({
	beforeRequest(context) {
		contexts.push({hook: 'beforeRequest', ...context});
	},
	afterResponse(context) {
		contexts.push({hook: 'afterResponse', ...context});
	},
});

const assertRecordedAuthorization = (t, contexts, value) => {
	t.is(contexts[0].url, 'https://example.com/api');
	t.is(new Headers(contexts[0].options.headers).get('authorization'), value);
	t.is(contexts[1].url, 'https://example.com/api');
	t.is(new Headers(contexts[1].options.headers).get('authorization'), value);
};

const assertPublicTokenRefreshHookResponse = async (t, retryStatus) => {
	let fetchCallCount = 0;
	let beforeRequestCount = 0;
	let afterResponseCount = 0;
	const seenStatuses = [];
	const seenOptionAuthorizations = [];

	const fetchWithHooks = withHooks({
		beforeRequest({options}) {
			beforeRequestCount++;
			seenOptionAuthorizations.push(new Headers(options.headers).get('Authorization'));
		},
		afterResponse({response, options}) {
			afterResponseCount++;
			seenStatuses.push(response.status);
			seenOptionAuthorizations.push(new Headers(options.headers).get('Authorization'));
		},
	})(withTokenRefresh({
		async refreshToken() {
			return 'refreshed-token';
		},
	})(async (_url, options = {}) => {
		fetchCallCount++;
		const authorization = new Headers(options.headers).get('Authorization');

		if (authorization === 'Bearer refreshed-token') {
			return new Response(null, {status: retryStatus});
		}

		return new Response(null, {status: 401});
	}));

	const response = await fetchWithHooks('/api');

	t.is(response.status, retryStatus);
	t.is(fetchCallCount, 2);
	t.is(beforeRequestCount, 1);
	t.is(afterResponseCount, 1);
	t.deepEqual(seenStatuses, [retryStatus]);
	t.deepEqual(seenOptionAuthorizations, [null, null]);
};

test('beforeRequest - receives resolved URL and options', async t => {
	const mockFetch = createCapturingFetch();
	let receivedContext;

	const fetchWithHooks = withHooks({
		beforeRequest(context) {
			receivedContext = context;
		},
	})(mockFetch);

	await fetchWithHooks('https://example.com/api', {method: 'POST'});

	t.is(receivedContext.url, 'https://example.com/api');
	t.is(receivedContext.options.method, 'POST');
});

test('beforeRequest - returning options replaces them', async t => {
	const mockFetch = createCapturingFetch();

	const fetchWithHooks = withHooks({
		beforeRequest({options}) {
			return {...options, headers: {'X-Custom': 'value'}};
		},
	})(mockFetch);

	await fetchWithHooks('/api');

	const {options} = mockFetch.calls[0];
	t.deepEqual(options.headers, {'X-Custom': 'value'});
});

test('beforeRequest - returning undefined passes original options', async t => {
	const mockFetch = createCapturingFetch();

	const fetchWithHooks = withHooks({
		beforeRequest() {
			// Observation only
		},
	})(mockFetch);

	await fetchWithHooks('/api', {method: 'DELETE'});

	const {options} = mockFetch.calls[0];
	t.is(options.method, 'DELETE');
});

test('beforeRequest - returning a Response short-circuits the request', async t => {
	const mockFetch = createCapturingFetch();

	const fetchWithHooks = withHooks({
		beforeRequest() {
			return new Response('short-circuited', {status: 203});
		},
	})(mockFetch);

	const response = await fetchWithHooks('/api');

	t.is(response.status, 203);
	t.is(await response.text(), 'short-circuited');
	t.is(mockFetch.calls.length, 0);
});

test('beforeRequest short-circuit sees effective prepared headers in documented pipeline order', async t => {
	const mockFetch = createCapturingFetch();
	let observedAuthorization;

	const fetchWithAll = pipeline(
		mockFetch,
		withHeaders(async () => ({
			Authorization: 'Bearer prepared-token',
		})),
		withHooks({
			beforeRequest({options}) {
				observedAuthorization = new Headers(options.headers).get('authorization');
				return new Response('short-circuited', {status: 203});
			},
		}),
	);

	const response = await fetchWithAll('/api');

	t.is(response.status, 203);
	t.is(observedAuthorization, 'Bearer prepared-token');
	t.is(mockFetch.calls.length, 0);
});

test('beforeRequest short-circuit sees prepared serialized body in documented pipeline order', async t => {
	const mockFetch = createCapturingFetch();
	let observedBody;
	let observedContentType;

	const fetchWithAll = pipeline(
		mockFetch,
		withJsonBody(),
		withHooks({
			beforeRequest({options}) {
				observedBody = options.body;
				observedContentType = new Headers(options.headers).get('content-type');
				return new Response('short-circuited', {status: 203});
			},
		}),
	);

	const response = await fetchWithAll('/api', {
		method: 'POST',
		body: {
			name: 'Alice',
		},
	});

	t.is(response.status, 203);
	t.is(observedBody, '{"name":"Alice"}');
	t.is(observedContentType, 'application/json');
	t.is(mockFetch.calls.length, 0);
});

test('beforeRequest short-circuit sees inherited Request body in context', async t => {
	const mockFetch = createCapturingFetch();
	const request = new Request('https://example.com/api', {
		method: 'POST',
		body: 'payload',
		duplex: 'half',
	});
	const originalBody = request.body;
	let observedBody;

	const fetchWithHooks = withHooks({
		beforeRequest({options}) {
			observedBody = options.body;
			return new Response('short-circuited', {status: 203});
		},
	})(mockFetch);

	const response = await fetchWithHooks(request);

	t.is(response.status, 203);
	t.is(observedBody, originalBody);
	t.is(mockFetch.calls.length, 0);
});

test('beforeRequest - short-circuit skips afterResponse', async t => {
	const mockFetch = createCapturingFetch();
	let afterResponseCalled = false;

	const fetchWithHooks = withHooks({
		beforeRequest() {
			return new Response('early', {status: 200});
		},
		afterResponse() {
			afterResponseCalled = true;
		},
	})(mockFetch);

	await fetchWithHooks('/api');

	t.false(afterResponseCalled);
});

test('afterResponse - receives response, URL, and options', async t => {
	const mockFetch = createCapturingFetch();
	let receivedContext;

	const fetchWithHooks = withHooks({
		afterResponse(context) {
			receivedContext = context;
		},
	})(mockFetch);

	await fetchWithHooks('https://example.com/api', {method: 'GET'});

	t.is(receivedContext.url, 'https://example.com/api');
	t.is(receivedContext.options.method, 'GET');
	t.true(receivedContext.response instanceof Response);
	t.is(receivedContext.response.status, 200);
});

test('afterResponse - returning a Response replaces it', async t => {
	const mockFetch = createCapturingFetch();

	const fetchWithHooks = withHooks({
		afterResponse() {
			return new Response('replaced', {status: 201});
		},
	})(mockFetch);

	const response = await fetchWithHooks('/api');

	t.is(response.status, 201);
	t.is(await response.text(), 'replaced');
});

test('afterResponse - returning undefined passes original response', async t => {
	const mockFetch = createCapturingFetch();

	const fetchWithHooks = withHooks({
		afterResponse() {
			// Observation only
		},
	})(mockFetch);

	const response = await fetchWithHooks('/api');

	t.is(response.status, 200);
	t.is(await response.text(), 'ok');
});

test('both hooks together', async t => {
	const mockFetch = createCapturingFetch();
	const log = [];

	const fetchWithHooks = withHooks({
		beforeRequest({url}) {
			log.push(`before:${url}`);
		},
		afterResponse({url, response}) {
			log.push(`after:${url}:${response.status}`);
		},
	})(mockFetch);

	await fetchWithHooks('https://example.com/api');

	t.deepEqual(log, ['before:https://example.com/api', 'after:https://example.com/api:200']);
});

test('async hooks', async t => {
	const mockFetch = createCapturingFetch();

	const fetchWithHooks = withHooks({
		async beforeRequest({options}) {
			await new Promise(resolve => {
				setTimeout(resolve, 10);
			});

			return {...options, headers: {'X-Async': 'true'}};
		},
		async afterResponse() {
			await new Promise(resolve => {
				setTimeout(resolve, 10);
			});

			return new Response('async-replaced', {status: 202});
		},
	})(mockFetch);

	const response = await fetchWithHooks('/api');

	const {options} = mockFetch.calls[0];
	t.deepEqual(options.headers, {'X-Async': 'true'});
	t.is(response.status, 202);
	t.is(await response.text(), 'async-replaced');
});

test('beforeRequest aborts before an async hook settles', async t => {
	const controller = new AbortController();
	const mockFetch = createCapturingFetch();
	let resolveBeforeRequest;
	const beforeRequestStarted = new Promise(resolve => {
		resolveBeforeRequest = resolve;
	});

	const fetchWithHooks = withHooks({
		async beforeRequest() {
			resolveBeforeRequest();
			await new Promise(resolve => {
				setTimeout(resolve, 200);
			});
		},
	})(mockFetch);

	const fetchPromise = fetchWithHooks('/api', {signal: controller.signal});

	await beforeRequestStarted;
	controller.abort();

	const raceWinner = await Promise.race([
		fetchPromise.then(() => 'settled', () => 'settled'),
		new Promise(resolve => {
			setTimeout(() => {
				resolve('timeout');
			}, 50);
		}),
	]);

	t.is(raceWinner, 'settled');
	await t.throwsAsync(fetchPromise, {name: 'AbortError'});
	t.is(mockFetch.calls.length, 0);
});

test('afterResponse aborts before an async hook settles', async t => {
	const controller = new AbortController();
	const mockFetch = createCapturingFetch();
	let resolveAfterResponse;
	const afterResponseStarted = new Promise(resolve => {
		resolveAfterResponse = resolve;
	});

	const fetchWithHooks = withHooks({
		async afterResponse() {
			resolveAfterResponse();
			await new Promise(resolve => {
				setTimeout(resolve, 200);
			});
		},
	})(mockFetch);

	const fetchPromise = fetchWithHooks('/api', {signal: controller.signal});

	await afterResponseStarted;
	controller.abort();

	const raceWinner = await Promise.race([
		fetchPromise.then(() => 'settled', () => 'settled'),
		new Promise(resolve => {
			setTimeout(() => {
				resolve('timeout');
			}, 50);
		}),
	]);

	t.is(raceWinner, 'settled');
	await t.throwsAsync(fetchPromise, {name: 'AbortError'});
	t.is(mockFetch.calls.length, 1);
});

test('afterResponse receives modified options from beforeRequest', async t => {
	const mockFetch = createCapturingFetch();
	let afterOptions;

	const fetchWithHooks = withHooks({
		beforeRequest({options}) {
			return {...options, headers: {'X-Modified': 'true'}};
		},
		afterResponse({options}) {
			afterOptions = options;
		},
	})(mockFetch);

	await fetchWithHooks('/api');

	t.deepEqual(afterOptions.headers, {'X-Modified': 'true'});
});

test('no hooks provided - passthrough', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHooks = withHooks()(mockFetch);

	const response = await fetchWithHooks('/api', {method: 'POST'});

	t.is(response.status, 200);
	t.is(mockFetch.calls.length, 1);
	t.is(mockFetch.calls[0].options.method, 'POST');
});

test('error from fetch propagates', async t => {
	const error = new Error('Network error');
	const failingFetch = async () => {
		throw error;
	};

	const fetchWithHooks = withHooks({
		beforeRequest() {},
		afterResponse() {},
	})(failingFetch);

	await t.throwsAsync(fetchWithHooks('/api'), {message: 'Network error'});
});

test('error from beforeRequest propagates', async t => {
	const mockFetch = createCapturingFetch();

	const fetchWithHooks = withHooks({
		beforeRequest() {
			throw new Error('Hook error');
		},
	})(mockFetch);

	await t.throwsAsync(fetchWithHooks('/api'), {message: 'Hook error'});
	t.is(mockFetch.calls.length, 0);
});

test('error from afterResponse propagates', async t => {
	const mockFetch = createCapturingFetch();

	const fetchWithHooks = withHooks({
		afterResponse() {
			throw new Error('After hook error');
		},
	})(mockFetch);

	await t.throwsAsync(fetchWithHooks('/api'), {message: 'After hook error'});
});

test('preserves fetch metadata through copyFetchMetadata', t => {
	const mockFetch = createCapturingFetch();
	const fetchWithTimeout = withTimeout(5000)(mockFetch);

	const fetchWithHooks = withHooks({
		beforeRequest() {},
	})(fetchWithTimeout);

	t.is(fetchWithHooks[timeoutDurationSymbol], 5000);
});

test('withTimeout bounds async beforeRequest hooks in documented pipeline order', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHooks = pipeline(
		mockFetch,
		withTimeout(50),
		withHooks({
			async beforeRequest() {
				await new Promise(resolve => {
					setTimeout(resolve, 100);
				});
			},
		}),
	);

	const error = await t.throwsAsync(() => fetchWithHooks('/api'));

	t.is(error.name, 'TimeoutError');
	t.is(mockFetch.calls.length, 0);
});

test('withTimeout bounds async afterResponse hooks in documented pipeline order', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHooks = pipeline(
		mockFetch,
		withTimeout(50),
		withHooks({
			async afterResponse() {
				await new Promise(resolve => {
					setTimeout(resolve, 100);
				});
			},
		}),
	);

	const error = await t.throwsAsync(() => fetchWithHooks('/api'));

	t.is(error.name, 'TimeoutError');
	t.is(mockFetch.calls.length, 1);
});

test('withTimeout reuses one timeout budget across beforeRequest and fetch in documented pipeline order', async t => {
	let fetchCallCount = 0;
	const mockFetch = async (_urlOrRequest, options = {}) => {
		fetchCallCount++;

		return new Promise((resolve, reject) => {
			const timeout = setTimeout(() => {
				resolve(new Response('ok', {status: 200}));
			}, 30);

			options.signal?.addEventListener('abort', () => {
				clearTimeout(timeout);
				reject(options.signal.reason);
			}, {once: true});
		});
	};

	const fetchWithHooks = pipeline(
		mockFetch,
		withTimeout(50),
		withHooks({
			async beforeRequest() {
				await new Promise(resolve => {
					setTimeout(resolve, 30);
				});
			},
		}),
	);

	const error = await t.throwsAsync(() => fetchWithHooks('/api'));

	t.is(error.name, 'TimeoutError');
	t.is(fetchCallCount, 1);
});

test('completed hooks remove abort listeners from reused signals', async t => {
	const mockFetch = createCapturingFetch();
	const controller = new AbortController();
	const {signal} = controller;
	const originalAddEventListener = signal.addEventListener.bind(signal);
	const originalRemoveEventListener = signal.removeEventListener.bind(signal);
	const activeAbortListeners = new Set();

	signal.addEventListener = (type, listener, options) => {
		if (type === 'abort') {
			activeAbortListeners.add(listener);
		}

		return originalAddEventListener(type, listener, options);
	};

	signal.removeEventListener = (type, listener, options) => {
		if (type === 'abort') {
			activeAbortListeners.delete(listener);
		}

		return originalRemoveEventListener(type, listener, options);
	};

	t.teardown(() => {
		signal.addEventListener = originalAddEventListener;
		signal.removeEventListener = originalRemoveEventListener;
	});

	const fetchWithHooks = withHooks({
		async beforeRequest() {
			await Promise.resolve();
		},
	})(mockFetch);

	await fetchWithHooks('/api/1', {signal});
	await fetchWithHooks('/api/2', {signal});

	t.is(activeAbortListeners.size, 0);
});

test('beforeRequest - works with Request object as input', async t => {
	const mockFetch = createCapturingFetch();
	let receivedContext;

	const fetchWithHooks = withHooks({
		beforeRequest(context) {
			receivedContext = context;
		},
	})(mockFetch);

	const request = new Request('https://example.com/api', {method: 'PUT'});
	await fetchWithHooks(request);

	t.is(receivedContext.url, 'https://example.com/api');
	t.is(receivedContext.options.method, 'PUT');
	t.is(mockFetch.calls[0].urlOrRequest, request);
});

test('hooks receive inherited Request body in context', async t => {
	const mockFetch = createCapturingFetch();
	const contexts = [];
	const request = new Request('https://example.com/api', {
		method: 'POST',
		body: 'payload',
		duplex: 'half',
	});
	const originalBody = request.body;
	const fetchWithHooks = withHooks({
		beforeRequest(context) {
			contexts.push({hook: 'beforeRequest', ...context});
		},
		afterResponse(context) {
			contexts.push({hook: 'afterResponse', ...context});
		},
	})(mockFetch);

	await fetchWithHooks(request);

	t.is(contexts[0].options.body, originalBody);
	t.is(contexts[1].options.body, originalBody);
});

test('beforeRequest can merge inherited Request headers with object spread', async t => {
	const mockFetch = createCapturingFetch();
	const request = new Request('https://example.com/api', {
		method: 'POST',
		headers: {
			authorization: 'Bearer token',
			'content-type': 'application/json',
		},
		body: '{"name":"Alice"}',
		duplex: 'half',
	});
	const fetchWithHooks = withHooks({
		beforeRequest({options}) {
			return {
				...options,
				headers: {
					...options.headers,
					'x-request-id': 'request-123',
				},
			};
		},
	})(mockFetch);

	await fetchWithHooks(request);

	t.is(mockFetch.calls[0].options.headers.authorization, 'Bearer token');
	t.is(new Headers(mockFetch.calls[0].options.headers).get('content-type'), 'application/json');
	t.is(mockFetch.calls[0].options.headers['x-request-id'], 'request-123');
});

test('resolves URL through withBaseUrl', async t => {
	const mockFetch = createCapturingFetch();
	let receivedUrl;

	const fetchWithAll = pipeline(
		mockFetch,
		withBaseUrl('https://api.example.com'),
		withHooks({
			beforeRequest({url}) {
				receivedUrl = url;
			},
		}),
	);

	await fetchWithAll('/users');

	t.is(receivedUrl, 'https://api.example.com/users');
});

test('hooks receive effective request options in documented pipeline order', async t => {
	const mockFetch = createCapturingFetch();
	const contexts = [];

	const fetchWithAll = pipeline(
		mockFetch,
		withHeaders({authorization: 'Bearer token'}),
		withHooks({
			beforeRequest(context) {
				contexts.push({hook: 'beforeRequest', ...context});
			},
			afterResponse(context) {
				contexts.push({hook: 'afterResponse', ...context});
			},
		}),
	);

	await fetchWithAll('https://example.com/api');

	t.is(contexts[0].url, 'https://example.com/api');
	t.is(new Headers(contexts[0].options.headers).get('authorization'), 'Bearer token');
	t.is(contexts[1].url, 'https://example.com/api');
	t.is(new Headers(contexts[1].options.headers).get('authorization'), 'Bearer token');
});

test('hooks receive function-based default headers in documented pipeline order', async t => {
	const mockFetch = createCapturingFetch();
	const contexts = [];

	const fetchWithAll = pipeline(
		mockFetch,
		withHeaders(async () => ({authorization: 'Bearer dynamic-token'})),
		withHooks(createRecordingHooks(contexts)),
	);

	await fetchWithAll('https://example.com/api');

	assertRecordedAuthorization(t, contexts, 'Bearer dynamic-token');
});

test('hooks see per-call headers overriding function-based defaults in documented pipeline order', async t => {
	const mockFetch = createCapturingFetch();
	const contexts = [];

	const fetchWithAll = pipeline(
		mockFetch,
		withHeaders(async () => ({
			authorization: 'Bearer dynamic-token',
			'x-default': 'yes',
		})),
		withHooks(createRecordingHooks(contexts)),
	);

	await fetchWithAll('https://example.com/api', {
		headers: {
			authorization: 'Bearer override-token',
		},
	});

	assertRecordedAuthorization(t, contexts, 'Bearer override-token');
	t.is(new Headers(contexts[0].options.headers).get('x-default'), 'yes');
	t.is(new Headers(contexts[1].options.headers).get('x-default'), 'yes');
});

test('hooks and the actual request share the same resolved stateful default headers', async t => {
	const mockFetch = createCapturingFetch();
	const contexts = [];
	let tokenNumber = 0;

	const fetchWithAll = pipeline(
		mockFetch,
		withHeaders(() => {
			tokenNumber++;
			return {authorization: `Bearer token-${tokenNumber}`};
		}),
		withHooks(createRecordingHooks(contexts)),
	);

	await fetchWithAll('https://example.com/api');

	const requestAuthorization = new Headers(mockFetch.calls[0].options.headers).get('authorization');
	assertRecordedAuthorization(t, contexts, requestAuthorization);
});

test('hooks and the actual request share the same resolved custom request headers', async t => {
	const mockFetch = createCapturingFetch();
	const contexts = [];
	let headerNumber = 0;

	mockFetch[resolveRequestHeadersSymbol] = function () {
		headerNumber++;
		return new Headers({'x-dynamic': `value-${headerNumber}`});
	};

	const fetchWithHooks = withHooks(createRecordingHooks(contexts))(mockFetch);

	await fetchWithHooks('https://example.com/api');

	const requestHeader = new Headers(mockFetch.calls[0].options.headers).get('x-dynamic');
	t.is(requestHeader, 'value-1');
	t.is(new Headers(contexts[0].options.headers).get('x-dynamic'), requestHeader);
	t.is(new Headers(contexts[1].options.headers).get('x-dynamic'), requestHeader);
	t.is(headerNumber, 1);
});

test('beforeRequest that returns new options re-resolves function-based headers', async t => {
	const mockFetch = createCapturingFetch();
	let resolverCallCount = 0;

	const fetchWithAll = pipeline(
		mockFetch,
		withHeaders(() => {
			resolverCallCount++;
			return {authorization: `Bearer token-${resolverCallCount}`};
		}),
		withHooks({
			beforeRequest({options}) {
				return {
					...options,
					headers: {
						...Object.fromEntries(new Headers(options.headers)),
						'x-custom': 'injected',
					},
				};
			},
		}),
	);

	await fetchWithAll('https://example.com/api');

	const headers = new Headers(mockFetch.calls[0].options.headers);
	t.is(headers.get('x-custom'), 'injected');
	// The first resolution's authorization becomes a call header that overrides the re-resolved default
	t.is(headers.get('authorization'), 'Bearer token-1');
	t.is(resolverCallCount, 2);
});

test('beforeRequest that returns new options re-resolves custom resolved request headers', async t => {
	const mockFetch = createCapturingFetch();
	let resolverCallCount = 0;

	mockFetch[resolveRequestHeadersSymbol] = function (_urlOrRequest, options = {}) {
		resolverCallCount++;
		return new Headers({
			'x-dynamic': `${options.headers?.['x-custom'] ?? 'original'}-${resolverCallCount}`,
		});
	};

	const fetchWithHooks = withHooks({
		beforeRequest({options}) {
			return {
				...options,
				headers: {
					'x-custom': 'updated',
				},
			};
		},
	})(mockFetch);

	await fetchWithHooks('https://example.com/api');

	const headers = new Headers(mockFetch.calls[0].options.headers);
	t.is(headers.get('x-dynamic'), 'updated-2');
	t.is(resolverCallCount, 2);
});

test('afterResponse sees re-resolved custom request headers after beforeRequest returns new options', async t => {
	const mockFetch = createCapturingFetch();
	let afterResponseHeader;
	let resolverCallCount = 0;

	mockFetch[resolveRequestHeadersSymbol] = function (_urlOrRequest, options = {}) {
		resolverCallCount++;
		return new Headers({
			'x-dynamic': `${options.headers?.['x-custom'] ?? 'original'}-${resolverCallCount}`,
		});
	};

	const fetchWithHooks = withHooks({
		beforeRequest({options}) {
			return {
				...options,
				headers: {
					'x-custom': 'updated',
				},
			};
		},
		afterResponse({options}) {
			afterResponseHeader = new Headers(options.headers).get('x-dynamic');
		},
	})(mockFetch);

	await fetchWithHooks('https://example.com/api');

	t.is(new Headers(mockFetch.calls[0].options.headers).get('x-dynamic'), 'updated-2');
	t.is(afterResponseHeader, 'updated-2');
	t.is(resolverCallCount, 2);
});

test('afterResponse sees re-resolved function-based headers after beforeRequest returns new options', async t => {
	const mockFetch = createCapturingFetch();
	let resolverCallCount = 0;
	let afterResponseAuthorization;

	const fetchWithAll = pipeline(
		mockFetch,
		withHeaders(() => {
			resolverCallCount++;
			return {authorization: `Bearer token-${resolverCallCount}`};
		}),
		withHooks({
			beforeRequest({options}) {
				return {
					...options,
					headers: {
						...Object.fromEntries(new Headers(options.headers)),
						'x-custom': 'injected',
					},
				};
			},
			afterResponse({options}) {
				afterResponseAuthorization = new Headers(options.headers).get('authorization');
			},
		}),
	);

	await fetchWithAll('https://example.com/api');

	const headers = new Headers(mockFetch.calls[0].options.headers);
	t.is(headers.get('x-custom'), 'injected');
	t.is(headers.get('authorization'), 'Bearer token-1');
	t.is(afterResponseAuthorization, 'Bearer token-1');
	t.is(resolverCallCount, 2);
});

test('afterResponse sees the same resolved function-based headers as beforeRequest', async t => {
	const mockFetch = createCapturingFetch();
	let beforeHeaders;
	let afterHeaders;

	const fetchWithAll = pipeline(
		mockFetch,
		withHeaders(async () => ({'x-dynamic': 'resolved'})),
		withHooks({
			beforeRequest({options}) {
				beforeHeaders = new Headers(options.headers).get('x-dynamic');
			},
			afterResponse({options}) {
				afterHeaders = new Headers(options.headers).get('x-dynamic');
			},
		}),
	);

	await fetchWithAll('https://example.com/api');

	t.is(beforeHeaders, 'resolved');
	t.is(afterHeaders, 'resolved');
});

test('beforeRequest returning a new body re-resolves withJsonBody and afterResponse sees the same serialized body', async t => {
	const mockFetch = createCapturingFetch();
	let afterResponseBody;
	let afterResponseContentType;

	const fetchWithAll = pipeline(
		mockFetch,
		withJsonBody(),
		withHooks({
			beforeRequest({options}) {
				return {
					...options,
					body: {
						name: 'Bob',
					},
				};
			},
			afterResponse({options}) {
				afterResponseBody = options.body;
				afterResponseContentType = new Headers(options.headers).get('content-type');
			},
		}),
	);

	await fetchWithAll('https://example.com/api', {
		method: 'POST',
		body: {
			name: 'Alice',
		},
	});

	t.is(mockFetch.calls[0].options.body, '{"name":"Bob"}');
	t.is(new Headers(mockFetch.calls[0].options.headers).get('content-type'), 'application/json');
	t.is(afterResponseBody, '{"name":"Bob"}');
	t.is(afterResponseContentType, 'application/json');
});

test('only afterResponse without beforeRequest', async t => {
	const mockFetch = createCapturingFetch();
	let receivedContext;

	const fetchWithAll = pipeline(
		mockFetch,
		withBaseUrl('https://api.example.com'),
		withHooks({
			afterResponse(context) {
				receivedContext = context;
			},
		}),
	);

	const response = await fetchWithAll('/users', {method: 'POST'});

	t.is(response.status, 200);
	t.is(receivedContext.url, 'https://api.example.com/users');
	t.is(receivedContext.options.method, 'POST');
	t.true(receivedContext.response instanceof Response);
});

test('beforeRequest spread preserves resolved body from request-building wrappers', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithAll = pipeline(
		mockFetch,
		withJsonBody(),
		withHooks({
			beforeRequest({options}) {
				return {
					...options,
					headers: {
						...options.headers,
						'x-request-id': 'request-123',
					},
				};
			},
		}),
	);

	await fetchWithAll('https://example.com/api', {
		method: 'POST',
		body: {name: 'Alice'},
	});

	t.is(mockFetch.calls[0].options.body, '{"name":"Alice"}');
	t.is(mockFetch.calls[0].options.headers['content-type'], 'application/json');
	t.is(mockFetch.calls[0].options.headers['x-request-id'], 'request-123');
});

test('beforeRequest spread can clear an inherited Request body by changing method', async t => {
	let capturedRequest;

	const mockFetch = async (urlOrRequest, options = {}) => {
		capturedRequest = new Request(urlOrRequest, options);
		return new Response('ok', {status: 200});
	};

	const request = new Request('https://example.com/api', {
		method: 'POST',
		body: 'payload',
		duplex: 'half',
	});

	const fetchWithHooks = withHooks({
		beforeRequest({options}) {
			return {
				...options,
				method: 'GET',
			};
		},
	})(mockFetch);

	await fetchWithHooks(request);

	t.is(capturedRequest.method, 'GET');
	t.is(capturedRequest.body, null);
});

test('beforeRequest returning inherited Request body options unchanged does not trigger token refresh retry', async t => {
	let callCount = 0;
	let refreshCalled = false;

	const fetchWithHooks = withHooks({
		beforeRequest({options}) {
			return options;
		},
	})(withTokenRefresh({
		async refreshToken() {
			refreshCalled = true;
			return 'new-token';
		},
	})(async () => {
		callCount++;
		return new Response(null, {status: 401});
	}));

	const request = new Request('https://example.com/upload', {
		method: 'POST',
		body: 'payload',
		duplex: 'half',
	});

	const response = await fetchWithHooks(request);

	t.is(response.status, 401);
	t.is(callCount, 1);
	t.false(refreshCalled);
});

test('withHooks outside withTokenRefresh observes a failed refresh as one public 401 response', async t => {
	let fetchCallCount = 0;
	let beforeRequestCount = 0;
	let afterResponseCount = 0;
	let afterStatus;

	const fetchWithHooks = withHooks({
		beforeRequest() {
			beforeRequestCount++;
		},
		afterResponse({response}) {
			afterResponseCount++;
			afterStatus = response.status;
		},
	})(withTokenRefresh({
		async refreshToken() {
			throw new Error('refresh failed');
		},
	})(async () => {
		fetchCallCount++;
		return new Response(null, {status: 401});
	}));

	const response = await fetchWithHooks('/api');

	t.is(response.status, 401);
	t.is(fetchCallCount, 1);
	t.is(beforeRequestCount, 1);
	t.is(afterResponseCount, 1);
	t.is(afterStatus, 401);
});

test('withHooks outside withTokenRefresh observes a successful refresh as one public response', async t => {
	await assertPublicTokenRefreshHookResponse(t, 200);
});

test('withHooks outside withTokenRefresh observes retry 401 as one public response', async t => {
	await assertPublicTokenRefreshHookResponse(t, 401);
});

test('withHooks outside withTokenRefresh receives the final retried response object', async t => {
	let fetchCallCount = 0;
	let afterResponseHeader;
	let afterResponseText;

	const fetchWithHooks = withHooks({
		async afterResponse({response}) {
			afterResponseHeader = response.headers.get('x-retried');
			afterResponseText = await response.clone().text();
		},
	})(withTokenRefresh({
		async refreshToken() {
			return 'refreshed-token';
		},
	})(async (_url, options = {}) => {
		fetchCallCount++;
		const authorization = new Headers(options.headers).get('Authorization');

		if (authorization === 'Bearer refreshed-token') {
			return new Response('retried', {
				status: 200,
				headers: {
					'x-retried': 'yes',
				},
			});
		}

		return new Response('initial', {status: 401});
	}));

	const response = await fetchWithHooks('/api');

	t.is(response.status, 200);
	t.is(fetchCallCount, 2);
	t.is(afterResponseHeader, 'yes');
	t.is(afterResponseText, 'retried');
	t.is(response.headers.get('x-retried'), 'yes');
	t.is(await response.text(), 'retried');
});
