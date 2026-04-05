import test from 'ava';
import {
	withHooks,
	withTimeout,
	withBaseUrl,
	withHeaders,
	withJsonBody,
	pipeline,
} from '../source/index.js';
import {timeoutDurationSymbol} from '../source/utilities.js';

const createCapturingFetch = () => {
	const calls = [];

	const mockFetch = async (urlOrRequest, options = {}) => {
		calls.push({urlOrRequest, options});
		return new Response('ok', {status: 200});
	};

	mockFetch.calls = calls;
	return mockFetch;
};

test('beforeRequest - receives resolved URL and options', async t => {
	const mockFetch = createCapturingFetch();
	let receivedContext;

	const fetchWithHooks = withHooks(mockFetch, {
		beforeRequest(context) {
			receivedContext = context;
		},
	});

	await fetchWithHooks('https://example.com/api', {method: 'POST'});

	t.is(receivedContext.url, 'https://example.com/api');
	t.is(receivedContext.options.method, 'POST');
});

test('beforeRequest - returning options replaces them', async t => {
	const mockFetch = createCapturingFetch();

	const fetchWithHooks = withHooks(mockFetch, {
		beforeRequest({options}) {
			return {...options, headers: {'X-Custom': 'value'}};
		},
	});

	await fetchWithHooks('/api');

	const {options} = mockFetch.calls[0];
	t.deepEqual(options.headers, {'X-Custom': 'value'});
});

test('beforeRequest - returning undefined passes original options', async t => {
	const mockFetch = createCapturingFetch();

	const fetchWithHooks = withHooks(mockFetch, {
		beforeRequest() {
			// Observation only
		},
	});

	await fetchWithHooks('/api', {method: 'DELETE'});

	const {options} = mockFetch.calls[0];
	t.is(options.method, 'DELETE');
});

test('beforeRequest - returning a Response short-circuits the request', async t => {
	const mockFetch = createCapturingFetch();

	const fetchWithHooks = withHooks(mockFetch, {
		beforeRequest() {
			return new Response('short-circuited', {status: 203});
		},
	});

	const response = await fetchWithHooks('/api');

	t.is(response.status, 203);
	t.is(await response.text(), 'short-circuited');
	t.is(mockFetch.calls.length, 0);
});

test('beforeRequest - short-circuit skips afterResponse', async t => {
	const mockFetch = createCapturingFetch();
	let afterResponseCalled = false;

	const fetchWithHooks = withHooks(mockFetch, {
		beforeRequest() {
			return new Response('early', {status: 200});
		},
		afterResponse() {
			afterResponseCalled = true;
		},
	});

	await fetchWithHooks('/api');

	t.false(afterResponseCalled);
});

test('afterResponse - receives response, URL, and options', async t => {
	const mockFetch = createCapturingFetch();
	let receivedContext;

	const fetchWithHooks = withHooks(mockFetch, {
		afterResponse(context) {
			receivedContext = context;
		},
	});

	await fetchWithHooks('https://example.com/api', {method: 'GET'});

	t.is(receivedContext.url, 'https://example.com/api');
	t.is(receivedContext.options.method, 'GET');
	t.true(receivedContext.response instanceof Response);
	t.is(receivedContext.response.status, 200);
});

test('afterResponse - returning a Response replaces it', async t => {
	const mockFetch = createCapturingFetch();

	const fetchWithHooks = withHooks(mockFetch, {
		afterResponse() {
			return new Response('replaced', {status: 201});
		},
	});

	const response = await fetchWithHooks('/api');

	t.is(response.status, 201);
	t.is(await response.text(), 'replaced');
});

test('afterResponse - returning undefined passes original response', async t => {
	const mockFetch = createCapturingFetch();

	const fetchWithHooks = withHooks(mockFetch, {
		afterResponse() {
			// Observation only
		},
	});

	const response = await fetchWithHooks('/api');

	t.is(response.status, 200);
	t.is(await response.text(), 'ok');
});

test('both hooks together', async t => {
	const mockFetch = createCapturingFetch();
	const log = [];

	const fetchWithHooks = withHooks(mockFetch, {
		beforeRequest({url}) {
			log.push(`before:${url}`);
		},
		afterResponse({url, response}) {
			log.push(`after:${url}:${response.status}`);
		},
	});

	await fetchWithHooks('https://example.com/api');

	t.deepEqual(log, ['before:https://example.com/api', 'after:https://example.com/api:200']);
});

test('async hooks', async t => {
	const mockFetch = createCapturingFetch();

	const fetchWithHooks = withHooks(mockFetch, {
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
	});

	const response = await fetchWithHooks('/api');

	const {options} = mockFetch.calls[0];
	t.deepEqual(options.headers, {'X-Async': 'true'});
	t.is(response.status, 202);
	t.is(await response.text(), 'async-replaced');
});

test('afterResponse receives modified options from beforeRequest', async t => {
	const mockFetch = createCapturingFetch();
	let afterOptions;

	const fetchWithHooks = withHooks(mockFetch, {
		beforeRequest({options}) {
			return {...options, headers: {'X-Modified': 'true'}};
		},
		afterResponse({options}) {
			afterOptions = options;
		},
	});

	await fetchWithHooks('/api');

	t.deepEqual(afterOptions.headers, {'X-Modified': 'true'});
});

test('no hooks provided - passthrough', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHooks = withHooks(mockFetch);

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

	const fetchWithHooks = withHooks(failingFetch, {
		beforeRequest() {},
		afterResponse() {},
	});

	await t.throwsAsync(fetchWithHooks('/api'), {message: 'Network error'});
});

test('error from beforeRequest propagates', async t => {
	const mockFetch = createCapturingFetch();

	const fetchWithHooks = withHooks(mockFetch, {
		beforeRequest() {
			throw new Error('Hook error');
		},
	});

	await t.throwsAsync(fetchWithHooks('/api'), {message: 'Hook error'});
	t.is(mockFetch.calls.length, 0);
});

test('error from afterResponse propagates', async t => {
	const mockFetch = createCapturingFetch();

	const fetchWithHooks = withHooks(mockFetch, {
		afterResponse() {
			throw new Error('After hook error');
		},
	});

	await t.throwsAsync(fetchWithHooks('/api'), {message: 'After hook error'});
});

test('preserves fetch metadata through copyFetchMetadata', t => {
	const mockFetch = createCapturingFetch();
	const fetchWithTimeout = withTimeout(mockFetch, 5000);

	const fetchWithHooks = withHooks(fetchWithTimeout, {
		beforeRequest() {},
	});

	t.is(fetchWithHooks[timeoutDurationSymbol], 5000);
});

test('withTimeout bounds async beforeRequest hooks in documented pipeline order', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHooks = pipeline(
		mockFetch,
		fetchFunction => withTimeout(fetchFunction, 50),
		fetchFunction => withHooks(fetchFunction, {
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
		fetchFunction => withTimeout(fetchFunction, 50),
		fetchFunction => withHooks(fetchFunction, {
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

test('beforeRequest - works with Request object as input', async t => {
	const mockFetch = createCapturingFetch();
	let receivedContext;

	const fetchWithHooks = withHooks(mockFetch, {
		beforeRequest(context) {
			receivedContext = context;
		},
	});

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
	const fetchWithHooks = withHooks(mockFetch, {
		beforeRequest(context) {
			contexts.push({hook: 'beforeRequest', ...context});
		},
		afterResponse(context) {
			contexts.push({hook: 'afterResponse', ...context});
		},
	});

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
	const fetchWithHooks = withHooks(mockFetch, {
		beforeRequest({options}) {
			return {
				...options,
				headers: {
					...options.headers,
					'x-request-id': 'request-123',
				},
			};
		},
	});

	await fetchWithHooks(request);

	t.is(mockFetch.calls[0].options.headers.authorization, 'Bearer token');
	t.is(mockFetch.calls[0].options.headers['content-type'], 'application/json');
	t.is(mockFetch.calls[0].options.headers['x-request-id'], 'request-123');
});

test('resolves URL through withBaseUrl', async t => {
	const mockFetch = createCapturingFetch();
	let receivedUrl;

	const fetchWithAll = pipeline(
		mockFetch,
		f => withBaseUrl(f, 'https://api.example.com'),
		f => withHooks(f, {
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
		fetchFunction => withHeaders(fetchFunction, {authorization: 'Bearer token'}),
		fetchFunction => withHooks(fetchFunction, {
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

test('only afterResponse without beforeRequest', async t => {
	const mockFetch = createCapturingFetch();
	let receivedContext;

	const fetchWithAll = pipeline(
		mockFetch,
		f => withBaseUrl(f, 'https://api.example.com'),
		f => withHooks(f, {
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
		withJsonBody,
		fetchFunction => withHooks(fetchFunction, {
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

	const fetchWithHooks = withHooks(mockFetch, {
		beforeRequest({options}) {
			return {
				...options,
				method: 'GET',
			};
		},
	});

	await fetchWithHooks(request);

	t.is(capturedRequest.method, 'GET');
	t.is(capturedRequest.body, null);
});
