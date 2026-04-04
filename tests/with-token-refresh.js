import test from 'ava';
import {
	withTokenRefresh,
	withHttpError,
	HttpError,
	withBaseUrl,
	withHeaders,
	withUploadProgress,
	withTimeout,
} from '../source/index.js';

const createMockFetch = ({initialStatus = 401, retryStatus = 200} = {}) => {
	let callCount = 0;
	const mockFetch = async (url, options = {}) => {
		callCount++;
		const status = callCount === 1 ? initialStatus : retryStatus;
		return {
			ok: status >= 200 && status < 300,
			status,
			statusText: status === 200 ? 'OK' : 'Unauthorized',
			url: typeof url === 'string' ? url : url.url,
			headers: new Headers(options.headers),
		};
	};

	return {mockFetch, getCallCount: () => callCount};
};

const createBodyOverrideRequest = (headers, body = 'original-body') => new Request('https://example.com/api', {
	method: 'POST',
	body,
	headers,
});

const createFormDataBody = () => {
	const formData = new FormData();
	formData.append('field', 'value');
	return formData;
};

const createRecordedResponseFetch = ({initialStatus = 401, retryStatus = 200, onRequest}) => {
	let callCount = 0;

	return async (urlOrRequest, options = {}) => {
		callCount++;
		onRequest?.(new Request(urlOrRequest, options), callCount);

		return new Response(null, {status: callCount === 1 ? initialStatus : retryStatus});
	};
};

test('passes through non-401 responses without refreshing', async t => {
	const {mockFetch, getCallCount} = createMockFetch({initialStatus: 200});
	let refreshCalled = false;

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCalled = true;
			return 'new-token';
		},
	});

	const response = await fetchWithRefresh('/api/users');
	t.is(response.status, 200);
	t.is(getCallCount(), 1);
	t.false(refreshCalled);
});

test('refreshes token and retries on 401', async t => {
	const {mockFetch, getCallCount} = createMockFetch({initialStatus: 401, retryStatus: 200});

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	const response = await fetchWithRefresh('/api/users');
	t.is(response.status, 200);
	t.is(getCallCount(), 2);
	t.is(response.headers.get('Authorization'), 'Bearer new-token');
});

test('cancels the discarded 401 response body before retrying', async t => {
	let callCount = 0;
	let canceled401Body = false;

	const mockFetch = async (url, options = {}) => {
		callCount++;

		if (callCount === 1) {
			return new Response(new ReadableStream({
				cancel() {
					canceled401Body = true;
				},
			}), {status: 401});
		}

		t.true(canceled401Body);

		return new Response(null, {
			status: 200,
			headers: new Headers(options.headers),
		});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	const response = await fetchWithRefresh('/api/users');
	t.is(response.status, 200);
	t.true(canceled401Body);
});

test('returns original 401 response when refreshToken throws', async t => {
	const {mockFetch, getCallCount} = createMockFetch({initialStatus: 401});

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			throw new Error('Refresh failed');
		},
	});

	const response = await fetchWithRefresh('/api/users');
	t.is(response.status, 401);
	t.is(getCallCount(), 1);
});

test('only retries once even if retry returns 401', async t => {
	const {mockFetch, getCallCount} = createMockFetch({initialStatus: 401, retryStatus: 401});

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	const response = await fetchWithRefresh('/api/users');
	t.is(response.status, 401);
	t.is(getCallCount(), 2);
});

test('refreshes successfully after a prior refresh failure', async t => {
	let refreshCount = 0;

	const mockFetch = async (url, options = {}) => {
		const isRetry = options.headers && new Headers(options.headers).has('Authorization');
		const status = isRetry ? 200 : 401;
		return {
			ok: status === 200,
			status,
			statusText: status === 200 ? 'OK' : 'Unauthorized',
			url,
			headers: new Headers(options.headers),
		};
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCount++;
			if (refreshCount === 1) {
				throw new Error('Refresh failed');
			}

			return 'new-token';
		},
	});

	const response1 = await fetchWithRefresh('/api/a');
	t.is(response1.status, 401);

	const response2 = await fetchWithRefresh('/api/b');
	t.is(response2.status, 200);
	t.is(refreshCount, 2);
});

test('deduplicates concurrent refresh calls', async t => {
	let refreshCount = 0;
	let callCount = 0;

	const mockFetch = async (url, options = {}) => {
		callCount++;
		const isRetry = options.headers && new Headers(options.headers).has('Authorization');
		const status = isRetry ? 200 : 401;
		return {
			ok: status === 200,
			status,
			statusText: status === 200 ? 'OK' : 'Unauthorized',
			url,
			headers: new Headers(options.headers),
		};
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCount++;
			await new Promise(resolve => {
				setTimeout(resolve, 50);
			});
			return 'new-token';
		},
	});

	const [response1, response2, response3] = await Promise.all([
		fetchWithRefresh('/api/a'),
		fetchWithRefresh('/api/b'),
		fetchWithRefresh('/api/c'),
	]);

	t.is(response1.status, 200);
	t.is(response2.status, 200);
	t.is(response3.status, 200);
	t.is(refreshCount, 1);
	t.is(callCount, 6);
});

test('retries Request input and preserves its headers', async t => {
	let callCount = 0;
	let retryHeaders;
	const mockFetch = async (urlOrRequest, options = {}) => {
		callCount++;
		const url = typeof urlOrRequest === 'string' ? urlOrRequest : urlOrRequest.url;
		const status = callCount === 1 ? 401 : 200;

		if (callCount === 2) {
			retryHeaders = new Headers(options.headers);
		}

		return {
			ok: status === 200,
			status,
			statusText: status === 200 ? 'OK' : 'Unauthorized',
			url,
			headers: new Headers(options.headers),
		};
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	const request = new Request('https://example.com/api/users', {
		method: 'GET',
		headers: {'Content-Type': 'application/json', 'X-Custom': 'value'},
	});

	const response = await fetchWithRefresh(request);
	t.is(response.status, 200);
	t.is(callCount, 2);
	t.is(retryHeaders.get('Authorization'), 'Bearer new-token');
	t.is(retryHeaders.get('Content-Type'), 'application/json');
	t.is(retryHeaders.get('X-Custom'), 'value');
});

test('Request input merges Request headers into the initial attempt when options.headers is provided', async t => {
	let initialHeaders;

	const mockFetch = async (urlOrRequest, options = {}) => {
		initialHeaders = new Headers(new Request(urlOrRequest, options).headers);
		return new Response(null, {status: 200});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	const request = new Request('https://example.com/api/users', {
		headers: {
			Authorization: 'Bearer request-token',
			Accept: 'application/json',
			'X-CSRF': 'csrf-token',
		},
	});

	const response = await fetchWithRefresh(request, {
		headers: {
			'X-Trace': 'trace-id',
		},
	});

	t.is(response.status, 200);
	t.is(initialHeaders.get('Authorization'), 'Bearer request-token');
	t.is(initialHeaders.get('Accept'), 'application/json');
	t.is(initialHeaders.get('X-CSRF'), 'csrf-token');
	t.is(initialHeaders.get('X-Trace'), 'trace-id');
});

test('successful Request input does not clone the request body', async t => {
	let cloneCount = 0;

	class TrackingRequest extends Request {
		clone() {
			cloneCount++;
			return super.clone();
		}
	}

	const mockFetch = async () => new Response(null, {status: 200});

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	const request = new TrackingRequest('https://example.com/api/users', {
		method: 'POST',
		body: 'request-body',
	});

	const response = await fetchWithRefresh(request);
	t.is(response.status, 200);
	t.is(cloneCount, 0);
});

test('passes through non-401 error responses without refreshing', async t => {
	const {mockFetch, getCallCount} = createMockFetch({initialStatus: 500});
	let refreshCalled = false;

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCalled = true;
			return 'new-token';
		},
	});

	const response = await fetchWithRefresh('/api/users');
	t.is(response.status, 500);
	t.is(getCallCount(), 1);
	t.false(refreshCalled);
});

test('handles successive 401s with separate refresh calls', async t => {
	let refreshCount = 0;
	let callCount = 0;

	const mockFetch = async (url, options = {}) => {
		callCount++;
		const isRetry = options.headers && new Headers(options.headers).has('Authorization');
		const status = isRetry ? 200 : 401;
		return {
			ok: status === 200,
			status,
			statusText: status === 200 ? 'OK' : 'Unauthorized',
			url,
			headers: new Headers(options.headers),
		};
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCount++;
			return `token-${refreshCount}`;
		},
	});

	const response1 = await fetchWithRefresh('/api/a');
	t.is(response1.status, 200);

	const response2 = await fetchWithRefresh('/api/b');
	t.is(response2.status, 200);

	t.is(refreshCount, 2);
	t.is(callCount, 4);
});

test('options.headers override Request headers on retry', async t => {
	let callCount = 0;
	let retryHeaders;

	const mockFetch = async (urlOrRequest, options = {}) => {
		callCount++;
		if (callCount === 2) {
			retryHeaders = new Headers(options.headers);
		}

		const status = callCount === 1 ? 401 : 200;
		return {
			ok: status === 200,
			status,
			statusText: status === 200 ? 'OK' : 'Unauthorized',
			url: typeof urlOrRequest === 'string' ? urlOrRequest : urlOrRequest.url,
			headers: new Headers(options.headers),
		};
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	const request = new Request('https://example.com/api', {
		headers: {Accept: 'text/html', 'X-From-Request': 'yes'},
	});

	const response = await fetchWithRefresh(request, {
		headers: {Accept: 'application/json', 'X-From-Options': 'yes'},
	});

	t.is(response.status, 200);
	t.is(retryHeaders.get('Authorization'), 'Bearer new-token');
	t.is(retryHeaders.get('Accept'), 'application/json');
	t.is(retryHeaders.get('X-From-Request'), 'yes');
	t.is(retryHeaders.get('X-From-Options'), 'yes');
});

test('replaces existing Authorization header on retry', async t => {
	let retryHeaders;
	let callCount = 0;

	const mockFetch = async (url, options = {}) => {
		callCount++;
		if (callCount === 2) {
			retryHeaders = new Headers(options.headers);
		}

		const status = callCount === 1 ? 401 : 200;
		return {
			ok: status === 200,
			status,
			statusText: status === 200 ? 'OK' : 'Unauthorized',
			url,
			headers: new Headers(options.headers),
		};
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	await fetchWithRefresh('/api/users', {
		headers: {Authorization: 'Bearer expired-token', 'X-Custom': 'value'},
	});

	t.is(retryHeaders.get('Authorization'), 'Bearer new-token');
	t.is(retryHeaders.get('X-Custom'), 'value');
});

test('does not mutate plain-object options.headers when retrying', async t => {
	const originalHeaders = {
		Authorization: 'Bearer expired-token',
		'X-Custom': 'value',
	};

	const mockFetch = async (url, options = {}) => new Response(null, {
		status: new Headers(options.headers).get('Authorization') === 'Bearer new-token' ? 200 : 401,
	});

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	const response = await fetchWithRefresh('/api/users', {
		headers: originalHeaders,
	});

	t.is(response.status, 200);
	t.deepEqual(originalHeaders, {
		Authorization: 'Bearer expired-token',
		'X-Custom': 'value',
	});
});

test('does not mutate Headers instance in options.headers when retrying', async t => {
	const originalHeaders = new Headers({
		Authorization: 'Bearer expired-token',
		'X-Custom': 'value',
	});

	const mockFetch = async (url, options = {}) => new Response(null, {
		status: new Headers(options.headers).get('Authorization') === 'Bearer new-token' ? 200 : 401,
	});

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	const response = await fetchWithRefresh('/api/users', {
		headers: originalHeaders,
	});

	t.is(response.status, 200);
	t.is(originalHeaders.get('Authorization'), 'Bearer expired-token');
	t.is(originalHeaders.get('X-Custom'), 'value');
});

test('preserves other fetch options on retry', async t => {
	let retryOptions;
	let callCount = 0;

	const mockFetch = async (url, options = {}) => {
		callCount++;
		if (callCount === 2) {
			retryOptions = options;
		}

		const status = callCount === 1 ? 401 : 200;
		return {
			ok: status === 200,
			status,
			statusText: status === 200 ? 'OK' : 'Unauthorized',
			url,
			headers: new Headers(options.headers),
		};
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	await fetchWithRefresh('/api/users', {
		method: 'POST',
		body: JSON.stringify({name: 'test'}),
		credentials: 'include',
	});

	t.is(retryOptions.method, 'POST');
	t.is(retryOptions.body, JSON.stringify({name: 'test'}));
	t.is(retryOptions.credentials, 'include');
	t.is(new Headers(retryOptions.headers).get('Authorization'), 'Bearer new-token');
});

test('composes with withHttpError - no throw when refresh succeeds', async t => {
	const {mockFetch} = createMockFetch({initialStatus: 401, retryStatus: 200});

	const fetchWithRefresh = withHttpError(
		withTokenRefresh(mockFetch, {
			async refreshToken() {
				return 'new-token';
			},
		}),
	);

	const response = await fetchWithRefresh('/api/users');
	t.is(response.status, 200);
});

test('composes with withHttpError - throws when refresh also fails', async t => {
	const {mockFetch} = createMockFetch({initialStatus: 401, retryStatus: 401});

	const fetchWithRefresh = withHttpError(
		withTokenRefresh(mockFetch, {
			async refreshToken() {
				return 'new-token';
			},
		}),
	);

	const error = await t.throwsAsync(fetchWithRefresh('/api/users'), {instanceOf: HttpError});
	t.is(error.response.status, 401);
});

test('Request body without override returns the original 401 response', async t => {
	let firstBody;
	let callCount = 0;
	let refreshCalled = false;

	const mockFetch = async (urlOrRequest, options = {}) => {
		callCount++;
		const body = urlOrRequest instanceof Request
			? await urlOrRequest.text()
			: options.body;

		if (callCount === 1) {
			firstBody = body;
		}

		return new Response(null, {status: 401});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCalled = true;
			return 'new-token';
		},
	});

	const request = new Request('https://example.com/api', {
		method: 'POST',
		body: JSON.stringify({name: 'test'}),
	});

	const response = await fetchWithRefresh(request);
	t.is(response.status, 401);
	t.is(firstBody, JSON.stringify({name: 'test'}));
	t.is(callCount, 1);
	t.false(refreshCalled);
});

test('retries streamed options body without consuming it twice', async t => {
	let callCount = 0;
	const bodies = [];

	const mockFetch = async (urlOrRequest, options = {}) => {
		callCount++;
		const request = urlOrRequest instanceof Request
			? urlOrRequest
			: new Request(urlOrRequest, options);
		bodies.push(await request.text());

		const status = callCount === 1 ? 401 : 200;
		return new Response(null, {status});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('stream-body'));
			controller.close();
		},
	});

	const response = await fetchWithRefresh('https://example.com/api', {
		method: 'POST',
		body: stream,
		duplex: 'half',
	});

	t.is(response.status, 200);
	t.deepEqual(bodies, ['stream-body', 'stream-body']);
});

test('retries streamed override body for Request input without consuming it twice', async t => {
	let callCount = 0;
	const bodies = [];

	const mockFetch = async (urlOrRequest, options = {}) => {
		callCount++;
		const request = new Request(urlOrRequest, options);
		bodies.push(await request.text());

		const status = callCount === 1 ? 401 : 200;
		return new Response(null, {status});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	const stream = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('override-body'));
			controller.close();
		},
	});

	const request = new Request('https://example.com/api', {
		method: 'POST',
		body: 'original-body',
	});

	const response = await fetchWithRefresh(request, {
		body: stream,
		duplex: 'half',
	});

	t.is(response.status, 200);
	t.deepEqual(bodies, ['override-body', 'override-body']);
});

test('does not retry AsyncIterable options body', async t => {
	let callCount = 0;
	const bodies = [];
	const body = {
		async * [Symbol.asyncIterator]() {
			yield new TextEncoder().encode('async-iterable-body');
		},
	};

	const mockFetch = async (urlOrRequest, options = {}) => {
		callCount++;
		const request = new Request(urlOrRequest, options);
		bodies.push(await request.text());
		return new Response(null, {status: 401});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	const response = await fetchWithRefresh('https://example.com/api', {
		method: 'POST',
		body,
		duplex: 'half',
	});

	t.is(response.status, 401);
	t.is(callCount, 1);
	t.deepEqual(bodies, ['async-iterable-body']);
});

test('Request body overrides preserve inherited body headers on the first attempt', async t => {
	let requestCount = 0;
	const contentTypes = [];
	const contentLengths = [];

	const mockFetch = createRecordedResponseFetch({
		onRequest(request, callCount) {
			requestCount = callCount;
			contentTypes.push(request.headers.get('content-type'));
			contentLengths.push(request.headers.get('content-length'));
		},
	});

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	const request = createBodyOverrideRequest({
		'content-type': 'text/plain;charset=UTF-8',
		'content-length': '999',
	});

	const formData = createFormDataBody();

	const response = await fetchWithRefresh(request, {
		body: formData,
	});

	t.is(response.status, 200);
	t.is(requestCount, 2);
	t.deepEqual(contentTypes, ['text/plain;charset=UTF-8', 'text/plain;charset=UTF-8']);
	t.deepEqual(contentLengths, ['999', '999']);
});

test('Request body overrides preserve explicit Request body headers on retry', async t => {
	let retryContentType;
	let retryContentLength;

	const mockFetch = createRecordedResponseFetch({
		onRequest(request, callCount) {
			if (callCount === 2) {
				retryContentType = request.headers.get('content-type');
				retryContentLength = request.headers.get('content-length');
			}
		},
	});

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	const formData = createFormDataBody();
	const request = createBodyOverrideRequest({
		'content-type': 'text/plain;charset=UTF-8',
		'content-length': '999',
	});

	const response = await fetchWithRefresh(request, {
		body: formData,
	});

	t.is(response.status, 200);
	t.is(retryContentType, 'text/plain;charset=UTF-8');
	t.is(retryContentLength, '999');
});

test('Request body overrides preserve explicit replacement body headers and non-body Request headers on retry', async t => {
	let retryRequest;

	const mockFetch = createRecordedResponseFetch({
		onRequest(request, callCount) {
			if (callCount === 2) {
				retryRequest = request;
			}
		},
	});

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	const request = createBodyOverrideRequest({
		'content-type': 'text/plain;charset=UTF-8',
		'content-language': 'en',
		'content-length': '999',
		'x-request': 'yes',
	});

	const response = await fetchWithRefresh(request, {
		body: 'replacement-body',
		headers: {
			'content-type': 'application/custom',
			'content-language': 'de',
			'content-length': '16',
			'x-call': 'yes',
		},
	});

	t.is(response.status, 200);
	t.is(retryRequest.headers.get('authorization'), 'Bearer new-token');
	t.is(retryRequest.headers.get('content-type'), 'application/custom');
	t.is(retryRequest.headers.get('content-language'), 'de');
	t.is(retryRequest.headers.get('content-length'), '16');
	t.is(retryRequest.headers.get('x-request'), 'yes');
	t.is(retryRequest.headers.get('x-call'), 'yes');
});

test('Request body overrides preserve explicit Request body headers on retry when no per-call headers are provided', async t => {
	let retryRequest;

	const mockFetch = createRecordedResponseFetch({
		onRequest(request, callCount) {
			if (callCount === 2) {
				retryRequest = request;
			}
		},
	});

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	const request = createBodyOverrideRequest({
		'content-type': 'application/json',
		'content-language': 'fr',
		'content-location': '/payload',
		'content-encoding': 'br',
		'x-request': 'yes',
	});

	const response = await fetchWithRefresh(request, {
		body: 'replacement-body',
	});

	t.is(response.status, 200);
	t.is(retryRequest.headers.get('authorization'), 'Bearer new-token');
	t.is(retryRequest.headers.get('content-type'), 'application/json');
	t.is(retryRequest.headers.get('content-language'), 'fr');
	t.is(retryRequest.headers.get('content-location'), '/payload');
	t.is(retryRequest.headers.get('content-encoding'), 'br');
	t.is(retryRequest.headers.get('x-request'), 'yes');
});

test('Request body overrides preserve outer withHeaders body defaults across every attempt when the original Request has no body headers', async t => {
	const contentTypes = [];
	const contentLanguages = [];
	const contentLengths = [];
	const defaultHeaders = [];

	const mockFetch = createRecordedResponseFetch({
		onRequest(request) {
			contentTypes.push(request.headers.get('content-type'));
			contentLanguages.push(request.headers.get('content-language'));
			contentLengths.push(request.headers.get('content-length'));
			defaultHeaders.push(request.headers.get('x-default'));
		},
	});

	const fetchWithRefresh = withHeaders(withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	}), {
		'content-type': 'application/default',
		'content-language': 'fr',
		'content-length': '123',
		'x-default': 'yes',
	});
	const request = createBodyOverrideRequest(undefined, new Uint8Array([1, 2, 3]));

	const response = await fetchWithRefresh(request, {
		body: 'replacement-body',
	});

	t.is(response.status, 200);
	t.deepEqual(contentTypes, ['application/default', 'application/default']);
	t.deepEqual(contentLanguages, ['fr', 'fr']);
	t.deepEqual(contentLengths, ['123', '123']);
	t.deepEqual(defaultHeaders, ['yes', 'yes']);
});

test('Request body overrides preserve explicit replacement body headers over outer withHeaders defaults across every attempt', async t => {
	const contentTypes = [];
	const contentLanguages = [];
	const contentLengths = [];
	const defaultHeaders = [];

	const mockFetch = createRecordedResponseFetch({
		onRequest(request) {
			contentTypes.push(request.headers.get('content-type'));
			contentLanguages.push(request.headers.get('content-language'));
			contentLengths.push(request.headers.get('content-length'));
			defaultHeaders.push(request.headers.get('x-default'));
		},
	});

	const fetchWithRefresh = withHeaders(withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	}), {
		'content-type': 'application/default',
		'content-language': 'fr',
		'content-length': '123',
		'x-default': 'yes',
	});
	const request = createBodyOverrideRequest(undefined, new Uint8Array([1, 2, 3]));

	const response = await fetchWithRefresh(request, {
		body: 'replacement-body',
		headers: {
			'content-type': 'application/custom',
			'content-language': 'de',
			'content-length': '16',
		},
	});

	t.is(response.status, 200);
	t.deepEqual(contentTypes, ['application/custom', 'application/custom']);
	t.deepEqual(contentLanguages, ['de', 'de']);
	t.deepEqual(contentLengths, ['16', '16']);
	t.deepEqual(defaultHeaders, ['yes', 'yes']);
});

test('Request body overrides preserve explicit replacement body headers over nested withHeaders defaults across every attempt', async t => {
	const contentTypes = [];
	const contentLanguages = [];
	const contentLengths = [];
	const outerDefaultHeaders = [];
	const innerDefaultHeaders = [];

	const mockFetch = createRecordedResponseFetch({
		onRequest(request) {
			contentTypes.push(request.headers.get('content-type'));
			contentLanguages.push(request.headers.get('content-language'));
			contentLengths.push(request.headers.get('content-length'));
			outerDefaultHeaders.push(request.headers.get('x-outer-default'));
			innerDefaultHeaders.push(request.headers.get('x-inner-default'));
		},
	});

	const fetchWithRefresh = withHeaders(withHeaders(withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	}), {
		'Content-Type': 'application/inner-default',
		'Content-Language': 'nb',
		'Content-Length': '321',
		'X-Inner-Default': 'yes',
	}), {
		'content-type': 'application/outer-default',
		'content-language': 'fr',
		'content-length': '123',
		'x-outer-default': 'yes',
	});
	const request = createBodyOverrideRequest(undefined, new Uint8Array([1, 2, 3]));

	const response = await fetchWithRefresh(request, {
		body: 'replacement-body',
		headers: {
			'content-type': 'application/custom',
			'content-language': 'de',
			'content-length': '16',
		},
	});

	t.is(response.status, 200);
	t.deepEqual(contentTypes, ['application/custom', 'application/custom']);
	t.deepEqual(contentLanguages, ['de', 'de']);
	t.deepEqual(contentLengths, ['16', '16']);
	t.deepEqual(outerDefaultHeaders, ['yes', 'yes']);
	t.deepEqual(innerDefaultHeaders, ['yes', 'yes']);
});

test('Request body overrides preserve explicit Request body headers across retry through nested withHeaders wrappers', async t => {
	const contentTypes = [];
	const contentLanguages = [];
	const contentLengths = [];
	const outerDefaultHeaders = [];
	const innerDefaultHeaders = [];

	const mockFetch = createRecordedResponseFetch({
		onRequest(request) {
			contentTypes.push(request.headers.get('content-type'));
			contentLanguages.push(request.headers.get('content-language'));
			contentLengths.push(request.headers.get('content-length'));
			outerDefaultHeaders.push(request.headers.get('x-outer-default'));
			innerDefaultHeaders.push(request.headers.get('x-inner-default'));
		},
	});

	const fetchWithRefresh = withHeaders(withHeaders(withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	}), {
		'x-inner-default': 'yes',
	}), {
		'x-outer-default': 'yes',
	});
	const formData = createFormDataBody();
	const request = createBodyOverrideRequest({
		'content-type': 'text/plain;charset=UTF-8',
		'content-language': 'fr',
		'content-length': '999',
	});

	const response = await fetchWithRefresh(request, {body: formData});

	t.is(response.status, 200);
	t.deepEqual(contentTypes, ['text/plain;charset=UTF-8', 'text/plain;charset=UTF-8']);
	t.deepEqual(contentLanguages, ['fr', 'fr']);
	t.deepEqual(contentLengths, ['999', '999']);
	t.deepEqual(outerDefaultHeaders, ['yes', 'yes']);
	t.deepEqual(innerDefaultHeaders, ['yes', 'yes']);
});

test('cancels the unused tee branch when no retry happens', async t => {
	let canceledRetryBody = false;

	const initialBody = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('stream-body'));
			controller.close();
		},
	});
	const stream = initialBody;
	stream.tee = () => [
		initialBody,
		{
			cancel() {
				canceledRetryBody = true;
			},
		},
	];

	const fetchWithRefresh = withTokenRefresh(async () => new Response(null, {status: 200}), {
		async refreshToken() {
			return 'new-token';
		},
	});

	const response = await fetchWithRefresh('https://example.com/api', {
		method: 'POST',
		body: stream,
		duplex: 'half',
	});

	t.is(response.status, 200);
	t.true(canceledRetryBody);
});

test('cancels the unused tee branch when the first fetch throws', async t => {
	let canceledRetryBody = false;

	const initialBody = new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode('stream-body'));
			controller.close();
		},
	});
	const stream = initialBody;
	stream.tee = () => [
		initialBody,
		{
			cancel() {
				canceledRetryBody = true;
			},
		},
	];

	const fetchWithRefresh = withTokenRefresh(async () => {
		throw new TypeError('Failed to fetch');
	}, {
		async refreshToken() {
			return 'new-token';
		},
	});

	await t.throwsAsync(fetchWithRefresh('https://example.com/api', {
		method: 'POST',
		body: stream,
		duplex: 'half',
	}), {
		instanceOf: TypeError,
		message: 'Failed to fetch',
	});

	t.true(canceledRetryBody);
});

test('retries FormData body with matching multipart boundary', async t => {
	let callCount = 0;
	const receivedBoundaries = [];

	const mockFetch = async (urlOrRequest, options = {}) => {
		callCount++;
		const request = new Request(urlOrRequest, options);
		const contentType = request.headers.get('content-type');
		const headerBoundary = /boundary=([^;]+)/.exec(contentType)?.[1];
		const body = await request.text();
		const bodyBoundary = /^--([^\r\n]+)/.exec(body)?.[1];
		receivedBoundaries.push(`header:${headerBoundary},body:${bodyBoundary}`);

		if (callCount === 1) {
			return new Response(null, {status: 401});
		}

		return Response.json({success: headerBoundary === bodyBoundary});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	const formData = new FormData();
	formData.append('field', 'value');

	const response = await fetchWithRefresh('https://example.com/api', {
		method: 'POST',
		body: formData,
	});

	t.true(response.ok);
	t.is(receivedBoundaries.length, 2);

	for (const boundary of receivedBoundaries) {
		const [, headerBoundary, bodyBoundary] = /^header:([^,]+),body:(.+)$/.exec(boundary);
		t.is(headerBoundary, bodyBoundary);
	}
});

test('concurrent refresh failure returns 401 for all callers', async t => {
	let callCount = 0;

	const mockFetch = async (url, options = {}) => {
		callCount++;
		return {
			ok: false,
			status: 401,
			statusText: 'Unauthorized',
			url,
			headers: new Headers(options.headers),
		};
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			await new Promise(resolve => {
				setTimeout(resolve, 50);
			});
			throw new Error('Refresh failed');
		},
	});

	const [response1, response2, response3] = await Promise.all([
		fetchWithRefresh('/api/a'),
		fetchWithRefresh('/api/b'),
		fetchWithRefresh('/api/c'),
	]);

	t.is(response1.status, 401);
	t.is(response2.status, 401);
	t.is(response3.status, 401);
	t.is(callCount, 3);
});

test('anonymous refresh failure resets before the next batch', async t => {
	let refreshCount = 0;

	const mockFetch = async (url, options = {}) => {
		const isRetry = new Headers(options.headers).get('Authorization') === 'Bearer recovered-token';
		return new Response(null, {status: isRetry ? 200 : 401});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCount++;
			if (refreshCount === 1) {
				throw new Error('Refresh failed');
			}

			return 'recovered-token';
		},
	});

	const [responseA, responseB] = await Promise.all([
		fetchWithRefresh('/api/a'),
		fetchWithRefresh('/api/b'),
	]);

	t.is(responseA.status, 401);
	t.is(responseB.status, 401);

	const responseC = await fetchWithRefresh('/api/c');
	t.is(responseC.status, 200);
	t.is(refreshCount, 2);
});

test('concurrent 401s with different Authorization headers refresh separately', async t => {
	let refreshCount = 0;

	const mockFetch = async (url, options = {}) => {
		const headers = new Headers(options.headers);
		const authorization = headers.get('Authorization');
		const isRetry = authorization?.startsWith('Bearer token-');

		return new Response(null, {status: isRetry ? 200 : 401});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCount++;
			await new Promise(resolve => {
				setTimeout(resolve, 20);
			});
			return `token-${refreshCount}`;
		},
	});

	const [responseA, responseB] = await Promise.all([
		fetchWithRefresh('/api/a', {
			headers: {
				Authorization: 'Bearer expired-token-a',
			},
		}),
		fetchWithRefresh('/api/b', {
			headers: {
				Authorization: 'Bearer expired-token-b',
			},
		}),
	]);

	t.is(responseA.status, 200);
	t.is(responseB.status, 200);
	t.is(refreshCount, 2);
});

test('concurrent 401s with different Request Authorization headers refresh separately', async t => {
	let refreshCount = 0;

	const mockFetch = async (urlOrRequest, options = {}) => {
		const request = new Request(urlOrRequest, options);
		const authorization = request.headers.get('Authorization');
		const isRetry = authorization?.startsWith('Bearer token-');

		return new Response(null, {status: isRetry ? 200 : 401});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCount++;
			await new Promise(resolve => {
				setTimeout(resolve, 20);
			});
			return `token-${refreshCount}`;
		},
	});

	const requestA = new Request('https://example.com/api/a', {
		headers: {
			Authorization: 'Bearer expired-token-a',
		},
	});

	const requestB = new Request('https://example.com/api/b', {
		headers: {
			Authorization: 'Bearer expired-token-b',
		},
	});

	const [responseA, responseB] = await Promise.all([
		fetchWithRefresh(requestA),
		fetchWithRefresh(requestB),
	]);

	t.is(responseA.status, 200);
	t.is(responseB.status, 200);
	t.is(refreshCount, 2);
});

test('anonymous and Authorization-scoped refreshes do not share state', async t => {
	let refreshCount = 0;

	const mockFetch = async (url, options = {}) => {
		const authorization = new Headers(options.headers).get('Authorization');

		if (url === '/api/anonymous') {
			return new Response(null, {status: authorization === 'Bearer anonymous-token' ? 200 : 401});
		}

		if (url === '/api/authorized') {
			return new Response(null, {status: authorization === 'Bearer authorized-token' ? 200 : 401});
		}

		throw new Error(`Unexpected URL: ${url}`);
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCount++;

			if (refreshCount === 1) {
				return 'anonymous-token';
			}

			return 'authorized-token';
		},
	});

	const anonymousResponsePromise = fetchWithRefresh('/api/anonymous');
	const authorizedResponsePromise = new Promise(resolve => {
		setTimeout(() => {
			resolve(fetchWithRefresh('/api/authorized', {
				headers: {
					Authorization: 'Bearer expired-token',
				},
			}));
		}, 10);
	});

	const [anonymousResponse, authorizedResponse] = await Promise.all([
		anonymousResponsePromise,
		authorizedResponsePromise,
	]);

	t.is(anonymousResponse.status, 200);
	t.is(authorizedResponse.status, 200);
	t.is(refreshCount, 2);
});

test('successful anonymous refresh resets before the next batch', async t => {
	let refreshCount = 0;
	const retryTokens = [];

	const mockFetch = async (url, options = {}) => {
		const authorization = new Headers(options.headers).get('Authorization');
		const isRetry = authorization?.startsWith('Bearer token-');

		if (isRetry) {
			retryTokens.push(authorization);
			return new Response(null, {status: 200});
		}

		return new Response(null, {status: 401});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCount++;
			return `token-${refreshCount}`;
		},
	});

	const [responseA, responseB] = await Promise.all([
		fetchWithRefresh('/api/a'),
		fetchWithRefresh('/api/b'),
	]);

	t.is(responseA.status, 200);
	t.is(responseB.status, 200);

	const responseC = await fetchWithRefresh('/api/c');
	t.is(responseC.status, 200);
	t.is(refreshCount, 2);
	t.deepEqual(retryTokens, ['Bearer token-1', 'Bearer token-1', 'Bearer token-2']);
});

test('late anonymous 401s after refresh settlement start a new refresh', async t => {
	let refreshCount = 0;
	let callCount = 0;
	const retryTokens = [];

	const mockFetch = async (url, options = {}) => {
		callCount++;
		const authorization = new Headers(options.headers).get('Authorization');
		const isRetry = authorization?.startsWith('Bearer token-');

		if (isRetry) {
			retryTokens.push(authorization);
			return new Response(null, {status: 200});
		}

		if (url === '/api/c') {
			await new Promise(resolve => {
				setTimeout(resolve, 100);
			});
		}

		return new Response(null, {status: 401});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCount++;
			await new Promise(resolve => {
				setTimeout(resolve, 20);
			});
			return `token-${refreshCount}`;
		},
	});

	const [responseA, responseB, responseC] = await Promise.all([
		fetchWithRefresh('/api/a'),
		fetchWithRefresh('/api/b'),
		fetchWithRefresh('/api/c'),
	]);

	t.is(responseA.status, 200);
	t.is(responseB.status, 200);
	t.is(responseC.status, 200);
	t.is(refreshCount, 2);
	t.is(callCount, 6);
	t.deepEqual(retryTokens, ['Bearer token-1', 'Bearer token-1', 'Bearer token-2']);
});

test('successful in-flight requests do not keep a settled refresh alive', async t => {
	let refreshCount = 0;
	let slowRequestResolved = false;

	const mockFetch = async (url, options = {}) => {
		const authorization = new Headers(options.headers).get('Authorization');
		const isRetry = authorization?.startsWith('Bearer token-');

		if (isRetry) {
			return new Response(null, {status: 200});
		}

		if (url === '/api/slow-success') {
			await new Promise(resolve => {
				setTimeout(resolve, 120);
			});
			slowRequestResolved = true;
			return new Response(null, {status: 200});
		}

		return new Response(null, {status: 401});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCount++;
			return `token-${refreshCount}`;
		},
	});

	const slowResponsePromise = fetchWithRefresh('/api/slow-success', {
		headers: {
			Authorization: 'Bearer expired-token',
		},
	});

	const first401Response = await fetchWithRefresh('/api/first-401', {
		headers: {
			Authorization: 'Bearer expired-token',
		},
	});

	t.is(first401Response.status, 200);
	t.is(refreshCount, 1);
	t.false(slowRequestResolved);

	const second401Response = await fetchWithRefresh('/api/second-401', {
		headers: {
			Authorization: 'Bearer expired-token',
		},
	});

	t.is(second401Response.status, 200);
	t.is(refreshCount, 2);

	const slowResponse = await slowResponsePromise;
	t.is(slowResponse.status, 200);
});

test('requests that start mid-refresh reuse the in-flight refresh', async t => {
	let refreshCount = 0;
	let releaseFirstRequest;
	const firstRequestGate = new Promise(resolve => {
		releaseFirstRequest = resolve;
	});

	const mockFetch = async (url, options = {}) => {
		const authorization = new Headers(options.headers).get('Authorization');
		const isRetry = authorization?.startsWith('Bearer token-');

		if (isRetry) {
			return new Response(null, {status: 200});
		}

		if (url === '/api/a') {
			await firstRequestGate;
		}

		return new Response(null, {status: 401});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCount++;
			await new Promise(resolve => {
				setTimeout(resolve, 40);
			});
			return `token-${refreshCount}`;
		},
	});

	const firstResponsePromise = fetchWithRefresh('/api/a', {
		headers: {
			Authorization: 'Bearer expired-token',
		},
	});

	await new Promise(resolve => {
		setTimeout(resolve, 10);
	});

	const secondResponsePromise = fetchWithRefresh('/api/b', {
		headers: {
			Authorization: 'Bearer expired-token',
		},
	});

	releaseFirstRequest();

	const [firstResponse, secondResponse] = await Promise.all([
		firstResponsePromise,
		secondResponsePromise,
	]);

	t.is(firstResponse.status, 200);
	t.is(secondResponse.status, 200);
	t.is(refreshCount, 1);
});

test('concurrent anonymous requests still deduplicate while an Authorization refresh overlaps', async t => {
	let refreshCount = 0;

	const mockFetch = async (url, options = {}) => {
		const authorization = new Headers(options.headers).get('Authorization');

		if (authorization?.startsWith('Bearer anonymous-token-')) {
			return new Response(null, {status: 200});
		}

		if (authorization === 'Bearer authorized-token') {
			return new Response(null, {status: 200});
		}

		return new Response(null, {status: 401});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCount++;
			await new Promise(resolve => {
				setTimeout(resolve, 20);
			});

			if (refreshCount === 1) {
				return 'anonymous-token-1';
			}

			return 'authorized-token';
		},
	});

	const [anonymousResponse, secondAnonymousResponse, authorizedResponse] = await Promise.all([
		fetchWithRefresh('/api/anonymous'),
		fetchWithRefresh('/api/anonymous-2'),
		fetchWithRefresh('/api/authorized', {
			headers: {
				Authorization: 'Bearer expired-token',
			},
		}),
	]);

	t.is(anonymousResponse.status, 200);
	t.is(secondAnonymousResponse.status, 200);
	t.is(authorizedResponse.status, 200);
	t.is(refreshCount, 2);
});

test('aborting during refresh rejects instead of returning the original 401 response', async t => {
	const abortController = new AbortController();
	let markRefreshStarted;
	const refreshStartedPromise = new Promise(resolve => {
		markRefreshStarted = resolve;
	});

	const mockFetch = async () => new Response(null, {status: 401});

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			markRefreshStarted();
			await new Promise((resolve, reject) => {
				const timeout = setTimeout(resolve, 100);
				abortController.signal.addEventListener('abort', () => {
					clearTimeout(timeout);
					reject(abortController.signal.reason);
				}, {once: true});
			});

			return 'new-token';
		},
	});

	const responsePromise = fetchWithRefresh('/api/users', {
		signal: abortController.signal,
	});

	await refreshStartedPromise;

	abortController.abort(new DOMException('This operation was aborted', 'AbortError'));

	const error = await t.throwsAsync(responsePromise);
	t.is(error.name, 'AbortError');
});

test('aborting during refresh preserves a custom abort reason', async t => {
	const abortController = new AbortController();
	let markRefreshStarted;
	const refreshStartedPromise = new Promise(resolve => {
		markRefreshStarted = resolve;
	});

	const mockFetch = async () => new Response(null, {status: 401});

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			markRefreshStarted();
			await new Promise((resolve, reject) => {
				const timeout = setTimeout(resolve, 100);
				abortController.signal.addEventListener('abort', () => {
					clearTimeout(timeout);
					reject(abortController.signal.reason);
				}, {once: true});
			});

			return 'new-token';
		},
	});

	const responsePromise = fetchWithRefresh('/api/users', {
		signal: abortController.signal,
	});

	await refreshStartedPromise;

	abortController.abort('Request canceled by caller');

	const error = await responsePromise.catch(error => error);
	t.is(error, 'Request canceled by caller');
});

test('withTimeout outside withTokenRefresh rejects on refresh timeout', async t => {
	const mockFetch = async () => new Response(null, {status: 401});

	const fetchWithRefresh = withTimeout(withTokenRefresh(mockFetch, {
		async refreshToken() {
			await new Promise(resolve => {
				setTimeout(resolve, 100);
			});

			return 'new-token';
		},
	}), 50);

	const error = await t.throwsAsync(fetchWithRefresh('/api/users'));
	t.is(error.name, 'TimeoutError');
});

test('withTimeout inside withTokenRefresh applies to the refresh wait', async t => {
	const mockFetch = async () => new Response(null, {status: 401});

	const fetchWithRefresh = withTokenRefresh(withTimeout(mockFetch, 50), {
		async refreshToken() {
			await new Promise(resolve => {
				setTimeout(resolve, 100);
			});

			return 'new-token';
		},
	});

	const error = await t.throwsAsync(fetchWithRefresh('/api/users'));
	t.is(error.name, 'TimeoutError');
});

test('withTimeout inside composed wrappers still applies to the refresh wait', async t => {
	const mockFetch = async () => new Response(null, {status: 401});

	const fetchWithRefresh = withTokenRefresh(
		withHeaders(
			withBaseUrl(
				withTimeout(mockFetch, 50),
				'https://example.com',
			),
			{'x-test': '1'},
		),
		{
			async refreshToken() {
				await new Promise(resolve => {
					setTimeout(resolve, 100);
				});

				return 'new-token';
			},
		},
	);

	const error = await t.throwsAsync(fetchWithRefresh('/api/users'));
	t.is(error.name, 'TimeoutError');
});

test('withUploadProgress inside withTokenRefresh reports both streamed upload attempts', async t => {
	const progressEvents = [];
	let callCount = 0;

	const mockFetch = async (url, options = {}) => {
		callCount++;
		await new Response(options.body).arrayBuffer();

		return new Response(null, {
			status: callCount === 1 ? 401 : 200,
			headers: new Headers(options.headers),
		});
	};

	const fetchWithRefresh = withTokenRefresh(withUploadProgress(mockFetch, {
		onProgress(progress) {
			progressEvents.push(progress);
		},
	}), {
		async refreshToken() {
			return 'new-token';
		},
	});

	const response = await fetchWithRefresh('/api/users', {
		method: 'POST',
		body: new Blob(['hello']).stream(),
		duplex: 'half',
	});

	t.is(response.status, 200);
	t.is(callCount, 2);
	t.is(progressEvents.filter(event => event.percent === 1).length, 2);
});

test('anonymous retry fetch error resets before the next batch', async t => {
	let refreshCount = 0;
	let firstRetry = true;

	const mockFetch = async (url, options = {}) => {
		const authorization = new Headers(options.headers).get('Authorization');
		const isRetry = authorization?.startsWith('Bearer token-');

		if (!isRetry) {
			return new Response(null, {status: 401});
		}

		if (firstRetry) {
			firstRetry = false;
			throw new TypeError('Failed to fetch');
		}

		return new Response(null, {status: 200});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCount++;
			return `token-${refreshCount}`;
		},
	});

	await t.throwsAsync(fetchWithRefresh('/api/a'), {
		instanceOf: TypeError,
		message: 'Failed to fetch',
	});

	const response = await fetchWithRefresh('/api/b');
	t.is(response.status, 200);
	t.is(refreshCount, 2);
});

test('late 401s for the same Authorization header start a new refresh after settlement', async t => {
	let refreshCount = 0;
	let callCount = 0;
	const retryTokens = [];

	const mockFetch = async (url, options = {}) => {
		callCount++;
		const headers = new Headers(options.headers);
		const isRetry = headers.has('Authorization') && headers.get('Authorization') !== 'Bearer expired-token';

		if (isRetry) {
			retryTokens.push(headers.get('Authorization'));
			return new Response(null, {status: 200});
		}

		if (url === '/api/c') {
			await new Promise(resolve => {
				setTimeout(resolve, 100);
			});
		}

		return new Response(null, {status: 401});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCount++;
			await new Promise(resolve => {
				setTimeout(resolve, 20);
			});
			return `token-${refreshCount}`;
		},
	});

	const requestOptions = {
		headers: {
			Authorization: 'Bearer expired-token',
		},
	};

	const [responseA, responseB, responseC] = await Promise.all([
		fetchWithRefresh('/api/a', requestOptions),
		fetchWithRefresh('/api/b', requestOptions),
		fetchWithRefresh('/api/c', requestOptions),
	]);

	t.is(responseA.status, 200);
	t.is(responseB.status, 200);
	t.is(responseC.status, 200);
	t.is(refreshCount, 2);
	t.is(callCount, 6);
	t.deepEqual(retryTokens, ['Bearer token-1', 'Bearer token-1', 'Bearer token-2']);
});

test('deduplicates mixed-case Authorization header names', async t => {
	let refreshCount = 0;
	let callCount = 0;

	const mockFetch = async (url, options = {}) => {
		callCount++;
		const authorization = new Headers(options.headers).get('Authorization');
		const isRetry = authorization === 'Bearer new-token';

		if (isRetry) {
			return new Response(null, {status: 200});
		}

		if (url === '/api/c') {
			await new Promise(resolve => {
				setTimeout(resolve, 10);
			});
		}

		return new Response(null, {status: 401});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCount++;
			await new Promise(resolve => {
				setTimeout(resolve, 40);
			});
			return 'new-token';
		},
	});

	const [responseA, responseB, responseC] = await Promise.all([
		fetchWithRefresh('/api/a', {
			headers: {
				authorization: 'Bearer expired-token',
			},
		}),
		fetchWithRefresh('/api/b', {
			headers: {
				Authorization: 'Bearer expired-token',
			},
		}),
		fetchWithRefresh('/api/c', {
			headers: {
				AUTHORIZATION: 'Bearer expired-token',
			},
		}),
	]);

	t.is(responseA.status, 200);
	t.is(responseB.status, 200);
	t.is(responseC.status, 200);
	t.is(refreshCount, 1);
	t.is(callCount, 6);
});

test('deduplicates by the effective Authorization header from inner withHeaders defaults', async t => {
	let refreshCount = 0;
	let callCount = 0;

	const mockFetch = async (url, options = {}) => {
		callCount++;
		const authorization = new Headers(options.headers).get('Authorization');
		const isRetry = authorization === 'Bearer new-token';

		if (isRetry) {
			return new Response(null, {status: 200});
		}

		if (url === '/api/b') {
			await new Promise(resolve => {
				setTimeout(resolve, 10);
			});
		}

		return new Response(null, {status: 401});
	};

	const fetchWithRefresh = withTokenRefresh(withHeaders(mockFetch, {
		Authorization: 'Bearer expired-token',
	}), {
		async refreshToken() {
			refreshCount++;
			await new Promise(resolve => {
				setTimeout(resolve, 40);
			});
			return 'new-token';
		},
	});

	const [responseA, responseB] = await Promise.all([
		fetchWithRefresh('/api/a'),
		fetchWithRefresh('/api/b', {
			headers: {
				Authorization: 'Bearer expired-token',
			},
		}),
	]);

	t.is(responseA.status, 200);
	t.is(responseB.status, 200);
	t.is(refreshCount, 1);
	t.is(callCount, 4);
});

test('deduplicates by the effective Authorization header from nested withHeaders defaults', async t => {
	let refreshCount = 0;
	let callCount = 0;

	const mockFetch = async (url, options = {}) => {
		callCount++;
		const authorization = new Headers(options.headers).get('Authorization');
		const isRetry = authorization === 'Bearer new-token';

		if (isRetry) {
			return new Response(null, {status: 200});
		}

		if (url === '/api/b') {
			await new Promise(resolve => {
				setTimeout(resolve, 10);
			});
		}

		return new Response(null, {status: 401});
	};

	const fetchWithRefresh = withTokenRefresh(withHeaders(withHeaders(mockFetch, {
		Authorization: 'Bearer expired-token',
	}), {
		'X-Test': '1',
	}), {
		async refreshToken() {
			refreshCount++;
			await new Promise(resolve => {
				setTimeout(resolve, 40);
			});
			return 'new-token';
		},
	});

	const [responseA, responseB] = await Promise.all([
		fetchWithRefresh('/api/a'),
		fetchWithRefresh('/api/b', {
			headers: {
				Authorization: 'Bearer expired-token',
			},
		}),
	]);

	t.is(responseA.status, 200);
	t.is(responseB.status, 200);
	t.is(refreshCount, 1);
	t.is(callCount, 4);
});

test('late anonymous 401s do not reuse a settled refresh across batches', async t => {
	let refreshCount = 0;

	const mockFetch = async (url, options = {}) => {
		const authorization = new Headers(options.headers).get('Authorization');
		const isRetry = authorization?.startsWith('Bearer token-');

		if (isRetry) {
			return new Response(null, {status: 200});
		}

		return new Response(null, {status: 401});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCount++;
			return `token-${refreshCount}`;
		},
	});

	const responseA = await fetchWithRefresh('/api/a');
	const responseB = await fetchWithRefresh('/api/b');

	t.is(responseA.status, 200);
	t.is(responseB.status, 200);
	t.is(refreshCount, 2);
});

test('overlapping 401s use Authorization from options over Request headers for deduplication', async t => {
	let refreshCount = 0;
	let callCount = 0;

	const mockFetch = async (urlOrRequest, options = {}) => {
		callCount++;
		const request = new Request(urlOrRequest, options);
		const authorization = request.headers.get('Authorization');
		const isRetry = authorization === 'Bearer new-token';

		if (isRetry) {
			return new Response(null, {status: 200});
		}

		if (request.url.endsWith('/c')) {
			await new Promise(resolve => {
				setTimeout(resolve, 10);
			});
		}

		return new Response(null, {status: 401});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCount++;
			await new Promise(resolve => {
				setTimeout(resolve, 40);
			});
			return 'new-token';
		},
	});

	const requests = [
		new Request('https://example.com/api/a', {
			headers: {
				Authorization: 'Bearer request-token',
			},
		}),
		new Request('https://example.com/api/b', {
			headers: {
				Authorization: 'Bearer request-token',
			},
		}),
		new Request('https://example.com/api/c', {
			headers: {
				Authorization: 'Bearer request-token',
			},
		}),
	];

	const overrideOptions = {
		headers: {
			Authorization: 'Bearer expired-token',
		},
	};

	const [responseA, responseB, responseC] = await Promise.all(
		requests.map(request => fetchWithRefresh(request, overrideOptions)),
	);

	t.is(responseA.status, 200);
	t.is(responseB.status, 200);
	t.is(responseC.status, 200);
	t.is(refreshCount, 1);
	t.is(callCount, 6);
});

test('interleaved Authorization headers still deduplicate per token', async t => {
	let refreshCount = 0;
	const retryTokens = new Map();

	const mockFetch = async (url, options = {}) => {
		const authorization = new Headers(options.headers).get('Authorization');
		const isRetry = authorization?.startsWith('Bearer token-for-');

		if (isRetry) {
			retryTokens.set(url, authorization);
			return new Response(null, {status: 200});
		}

		if (url === '/api/a-late') {
			await new Promise(resolve => {
				setTimeout(resolve, 10);
			});
		}

		return new Response(null, {status: 401});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCount++;
			await new Promise(resolve => {
				setTimeout(resolve, 40);
			});

			return `token-for-${refreshCount}`;
		},
	});

	const [responseA, responseB, responseLateA] = await Promise.all([
		fetchWithRefresh('/api/a', {
			headers: {
				Authorization: 'Bearer expired-a',
			},
		}),
		fetchWithRefresh('/api/b', {
			headers: {
				Authorization: 'Bearer expired-b',
			},
		}),
		fetchWithRefresh('/api/a-late', {
			headers: {
				Authorization: 'Bearer expired-a',
			},
		}),
	]);

	t.is(responseA.status, 200);
	t.is(responseB.status, 200);
	t.is(responseLateA.status, 200);
	t.is(refreshCount, 2);
	t.is(retryTokens.get('/api/a'), retryTokens.get('/api/a-late'));
});

test('retry 401 clears cached refresh for the same Authorization header', async t => {
	let refreshCount = 0;
	const retryTokens = [];

	const mockFetch = async (url, options = {}) => {
		const headers = new Headers(options.headers);
		const authorization = headers.get('Authorization');

		if (authorization?.startsWith('Bearer token-')) {
			retryTokens.push(authorization);
			return new Response(null, {
				status: authorization === 'Bearer token-1' ? 401 : 200,
			});
		}

		return new Response(null, {status: 401});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCount++;
			return `token-${refreshCount}`;
		},
	});

	const requestOptions = {
		headers: {
			Authorization: 'Bearer expired-token',
		},
	};

	const firstResponse = await fetchWithRefresh('/api/a', requestOptions);
	const secondResponse = await fetchWithRefresh('/api/b', requestOptions);

	t.is(firstResponse.status, 401);
	t.is(secondResponse.status, 200);
	t.is(refreshCount, 2);
	t.deepEqual(retryTokens, ['Bearer token-1', 'Bearer token-2']);
});

test('shared refresh failure for an Authorization header resets before the next batch', async t => {
	let refreshCount = 0;

	const mockFetch = async (url, options = {}) => {
		const authorization = new Headers(options.headers).get('Authorization');
		const isRetry = authorization === 'Bearer recovered-token';

		return new Response(null, {status: isRetry ? 200 : 401});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCount++;
			if (refreshCount === 1) {
				throw new Error('Refresh failed');
			}

			return 'recovered-token';
		},
	});

	const requestOptions = {
		headers: {
			Authorization: 'Bearer expired-token',
		},
	};

	const [responseA, responseB] = await Promise.all([
		fetchWithRefresh('/api/a', requestOptions),
		fetchWithRefresh('/api/b', requestOptions),
	]);

	t.is(responseA.status, 401);
	t.is(responseB.status, 401);

	const responseC = await fetchWithRefresh('/api/c', requestOptions);
	t.is(responseC.status, 200);
	t.is(refreshCount, 2);
});

test('aborted refresh wait clears a hung refresh promise for the next request', async t => {
	let refreshCount = 0;
	const abortController = new AbortController();
	let markRefreshStarted;
	const refreshStartedPromise = new Promise(resolve => {
		markRefreshStarted = resolve;
	});

	const mockFetch = async (url, options = {}) => {
		const authorization = new Headers(options.headers).get('Authorization');
		const isRetry = authorization === 'Bearer token-2';

		return new Response(null, {status: isRetry ? 200 : 401});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCount++;
			markRefreshStarted();

			if (refreshCount === 1) {
				return new Promise(() => {});
			}

			return 'token-2';
		},
	});

	const firstResponsePromise = fetchWithRefresh('/api/a', {
		headers: {
			Authorization: 'Bearer expired-token',
		},
		signal: abortController.signal,
	});

	await refreshStartedPromise;
	abortController.abort(new DOMException('This operation was aborted', 'AbortError'));

	const firstError = await t.throwsAsync(firstResponsePromise);
	t.is(firstError.name, 'AbortError');

	const secondResponse = await fetchWithRefresh('/api/b', {
		headers: {
			Authorization: 'Bearer expired-token',
		},
	});

	t.is(secondResponse.status, 200);
	t.is(refreshCount, 2);
});

test('an aborted waiter does not evict an in-flight shared refresh', async t => {
	let refreshCount = 0;
	const abortController = new AbortController();
	let resolveRefresh;
	const refreshPromise = new Promise(resolve => {
		resolveRefresh = resolve;
	});

	const mockFetch = async (url, options = {}) => {
		const authorization = new Headers(options.headers).get('Authorization');
		const isRetry = authorization === 'Bearer new-token';

		return new Response(null, {status: isRetry ? 200 : 401});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCount++;
			return refreshPromise;
		},
	});

	const firstResponsePromise = fetchWithRefresh('/api/a', {
		headers: {
			Authorization: 'Bearer expired-token',
		},
	});

	const abortedResponsePromise = fetchWithRefresh('/api/b', {
		headers: {
			Authorization: 'Bearer expired-token',
		},
		signal: abortController.signal,
	});

	await Promise.resolve();
	abortController.abort(new DOMException('This operation was aborted', 'AbortError'));

	const abortedError = await t.throwsAsync(abortedResponsePromise);
	t.is(abortedError.name, 'AbortError');

	const lateResponsePromise = fetchWithRefresh('/api/c', {
		headers: {
			Authorization: 'Bearer expired-token',
		},
	});

	resolveRefresh('new-token');

	const [firstResponse, lateResponse] = await Promise.all([
		firstResponsePromise,
		lateResponsePromise,
	]);

	t.is(firstResponse.status, 200);
	t.is(lateResponse.status, 200);
	t.is(refreshCount, 1);
});

test('retry fetch error for an Authorization header resets before the next batch', async t => {
	let refreshCount = 0;
	let firstRetry = true;

	const mockFetch = async (url, options = {}) => {
		const authorization = new Headers(options.headers).get('Authorization');
		const isRetry = authorization?.startsWith('Bearer token-');

		if (!isRetry) {
			return new Response(null, {status: 401});
		}

		if (firstRetry) {
			firstRetry = false;
			throw new TypeError('Failed to fetch');
		}

		return new Response(null, {status: 200});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCount++;
			return `token-${refreshCount}`;
		},
	});

	const requestOptions = {
		headers: {
			Authorization: 'Bearer expired-token',
		},
	};

	await t.throwsAsync(fetchWithRefresh('/api/a', requestOptions), {
		instanceOf: TypeError,
		message: 'Failed to fetch',
	});

	const response = await fetchWithRefresh('/api/b', requestOptions);
	t.is(response.status, 200);
	t.is(refreshCount, 2);
});

test('successful refresh for an Authorization header resets before the next batch', async t => {
	let refreshCount = 0;
	const retryTokens = [];

	const mockFetch = async (url, options = {}) => {
		const authorization = new Headers(options.headers).get('Authorization');
		const isRetry = authorization?.startsWith('Bearer token-');

		if (isRetry) {
			retryTokens.push(authorization);
			return new Response(null, {status: 200});
		}

		return new Response(null, {status: 401});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCount++;
			return `token-${refreshCount}`;
		},
	});

	const requestOptions = {
		headers: {
			Authorization: 'Bearer expired-token',
		},
	};

	const [responseA, responseB] = await Promise.all([
		fetchWithRefresh('/api/a', requestOptions),
		fetchWithRefresh('/api/b', requestOptions),
	]);

	t.is(responseA.status, 200);
	t.is(responseB.status, 200);

	const responseC = await fetchWithRefresh('/api/c', requestOptions);
	t.is(responseC.status, 200);
	t.is(refreshCount, 2);
	t.deepEqual(retryTokens, ['Bearer token-1', 'Bearer token-1', 'Bearer token-2']);
});

test('works with URL object input', async t => {
	const {mockFetch, getCallCount} = createMockFetch({initialStatus: 401, retryStatus: 200});

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	const response = await fetchWithRefresh(new URL('https://example.com/api'));
	t.is(response.status, 200);
	t.is(getCallCount(), 2);
});

test('works with Headers instance in options', async t => {
	let retryHeaders;
	let callCount = 0;

	const mockFetch = async (url, options = {}) => {
		callCount++;
		if (callCount === 2) {
			retryHeaders = new Headers(options.headers);
		}

		const status = callCount === 1 ? 401 : 200;
		return {
			ok: status === 200,
			status,
			statusText: status === 200 ? 'OK' : 'Unauthorized',
			url,
			headers: new Headers(options.headers),
		};
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	await fetchWithRefresh('/api/users', {
		headers: new Headers({'Content-Type': 'application/json', 'X-Custom': 'value'}),
	});

	t.is(retryHeaders.get('Authorization'), 'Bearer new-token');
	t.is(retryHeaders.get('Content-Type'), 'application/json');
	t.is(retryHeaders.get('X-Custom'), 'value');
});

test('does not mutate original Request headers when retrying', async t => {
	const mockFetch = async (urlOrRequest, options = {}) => new Response(null, {
		status: new Request(urlOrRequest, options).headers.get('Authorization') === 'Bearer new-token' ? 200 : 401,
	});

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	const request = new Request('https://example.com/api/users', {
		headers: {
			Authorization: 'Bearer expired-token',
			'X-Custom': 'value',
		},
	});

	const response = await fetchWithRefresh(request);

	t.is(response.status, 200);
	t.is(request.headers.get('Authorization'), 'Bearer expired-token');
	t.is(request.headers.get('X-Custom'), 'value');
});

test('retry uses the same URL', async t => {
	const urls = [];
	let callCount = 0;

	const mockFetch = async (url, options = {}) => {
		callCount++;
		urls.push(typeof url === 'string' ? url : url.toString());
		const status = callCount === 1 ? 401 : 200;
		return {
			ok: status === 200,
			status,
			statusText: status === 200 ? 'OK' : 'Unauthorized',
			url: typeof url === 'string' ? url : url.toString(),
			headers: new Headers(options.headers),
		};
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	await fetchWithRefresh('/api/users');
	t.is(urls.length, 2);
	t.is(urls[0], urls[1]);
});

test('works without options argument', async t => {
	let retryHeaders;
	let callCount = 0;

	const mockFetch = async (url, options = {}) => {
		callCount++;
		if (callCount === 2) {
			retryHeaders = new Headers(options.headers);
		}

		const status = callCount === 1 ? 401 : 200;
		return {
			ok: status === 200,
			status,
			statusText: status === 200 ? 'OK' : 'Unauthorized',
			url,
			headers: new Headers(options.headers),
		};
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	const response = await fetchWithRefresh('/api/users');
	t.is(response.status, 200);
	t.is(callCount, 2);
	t.is(retryHeaders.get('Authorization'), 'Bearer new-token');
	t.is([...retryHeaders].length, 1);
});

test('propagates network errors from initial fetch', async t => {
	const mockFetch = async () => {
		throw new TypeError('Failed to fetch');
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	await t.throwsAsync(fetchWithRefresh('/api/users'), {
		instanceOf: TypeError,
		message: 'Failed to fetch',
	});
});

test('propagates network errors from retry fetch', async t => {
	let callCount = 0;

	const mockFetch = async (url, options = {}) => {
		callCount++;
		if (callCount === 1) {
			return {
				ok: false,
				status: 401,
				statusText: 'Unauthorized',
				url,
				headers: new Headers(options.headers),
			};
		}

		throw new TypeError('Failed to fetch');
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	await t.throwsAsync(fetchWithRefresh('/api/users'), {
		instanceOf: TypeError,
		message: 'Failed to fetch',
	});
	t.is(callCount, 2);
});

test('deduplication resets between separate concurrent batches', async t => {
	let refreshCount = 0;
	const tokens = [];

	const mockFetch = async (url, options = {}) => {
		const isRetry = options.headers && new Headers(options.headers).has('Authorization');
		if (isRetry) {
			tokens.push(new Headers(options.headers).get('Authorization'));
		}

		const status = isRetry ? 200 : 401;
		return {
			ok: status === 200,
			status,
			statusText: status === 200 ? 'OK' : 'Unauthorized',
			url,
			headers: new Headers(options.headers),
		};
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCount++;
			await new Promise(resolve => {
				setTimeout(resolve, 50);
			});
			return `token-${refreshCount}`;
		},
	});

	await Promise.all([
		fetchWithRefresh('/api/a'),
		fetchWithRefresh('/api/b'),
	]);

	await Promise.all([
		fetchWithRefresh('/api/c'),
		fetchWithRefresh('/api/d'),
	]);

	t.is(refreshCount, 2);
	t.true(tokens.includes('Bearer token-1'));
	t.true(tokens.includes('Bearer token-2'));
});

test('separate wrapper instances do not share refresh state', async t => {
	let refreshCountA = 0;
	let refreshCountB = 0;

	const mockFetch = async (url, options = {}) => {
		const isRetry = options.headers && new Headers(options.headers).has('Authorization');
		const status = isRetry ? 200 : 401;
		return {
			ok: status === 200,
			status,
			statusText: status === 200 ? 'OK' : 'Unauthorized',
			url,
			headers: new Headers(options.headers),
		};
	};

	const fetchA = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCountA++;
			return 'token-a';
		},
	});

	const fetchB = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCountB++;
			return 'token-b';
		},
	});

	const [responseA, responseB] = await Promise.all([
		fetchA('/api/a'),
		fetchB('/api/b'),
	]);

	t.is(responseA.status, 200);
	t.is(responseB.status, 200);
	t.is(refreshCountA, 1);
	t.is(refreshCountB, 1);
});

test('Request with no custom headers only gets Authorization on retry', async t => {
	let retryHeaders;
	let callCount = 0;

	const mockFetch = async (urlOrRequest, options = {}) => {
		callCount++;
		if (callCount === 2) {
			retryHeaders = new Headers(options.headers);
		}

		const status = callCount === 1 ? 401 : 200;
		return {
			ok: status === 200,
			status,
			statusText: status === 200 ? 'OK' : 'Unauthorized',
			url: typeof urlOrRequest === 'string' ? urlOrRequest : urlOrRequest.url,
			headers: new Headers(options.headers),
		};
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	const request = new Request('https://example.com/api');
	const response = await fetchWithRefresh(request);
	t.is(response.status, 200);
	t.is(retryHeaders.get('Authorization'), 'Bearer new-token');
});

test('rejects when signal is already aborted before the call', async t => {
	let refreshCalled = false;

	const mockFetch = async (_url, options = {}) => {
		options.signal?.throwIfAborted();
		return new Response(null, {status: 401});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			refreshCalled = true;
			return 'new-token';
		},
	});

	const abortController = new AbortController();
	abortController.abort(new DOMException('Already aborted', 'AbortError'));

	const error = await t.throwsAsync(fetchWithRefresh('/api/users', {
		signal: abortController.signal,
	}));

	t.is(error.name, 'AbortError');
	t.false(refreshCalled);
});

test('works when refreshToken returns a synchronous value', async t => {
	const {mockFetch, getCallCount} = createMockFetch({initialStatus: 401, retryStatus: 200});

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		refreshToken() {
			return 'sync-token';
		},
	});

	const response = await fetchWithRefresh('/api/users');
	t.is(response.status, 200);
	t.is(getCallCount(), 2);
	t.is(response.headers.get('Authorization'), 'Bearer sync-token');
});

test('retries Blob body on 401', async t => {
	let callCount = 0;
	const bodies = [];

	const mockFetch = async (url, options = {}) => {
		callCount++;
		const request = new Request(url, options);
		bodies.push(await request.text());

		return new Response(null, {
			status: callCount === 1 ? 401 : 200,
			headers: new Headers(options.headers),
		});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	const response = await fetchWithRefresh('https://example.com/api', {
		method: 'POST',
		body: new Blob(['blob-body']),
	});

	t.is(response.status, 200);
	t.deepEqual(bodies, ['blob-body', 'blob-body']);
});

test('retries ArrayBuffer body on 401', async t => {
	let callCount = 0;
	const bodies = [];

	const mockFetch = async (url, options = {}) => {
		callCount++;
		const request = new Request(url, options);
		bodies.push(await request.text());

		return new Response(null, {
			status: callCount === 1 ? 401 : 200,
			headers: new Headers(options.headers),
		});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	const response = await fetchWithRefresh('https://example.com/api', {
		method: 'POST',
		body: new TextEncoder().encode('buffer-body'),
	});

	t.is(response.status, 200);
	t.deepEqual(bodies, ['buffer-body', 'buffer-body']);
});

test('retries URLSearchParams body on 401', async t => {
	let callCount = 0;
	const bodies = [];

	const mockFetch = async (url, options = {}) => {
		callCount++;
		const request = new Request(url, options);
		bodies.push(await request.text());

		return new Response(null, {
			status: callCount === 1 ? 401 : 200,
			headers: new Headers(options.headers),
		});
	};

	const fetchWithRefresh = withTokenRefresh(mockFetch, {
		async refreshToken() {
			return 'new-token';
		},
	});

	const response = await fetchWithRefresh('https://example.com/api', {
		method: 'POST',
		body: new URLSearchParams({key: 'value'}),
	});

	t.is(response.status, 200);
	t.deepEqual(bodies, ['key=value', 'key=value']);
});

test('copyFetchMetadata propagates timeout through withTokenRefresh', async t => {
	const mockFetch = async () => new Response(null, {status: 200});

	const fetchWithTimeout = withTimeout(mockFetch, 5000);
	const fetchWithRefresh = withTokenRefresh(fetchWithTimeout, {
		async refreshToken() {
			return 'new-token';
		},
	});

	const outerFetch = withHeaders(fetchWithRefresh, {'X-Test': '1'});

	// The timeout symbol should propagate through withTokenRefresh to outer wrappers
	const {timeoutDurationSymbol} = await import('../source/utilities.js');
	t.is(outerFetch[timeoutDurationSymbol], 5000);
});
