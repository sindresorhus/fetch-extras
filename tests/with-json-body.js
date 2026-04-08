import test from 'ava';
import {
	withJsonBody,
	withRetry,
	withTokenRefresh,
	withBaseUrl,
	withHeaders,
	withHttpError,
	pipeline,
} from '../source/index.js';
import {
	blockedDefaultHeaderNamesSymbol,
	inheritedRequestBodyHeaderNamesSymbol,
} from '../source/utilities.js';

const createCapturingFetch = () => {
	const calls = [];
	const mockFetch = async (urlOrRequest, options = {}) => {
		calls.push({urlOrRequest, options});
		return new Response(null, {status: 200});
	};

	mockFetch.calls = calls;
	return mockFetch;
};

test('stringifies a plain object body and sets Content-Type', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	await fetchWithJson('/api', {method: 'POST', body: {name: 'Alice'}});

	const {options} = mockFetch.calls[0];
	t.is(options.body, '{"name":"Alice"}');
	t.is(options.headers.get('content-type'), 'application/json');
});

test('stringifies an array body and sets Content-Type', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	await fetchWithJson('/api', {method: 'POST', body: [1, 2, 3]});

	const {options} = mockFetch.calls[0];
	t.is(options.body, '[1,2,3]');
	t.is(options.headers.get('content-type'), 'application/json');
});

test('stringifies a nested object body', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	await fetchWithJson('/api', {method: 'POST', body: {user: {name: 'Alice', tags: ['admin']}}});

	const {options} = mockFetch.calls[0];
	t.is(options.body, '{"user":{"name":"Alice","tags":["admin"]}}');
});

test('stringifies Object.create(null) body', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	const body = Object.create(null);
	body.key = 'value';
	await fetchWithJson('/api', {method: 'POST', body});

	const {options} = mockFetch.calls[0];
	t.is(options.body, '{"key":"value"}');
	t.is(options.headers.get('content-type'), 'application/json');
});

test('passes through string body unchanged', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	await fetchWithJson('/api', {method: 'POST', body: 'hello'});

	const {options} = mockFetch.calls[0];
	t.is(options.body, 'hello');
	t.is(options.headers, undefined);
});

test('passes through when no body is provided', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	await fetchWithJson('/api');

	const {options} = mockFetch.calls[0];
	t.is(options.body, undefined);
});

test('passes through null body unchanged', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	await fetchWithJson('/api', {method: 'POST', body: null});

	const {options} = mockFetch.calls[0];
	t.is(options.body, null);
});

test('passes through FormData body unchanged', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	const formData = new FormData();
	formData.append('name', 'Alice');
	await fetchWithJson('/api', {method: 'POST', body: formData});

	const {options} = mockFetch.calls[0];
	t.true(options.body instanceof FormData);
});

test('passes through URLSearchParams body unchanged', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	const searchParameters = new URLSearchParams({name: 'Alice'});
	await fetchWithJson('/api', {method: 'POST', body: searchParameters});

	const {options} = mockFetch.calls[0];
	t.true(options.body instanceof URLSearchParams);
});

test('passes through class instance body unchanged', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	class Payload {
		name = 'Alice';
	}

	const body = new Payload();
	await fetchWithJson('/api', {method: 'POST', body});

	const {options} = mockFetch.calls[0];
	t.true(options.body instanceof Payload);
});

test('does not override explicit Content-Type header in options', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	await fetchWithJson('/api', {
		method: 'POST',
		body: {name: 'Alice'},
		headers: {'Content-Type': 'application/vnd.api+json'},
	});

	const {options} = mockFetch.calls[0];
	t.is(options.body, '{"name":"Alice"}');
	t.is(options.headers.get('content-type'), 'application/vnd.api+json');
});

test('does not override explicit Content-Type via Headers object', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	const headers = new Headers({'Content-Type': 'application/vnd.api+json'});
	await fetchWithJson('/api', {method: 'POST', body: {name: 'Alice'}, headers});

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('content-type'), 'application/vnd.api+json');
});

test('drops stale explicit request-body headers when stringifying JSON', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	await fetchWithJson('/api', {
		method: 'POST',
		body: {name: 'Alice'},
		headers: {
			'Content-Length': '1',
			'Content-Encoding': 'gzip',
			'Content-Language': 'en',
			'Content-Location': '/old',
			'X-Trace-Id': '123',
		},
	});

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('content-type'), 'application/json');
	t.is(options.headers.get('content-length'), null);
	t.is(options.headers.get('content-encoding'), null);
	t.is(options.headers.get('content-language'), null);
	t.is(options.headers.get('content-location'), null);
	t.is(options.headers.get('x-trace-id'), '123');
});

test('preserves other options when stringifying body', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	await fetchWithJson('/api', {method: 'PUT', body: {a: 1}, cache: 'no-store'});

	const {options} = mockFetch.calls[0];
	t.is(options.method, 'PUT');
	t.is(options.cache, 'no-store');
	t.is(options.body, '{"a":1}');
});

test('works with Request object as first argument', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	const request = new Request('https://example.com/api', {method: 'POST'});
	await fetchWithJson(request, {body: {name: 'Alice'}});

	const {urlOrRequest, options} = mockFetch.calls[0];
	t.true(urlOrRequest instanceof Request);
	t.is(options.body, '{"name":"Alice"}');
	t.is(options.headers.get('content-type'), 'application/json');
});

test('preserves Request headers when overriding a Request body', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	const request = new Request('https://example.com/api', {
		method: 'POST',
		headers: {
			Authorization: 'Bearer token',
			'Content-Language': 'en',
			'Content-Length': '999',
			'X-Trace-Id': '123',
		},
		body: 'original',
	});

	await fetchWithJson(request, {body: {name: 'Alice'}});

	const {options} = mockFetch.calls[0];
	t.is(options.body, '{"name":"Alice"}');
	t.is(options.headers.get('authorization'), 'Bearer token');
	t.is(options.headers.get('x-trace-id'), '123');
	t.is(options.headers.get('content-type'), 'application/json');
	t.is(options.headers.get('content-language'), null);
	t.is(options.headers.get('content-length'), null);
});

test('replaced Request bodies do not preserve their original Content-Type', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	const request = new Request('https://example.com/api', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/vnd.api+json',
			Authorization: 'Bearer token',
		},
		body: 'original',
	});

	await fetchWithJson(request, {body: {name: 'Alice'}});

	const {options} = mockFetch.calls[0];
	t.is(options.body, '{"name":"Alice"}');
	t.is(options.headers.get('content-type'), 'application/json');
	t.is(options.headers.get('authorization'), 'Bearer token');
});

test('drops Blob-derived Request Content-Type when overriding a Request body', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);
	const request = new Request('https://example.com/api', {
		method: 'POST',
		body: new Blob(['image-bytes'], {type: 'image/png'}),
		headers: {
			Authorization: 'Bearer token',
		},
	});

	await fetchWithJson(request, {body: {name: 'Alice'}});

	const {options} = mockFetch.calls[0];
	t.is(options.body, '{"name":"Alice"}');
	t.is(options.headers.get('content-type'), 'application/json');
	t.is(options.headers.get('authorization'), 'Bearer token');
});

test('drops inherited Request body headers when overriding a Request body', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	const request = new Request('https://example.com/api', {
		method: 'POST',
		headers: {
			Authorization: 'Bearer token',
			'Content-Language': 'en',
		},
		body: 'original',
	});

	await fetchWithJson(request, {
		body: {name: 'Alice'},
		[inheritedRequestBodyHeaderNamesSymbol]: ['content-type', 'content-language'],
	});

	const {options} = mockFetch.calls[0];
	t.is(options.body, '{"name":"Alice"}');
	t.is(options.headers.get('authorization'), 'Bearer token');
	t.is(options.headers.get('content-type'), 'application/json');
	t.is(options.headers.get('content-language'), null);
});

test('preserves blocked default-header markers when overriding a Request body', async t => {
	const mockFetch = createCapturingFetch();
	const apiFetch = pipeline(
		mockFetch,
		fetchFunction => withHeaders(fetchFunction, {Authorization: 'Bearer token'}),
		withJsonBody,
	);
	const request = new Request('https://example.com/api', {
		method: 'POST',
		body: 'original',
	});
	request[blockedDefaultHeaderNamesSymbol] = ['authorization'];

	await apiFetch(request, {body: {name: 'Alice'}});

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('authorization'), null);
	t.is(options.headers.get('content-type'), 'application/json');
});

test('composes with withHeaders in pipeline', async t => {
	const mockFetch = createCapturingFetch();

	const apiFetch = pipeline(
		mockFetch,
		f => withHeaders(f, {Authorization: 'Bearer token'}),
		withJsonBody,
	);

	await apiFetch('/api', {method: 'POST', body: {name: 'Alice'}});

	const {options} = mockFetch.calls[0];
	t.is(options.body, '{"name":"Alice"}');
	t.is(options.headers.get('content-type'), 'application/json');
	t.is(options.headers.get('authorization'), 'Bearer token');
});

test('respects Content-Type set by withHeaders in documented pipeline order', async t => {
	const mockFetch = createCapturingFetch();

	const apiFetch = pipeline(
		mockFetch,
		f => withHeaders(f, {'Content-Type': 'application/vnd.api+json'}),
		withJsonBody,
	);

	await apiFetch('/api', {method: 'POST', body: {name: 'Alice'}});

	const {options} = mockFetch.calls[0];
	t.is(options.body, '{"name":"Alice"}');
	t.is(options.headers.get('content-type'), 'application/vnd.api+json');
});

test('replaced Request bodies use withHeaders Content-Type defaults in documented pipeline order', async t => {
	const mockFetch = createCapturingFetch();

	const apiFetch = pipeline(
		mockFetch,
		f => withHeaders(f, {'Content-Type': 'application/vnd.api+json'}),
		withJsonBody,
	);
	const request = new Request('https://example.com/api', {
		method: 'POST',
		headers: {'Content-Type': 'application/problem+json'},
		body: 'original',
	});

	await apiFetch(request, {body: {name: 'Alice'}});

	const {options} = mockFetch.calls[0];
	t.is(options.body, '{"name":"Alice"}');
	t.is(options.headers.get('content-type'), 'application/vnd.api+json');
});

test('drops stale body headers from withHeaders defaults when stringifying JSON', async t => {
	const mockFetch = createCapturingFetch();

	const apiFetch = pipeline(
		mockFetch,
		f => withHeaders(f, {
			'Content-Type': 'application/vnd.api+json',
			'Content-Language': 'fr',
			'Content-Location': '/payload',
			'Content-Encoding': 'gzip',
			'Content-Length': '999',
			'X-Default': 'yes',
		}),
		withJsonBody,
	);

	await apiFetch('/api', {method: 'POST', body: {name: 'Alice'}});

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('content-type'), 'application/vnd.api+json');
	t.is(options.headers.get('content-language'), null);
	t.is(options.headers.get('content-location'), null);
	t.is(options.headers.get('content-encoding'), null);
	t.is(options.headers.get('content-length'), null);
	t.is(options.headers.get('x-default'), 'yes');
});

test('composes with withBaseUrl and withHttpError in pipeline', async t => {
	let receivedUrl;
	const capturingFetch = async url => {
		receivedUrl = url;
		return new Response('ok', {status: 200});
	};

	const apiFetch = pipeline(
		capturingFetch,
		f => withBaseUrl(f, 'https://api.example.com'),
		withJsonBody,
		withHttpError,
	);

	await apiFetch('/users', {method: 'POST', body: {name: 'Alice'}});

	t.is(receivedUrl, 'https://api.example.com/users');
});

test('respects Content-Type set by withHeaders when withHeaders is outer', async t => {
	const mockFetch = createCapturingFetch();

	const apiFetch = pipeline(
		mockFetch,
		withJsonBody,
		f => withHeaders(f, {'Content-Type': 'application/vnd.api+json'}),
	);

	await apiFetch('/api', {method: 'POST', body: {name: 'Alice'}});

	const {options} = mockFetch.calls[0];
	t.is(options.body, '{"name":"Alice"}');
	t.is(options.headers.get('content-type'), 'application/vnd.api+json');
});

test('handles body with toJSON method', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	const body = {
		value: 42,
		toJSON() {
			return {serialized: this.value};
		},
	};

	await fetchWithJson('/api', {method: 'POST', body});

	const {options} = mockFetch.calls[0];
	t.is(options.body, '{"serialized":42}');
});

test('handles empty object body', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	await fetchWithJson('/api', {method: 'POST', body: {}});

	const {options} = mockFetch.calls[0];
	t.is(options.body, '{}');
	t.is(options.headers.get('content-type'), 'application/json');
});

test('handles empty array body', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	await fetchWithJson('/api', {method: 'POST', body: []});

	const {options} = mockFetch.calls[0];
	t.is(options.body, '[]');
	t.is(options.headers.get('content-type'), 'application/json');
});

test('respects Content-Type set via array-of-tuples headers', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	await fetchWithJson('/api', {
		method: 'POST',
		body: {name: 'Alice'},
		headers: [['Content-Type', 'application/vnd.api+json']],
	});

	const {options} = mockFetch.calls[0];
	t.is(options.body, '{"name":"Alice"}');
	t.is(options.headers.get('content-type'), 'application/vnd.api+json');
});

test('multiple calls do not share state', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	await fetchWithJson('/api', {method: 'POST', body: {first: true}});
	await fetchWithJson('/api', {method: 'POST', body: {second: true}});

	t.is(mockFetch.calls[0].options.body, '{"first":true}');
	t.is(mockFetch.calls[1].options.body, '{"second":true}');
	// Ensure the second call's headers don't leak from the first
	t.is(mockFetch.calls[0].options.headers.get('content-type'), 'application/json');
	t.is(mockFetch.calls[1].options.headers.get('content-type'), 'application/json');
});

test('does not mutate the original options object', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	const options = {method: 'POST', body: {name: 'Alice'}};
	await fetchWithJson('/api', options);

	// The original body should still be the plain object, not the stringified version
	t.deepEqual(options.body, {name: 'Alice'});
	t.is(options.headers, undefined);
});

test('string body is passed through unchanged even if it looks like JSON', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	const alreadyStringified = JSON.stringify({name: 'Alice'});
	await fetchWithJson('/api', {method: 'POST', body: alreadyStringified});

	const {options} = mockFetch.calls[0];
	// String body passes through as-is; no double-stringify, no Content-Type set
	t.is(options.body, '{"name":"Alice"}');
	t.is(options.headers, undefined);
});

test('undefined values in object body are stripped by JSON.stringify', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	await fetchWithJson('/api', {method: 'POST', body: {present: 1, missing: undefined}});

	const {options} = mockFetch.calls[0];
	t.is(options.body, '{"present":1}');
});

test('rejects when JSON.stringify throws on circular reference', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	const circular = {};
	circular.self = circular;

	await t.throwsAsync(() => fetchWithJson('/api', {method: 'POST', body: circular}), {
		instanceOf: TypeError,
	});

	t.is(mockFetch.calls.length, 0);
});

test('passes through Blob body unchanged', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithJson = withJsonBody(mockFetch);

	const blob = new Blob(['hello'], {type: 'text/plain'});
	await fetchWithJson('/api', {method: 'POST', body: blob});

	const {options} = mockFetch.calls[0];
	t.true(options.body instanceof Blob);
});

test('composes with withRetry - stringified body is replayable', async t => {
	let attempt = 0;

	const mockFetch = async (_url, options = {}) => {
		attempt++;

		if (attempt === 1) {
			return new Response(null, {status: 503});
		}

		return new Response(options.body, {status: 200});
	};

	const apiFetch = pipeline(
		mockFetch,
		withJsonBody,
		f => withRetry(f, {retries: 1, backoff: () => 0}),
	);

	const response = await apiFetch('/api', {method: 'PUT', body: {name: 'Alice'}});

	t.is(response.status, 200);
	t.is(await response.text(), '{"name":"Alice"}');
	t.is(attempt, 2);
});

test('composes with withRetry for Request body overrides without replaying stale body headers', async t => {
	const contentTypes = [];
	const contentLanguages = [];

	const mockFetch = async (urlOrRequest, options = {}) => {
		const request = new Request(urlOrRequest, options);
		contentTypes.push(request.headers.get('content-type'));
		contentLanguages.push(request.headers.get('content-language'));

		if (contentTypes.length === 1) {
			return new Response(null, {status: 503});
		}

		return new Response(null, {status: 200});
	};

	const apiFetch = pipeline(
		mockFetch,
		withJsonBody,
		f => withRetry(f, {retries: 1, backoff: () => 0}),
	);

	const request = new Request('https://example.com/api', {
		method: 'PUT',
		headers: {
			'content-type': 'text/plain;charset=UTF-8',
			'content-language': 'en',
		},
		body: 'original',
	});

	const response = await apiFetch(request, {body: {name: 'Alice'}});

	t.is(response.status, 200);
	t.deepEqual(contentTypes, ['application/json', 'application/json']);
	t.deepEqual(contentLanguages, [null, null]);
});

test('composes with withRetry by serializing JSON bodies only once', async t => {
	let nonce = 0;
	const bodies = [];

	const mockFetch = async (_urlOrRequest, options = {}) => {
		bodies.push(options.body);

		if (bodies.length === 1) {
			return new Response(null, {status: 503});
		}

		return new Response(null, {status: 200});
	};

	const apiFetch = pipeline(
		mockFetch,
		withJsonBody,
		f => withRetry(f, {retries: 1, backoff: () => 0}),
	);

	const response = await apiFetch('https://example.com/api', {
		method: 'PUT',
		body: {
			toJSON() {
				return {nonce: ++nonce};
			},
		},
	});

	t.is(response.status, 200);
	t.deepEqual(bodies, ['{"nonce":1}', '{"nonce":1}']);
});

test('composes with withTokenRefresh for Request body overrides without replaying stale body headers', async t => {
	const contentTypes = [];
	const contentLanguages = [];

	const mockFetch = async (urlOrRequest, options = {}) => {
		const request = new Request(urlOrRequest, options);
		contentTypes.push(request.headers.get('content-type'));
		contentLanguages.push(request.headers.get('content-language'));

		if (contentTypes.length === 1) {
			return new Response(null, {status: 401});
		}

		return new Response(null, {status: 200});
	};

	const apiFetch = pipeline(
		mockFetch,
		withJsonBody,
		f => withTokenRefresh(f, {
			async refreshToken() {
				return 'new-token';
			},
		}),
	);

	const request = new Request('https://example.com/api', {
		method: 'POST',
		headers: {
			'content-type': 'text/plain;charset=UTF-8',
			'content-language': 'en',
		},
		body: 'original',
	});

	const response = await apiFetch(request, {body: {name: 'Alice'}});

	t.is(response.status, 200);
	t.deepEqual(contentTypes, ['application/json', 'application/json']);
	t.deepEqual(contentLanguages, [null, null]);
});

test('composes with withTokenRefresh by serializing JSON bodies only once', async t => {
	let nonce = 0;
	const bodies = [];

	const mockFetch = async (_urlOrRequest, options = {}) => {
		bodies.push(options.body);

		if (bodies.length === 1) {
			return new Response(null, {status: 401});
		}

		return new Response(null, {status: 200});
	};

	const apiFetch = pipeline(
		mockFetch,
		withJsonBody,
		f => withTokenRefresh(f, {
			async refreshToken() {
				return 'new-token';
			},
		}),
	);

	const response = await apiFetch('https://example.com/api', {
		method: 'POST',
		body: {
			toJSON() {
				return {nonce: ++nonce};
			},
		},
	});

	t.is(response.status, 200);
	t.deepEqual(bodies, ['{"nonce":1}', '{"nonce":1}']);
});
