import test from 'ava';
import {pipeline, withHttpError, withResponse} from '../source/index.js';

test('transforms response with sync transform', async t => {
	const fetchFunction = withResponse(response => response.status)(async () => new Response('ok', {status: 201}));

	t.is(await fetchFunction('/api'), 201);
});

test('transforms response with async transform', async t => {
	const fetchFunction = withResponse(response => response.text())(async () => new Response('hello'));

	t.is(await fetchFunction('/api'), 'hello');
});

test('lets callers handle empty responses', async t => {
	const fetchFunction = withResponse(response => {
		if (response.status === 204 || response.status === 205) {
			return undefined;
		}

		return response.json();
	})(async () => new Response(null, {status: 204}));

	t.is(await fetchFunction('/api'), undefined);
});

test('forwards request arguments to the underlying fetch', async t => {
	const fetchFunction = withResponse(response => response.status)(async (url, options) => {
		t.is(url, '/api');
		t.is(options.method, 'POST');
		return new Response('ok');
	});

	t.is(await fetchFunction('/api', {method: 'POST'}), 200);
});

test('throws TypeError for invalid transform', t => {
	t.throws(() => withResponse('json'), {
		instanceOf: TypeError,
		message: 'Expected a response transform function',
	});
});

test('propagates fetch errors', async t => {
	const fetchFunction = withResponse(response => response.status)(async () => {
		throw new TypeError('Failed to fetch');
	});

	await t.throwsAsync(fetchFunction('/api'), {
		instanceOf: TypeError,
		message: 'Failed to fetch',
	});
});

test('propagates transform errors', async t => {
	const fetchFunction = withResponse(() => {
		throw new Error('Transform failed');
	})(async () => new Response('ok'));

	await t.throwsAsync(fetchFunction('/api'), {
		message: 'Transform failed',
	});
});

test('works with a Request object', async t => {
	const fetchFunction = withResponse(response => response.status)(async (input, options) => {
		t.true(input instanceof Request);
		t.is(input.url, 'https://example.com/api');
		t.is(options.method, 'PUT');
		return new Response('ok', {status: 200});
	});

	t.is(await fetchFunction(new Request('https://example.com/api'), {method: 'PUT'}), 200);
});

test('works when called without options argument', async t => {
	const fetchFunction = withResponse(response => response.text())(async (url, options) => {
		t.is(url, '/api');
		t.deepEqual(options, {});
		return new Response('hello');
	});

	t.is(await fetchFunction('/api'), 'hello');
});

test('composes as a terminal pipeline wrapper - success path', async t => {
	const fetchFunction = pipeline(
		async () => new Response('hello', {status: 200}),
		withHttpError(),
		withResponse(response => response.text()),
	);

	t.is(await fetchFunction('/api'), 'hello');
});

test('composes as a terminal pipeline wrapper - error path', async t => {
	const fetchFunction = pipeline(
		async () => new Response('not found', {status: 404}),
		withHttpError(),
		withResponse(response => response.text()),
	);

	const error = await t.throwsAsync(fetchFunction('/api'));

	t.is(error.response.status, 404);
});
