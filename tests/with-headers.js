import test from 'ava';
import {withHeaders} from '../source/index.js';

const createCapturingFetch = () => {
	const calls = [];

	const mockFetch = async (urlOrRequest, options = {}) => {
		calls.push({urlOrRequest, options});
		return new Response(null, {status: 200});
	};

	mockFetch.calls = calls;
	return mockFetch;
};

test('withHeaders - adds default headers when none provided', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, {Authorization: 'Bearer token'});

	await fetchWithHeaders('/api');

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('authorization'), 'Bearer token');
});

test('withHeaders - call-site headers override defaults for same key', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, {Authorization: 'Bearer default'});

	await fetchWithHeaders('/api', {headers: {Authorization: 'Bearer override'}});

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('authorization'), 'Bearer override');
});

test('withHeaders - call-site and default headers with different keys are merged', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, {Authorization: 'Bearer token'});

	await fetchWithHeaders('/api', {headers: {'Content-Type': 'application/json'}});

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('authorization'), 'Bearer token');
	t.is(options.headers.get('content-type'), 'application/json');
});

test('withHeaders - header name matching is case-insensitive', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, {'Content-Type': 'text/plain'});

	await fetchWithHeaders('/api', {headers: {'content-type': 'application/json'}});

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('content-type'), 'application/json');
	t.is([...options.headers].filter(([key]) => key === 'content-type').length, 1);
});

test('withHeaders - uses Request headers as call-site headers', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, {Authorization: 'Bearer default', 'X-Default': 'yes'});

	const request = new Request('https://example.com/api', {headers: {Authorization: 'Bearer from-request'}});
	await fetchWithHeaders(request);

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('authorization'), 'Bearer from-request');
	t.is(options.headers.get('x-default'), 'yes');
});

test('withHeaders - options.headers takes priority over Request headers', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, {Authorization: 'Bearer default'});

	const request = new Request('https://example.com/api', {headers: {Authorization: 'Bearer from-request'}});
	await fetchWithHeaders(request, {headers: {Authorization: 'Bearer from-options'}});

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('authorization'), 'Bearer from-options');
});

test('withHeaders - Request body overrides preserve inherited body headers on the initial request', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, {'X-Default': 'yes'});

	const request = new Request('https://example.com/api', {
		method: 'POST',
		body: JSON.stringify({old: true}),
		headers: {
			'Content-Type': 'application/json',
			'Content-Language': 'en',
			Authorization: 'Bearer from-request',
		},
	});

	await fetchWithHeaders(request, {body: 'replacement body'});

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('content-type'), 'application/json');
	t.is(options.headers.get('content-language'), 'en');
	t.is(options.headers.get('authorization'), 'Bearer from-request');
	t.is(options.headers.get('x-default'), 'yes');
});

test('withHeaders - Request body overrides preserve inherited Request body headers over defaults on the initial request', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, {
		'Content-Type': 'application/json',
		'Content-Language': 'fr',
		'X-Default': 'yes',
	});

	const request = new Request('https://example.com/api', {
		method: 'POST',
		body: 'old body',
		headers: {
			Authorization: 'Bearer from-request',
		},
	});

	await fetchWithHeaders(request, {body: 'replacement body'});

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('content-type'), 'text/plain;charset=UTF-8');
	t.is(options.headers.get('content-language'), 'fr');
	t.is(options.headers.get('authorization'), 'Bearer from-request');
	t.is(options.headers.get('x-default'), 'yes');
});

test('withHeaders - Request body overrides preserve explicit per-call body headers on the initial request', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, {
		'Content-Type': 'application/json',
		'Content-Language': 'fr',
		'X-Default': 'yes',
	});

	const request = new Request('https://example.com/api', {
		method: 'POST',
		body: 'old body',
		headers: {
			'Content-Type': 'text/plain;charset=UTF-8',
			'Content-Language': 'en',
			Authorization: 'Bearer from-request',
		},
	});

	await fetchWithHeaders(request, {
		body: 'replacement body',
		headers: {
			'Content-Type': 'application/x-www-form-urlencoded',
			'Content-Language': 'de',
			'Content-Length': '16',
			'X-Trace': 'abc',
		},
	});

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('content-type'), 'application/x-www-form-urlencoded');
	t.is(options.headers.get('content-language'), 'de');
	t.is(options.headers.get('content-length'), '16');
	t.is(options.headers.get('authorization'), 'Bearer from-request');
	t.is(options.headers.get('x-default'), 'yes');
	t.is(options.headers.get('x-trace'), 'abc');
});

test('withHeaders - preserves non-conflicting Request headers when options.headers is also provided', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, {});

	const request = new Request('https://example.com/api', {headers: {'Content-Type': 'application/json', Authorization: 'Bearer from-request'}});
	await fetchWithHeaders(request, {headers: {'X-Trace': 'abc'}});

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('content-type'), 'application/json');
	t.is(options.headers.get('authorization'), 'Bearer from-request');
	t.is(options.headers.get('x-trace'), 'abc');
});

test('withHeaders - URL object is forwarded unchanged with defaults applied', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, {Authorization: 'Bearer token'});

	const url = new URL('https://example.com/api');
	await fetchWithHeaders(url);

	t.is(mockFetch.calls[0].urlOrRequest, url);
	t.is(mockFetch.calls[0].options.headers.get('authorization'), 'Bearer token');
});

test('withHeaders - passes other options through unchanged', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, {});

	await fetchWithHeaders('/api', {method: 'POST', body: 'data'});

	const {options} = mockFetch.calls[0];
	t.is(options.method, 'POST');
	t.is(options.body, 'data');
});

test('withHeaders - calls do not share header state', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, {Authorization: 'Bearer token'});

	await fetchWithHeaders('/api', {headers: {'X-Extra': 'only-first-call'}});
	await fetchWithHeaders('/api');

	t.is(mockFetch.calls[1].options.headers.get('x-extra'), null);
	t.is(mockFetch.calls[1].options.headers.get('authorization'), 'Bearer token');
});

test('withHeaders - composed wrappers merge all header sets', async t => {
	const mockFetch = createCapturingFetch();
	const innerFetch = withHeaders(mockFetch, {'X-Inner': 'inner', Authorization: 'inner-token'});
	const outerFetch = withHeaders(innerFetch, {'X-Outer': 'outer', Authorization: 'outer-token'});

	await outerFetch('/api', {headers: {'X-Call': 'call'}});

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('x-inner'), 'inner');
	t.is(options.headers.get('x-outer'), 'outer');
	t.is(options.headers.get('x-call'), 'call');
	// Outer defaults take priority over inner defaults
	t.is(options.headers.get('authorization'), 'outer-token');
});

test('withHeaders - composed wrappers: call-site headers beat all defaults', async t => {
	const mockFetch = createCapturingFetch();
	const innerFetch = withHeaders(mockFetch, {Authorization: 'inner-token'});
	const outerFetch = withHeaders(innerFetch, {Authorization: 'outer-token'});

	await outerFetch('/api', {headers: {Authorization: 'call-token'}});

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('authorization'), 'call-token');
});

test('withHeaders - accepts Headers instance as defaultHeaders', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, new Headers({Authorization: 'Bearer token'}));

	await fetchWithHeaders('/api');

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('authorization'), 'Bearer token');
});

test('withHeaders - accepts array of tuples as defaultHeaders', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, [['Authorization', 'Bearer token'], ['X-Custom', 'value']]);

	await fetchWithHeaders('/api');

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('authorization'), 'Bearer token');
	t.is(options.headers.get('x-custom'), 'value');
});

test('withHeaders - explicit undefined options falls back to defaults', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, {Authorization: 'Bearer token'});

	await fetchWithHeaders('/api', undefined);

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('authorization'), 'Bearer token');
});

test('withHeaders - accepts a sync function that returns headers', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, () => ({Authorization: 'Bearer dynamic-token'}));

	await fetchWithHeaders('/api');

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('authorization'), 'Bearer dynamic-token');
});

test('withHeaders - accepts an async function that returns headers', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, async () => ({Authorization: 'Bearer async-token'}));

	await fetchWithHeaders('/api');

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('authorization'), 'Bearer async-token');
});

test('withHeaders - already-aborted requests do not await async default headers', async t => {
	const mockFetch = createCapturingFetch();
	const abortController = new AbortController();
	let didCallResolver = false;
	const fetchWithHeaders = withHeaders(mockFetch, async () => {
		didCallResolver = true;
		return {Authorization: 'Bearer async-token'};
	});

	abortController.abort();

	await t.throwsAsync(fetchWithHeaders('/api', {signal: abortController.signal}), {name: 'AbortError'});
	t.false(didCallResolver);
	t.is(mockFetch.calls.length, 0);
});

test('withHeaders - abort interrupts pending async default headers', async t => {
	const mockFetch = createCapturingFetch();
	const abortController = new AbortController();
	let resolveDefaultHeaders;
	let notifyStarted;
	const started = new Promise(resolve => {
		notifyStarted = resolve;
	});
	const fetchWithHeaders = withHeaders(mockFetch, async () => {
		notifyStarted();
		return new Promise(resolve => {
			resolveDefaultHeaders = resolve;
		});
	});

	const pendingRequest = fetchWithHeaders('/api', {signal: abortController.signal});
	await started;
	abortController.abort();

	await t.throwsAsync(pendingRequest, {name: 'AbortError'});
	resolveDefaultHeaders({Authorization: 'Bearer async-token'});
	t.is(mockFetch.calls.length, 0);
});

test('withHeaders - function is called on every request', async t => {
	const mockFetch = createCapturingFetch();
	let callCount = 0;
	const fetchWithHeaders = withHeaders(mockFetch, () => {
		callCount++;
		return {'X-Count': String(callCount)};
	});

	await fetchWithHeaders('/api');
	await fetchWithHeaders('/api');
	await fetchWithHeaders('/api');

	t.is(callCount, 3);
	t.is(mockFetch.calls[0].options.headers.get('x-count'), '1');
	t.is(mockFetch.calls[1].options.headers.get('x-count'), '2');
	t.is(mockFetch.calls[2].options.headers.get('x-count'), '3');
});

test('withHeaders - per-call headers override function-returned defaults', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, () => ({
		Authorization: 'Bearer default',
		'X-Default': 'yes',
	}));

	await fetchWithHeaders('/api', {headers: {Authorization: 'Bearer override'}});

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('authorization'), 'Bearer override');
	t.is(options.headers.get('x-default'), 'yes');
});

test('withHeaders - function-returned headers merge with Request headers', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, () => ({'X-Default': 'yes'}));

	const request = new Request('https://example.com/api', {headers: {Authorization: 'Bearer from-request'}});
	await fetchWithHeaders(request);

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('authorization'), 'Bearer from-request');
	t.is(options.headers.get('x-default'), 'yes');
});

test('withHeaders - function returning Headers instance', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, () => new Headers({Authorization: 'Bearer from-headers-instance'}));

	await fetchWithHeaders('/api');

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('authorization'), 'Bearer from-headers-instance');
});

test('withHeaders - function returning array of tuples', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, () => [['Authorization', 'Bearer from-tuples'], ['X-Custom', 'value']]);

	await fetchWithHeaders('/api');

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('authorization'), 'Bearer from-tuples');
	t.is(options.headers.get('x-custom'), 'value');
});

test('withHeaders - composed wrappers with mixed function and static headers', async t => {
	const mockFetch = createCapturingFetch();
	const innerFetch = withHeaders(mockFetch, {'X-Inner': 'inner', Authorization: 'inner-token'});
	const outerFetch = withHeaders(innerFetch, () => ({'X-Outer': 'outer', Authorization: 'outer-token'}));

	await outerFetch('/api', {headers: {'X-Call': 'call'}});

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('x-inner'), 'inner');
	t.is(options.headers.get('x-outer'), 'outer');
	t.is(options.headers.get('x-call'), 'call');
	t.is(options.headers.get('authorization'), 'outer-token');
});

test('withHeaders - body-header inheritance with function-based defaults', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, () => ({'X-Default': 'yes'}));

	const request = new Request('https://example.com/api', {
		method: 'POST',
		body: JSON.stringify({old: true}),
		headers: {
			'Content-Type': 'application/json',
			Authorization: 'Bearer from-request',
		},
	});

	await fetchWithHeaders(request, {body: 'replacement body'});

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('content-type'), 'application/json');
	t.is(options.headers.get('authorization'), 'Bearer from-request');
	t.is(options.headers.get('x-default'), 'yes');
});

test('withHeaders - body-header inheritance with function-based defaults that include body headers', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, () => ({
		'Content-Type': 'application/json',
		'Content-Language': 'fr',
		'X-Default': 'yes',
	}));

	const request = new Request('https://example.com/api', {
		method: 'POST',
		body: 'old body',
		headers: {
			Authorization: 'Bearer from-request',
		},
	});

	await fetchWithHeaders(request, {body: 'replacement body'});

	const {options} = mockFetch.calls[0];
	// Request's auto-assigned Content-Type differs from function default, so it's inherited
	t.is(options.headers.get('content-type'), 'text/plain;charset=UTF-8');
	t.is(options.headers.get('content-language'), 'fr');
	t.is(options.headers.get('authorization'), 'Bearer from-request');
	t.is(options.headers.get('x-default'), 'yes');
});

test('withHeaders - function calls do not share header state across requests', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, () => ({Authorization: 'Bearer token'}));

	await fetchWithHeaders('/api', {headers: {'X-Extra': 'only-first-call'}});
	await fetchWithHeaders('/api');

	t.is(mockFetch.calls[1].options.headers.get('x-extra'), null);
	t.is(mockFetch.calls[1].options.headers.get('authorization'), 'Bearer token');
});

test('withHeaders - function header name matching is case-insensitive', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, () => ({'Content-Type': 'text/plain'}));

	await fetchWithHeaders('/api', {headers: {'content-type': 'application/json'}});

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('content-type'), 'application/json');
	t.is([...options.headers].filter(([key]) => key === 'content-type').length, 1);
});

test('withHeaders - concurrent requests with function-based headers resolve independently', async t => {
	const mockFetch = createCapturingFetch();
	let callCount = 0;
	const fetchWithHeaders = withHeaders(mockFetch, async () => {
		callCount++;
		const current = callCount;
		// Simulate async delay so requests overlap
		await new Promise(resolve => {
			setTimeout(resolve, 10);
		});
		return {'X-Request-Id': String(current)};
	});

	await Promise.all([
		fetchWithHeaders('/api/1'),
		fetchWithHeaders('/api/2'),
		fetchWithHeaders('/api/3'),
	]);

	t.is(callCount, 3);
	const ids = new Set([
		mockFetch.calls[0].options.headers.get('x-request-id'),
		mockFetch.calls[1].options.headers.get('x-request-id'),
		mockFetch.calls[2].options.headers.get('x-request-id'),
	]);
	t.is(ids.size, 3);
});

test('withHeaders - sync function that throws propagates error', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, () => {
		throw new Error('header resolution failed');
	});

	await t.throwsAsync(fetchWithHeaders('/api'), {message: 'header resolution failed'});
	t.is(mockFetch.calls.length, 0);
});

test('withHeaders - async function that rejects propagates error', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, async () => {
		throw new Error('async header resolution failed');
	});

	await t.throwsAsync(fetchWithHeaders('/api'), {message: 'async header resolution failed'});
	t.is(mockFetch.calls.length, 0);
});

test('withHeaders - function returning empty object applies per-call headers', async t => {
	const mockFetch = createCapturingFetch();
	const fetchWithHeaders = withHeaders(mockFetch, () => ({}));

	await fetchWithHeaders('/api', {headers: {'X-Custom': 'value'}});

	const {options} = mockFetch.calls[0];
	t.is(options.headers.get('x-custom'), 'value');
});

test('withHeaders - already-aborted Request.signal does not await async default headers', async t => {
	const mockFetch = createCapturingFetch();
	const abortController = new AbortController();
	let didCallResolver = false;
	const fetchWithHeaders = withHeaders(mockFetch, async () => {
		didCallResolver = true;
		return {Authorization: 'Bearer async-token'};
	});

	abortController.abort();
	const request = new Request('https://example.com/api', {signal: abortController.signal});

	await t.throwsAsync(fetchWithHeaders(request), {name: 'AbortError'});
	t.false(didCallResolver);
	t.is(mockFetch.calls.length, 0);
});
