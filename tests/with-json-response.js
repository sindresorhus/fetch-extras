import test from 'ava';
import {SchemaValidationError, withJsonResponse} from '../source/index.js';

const createMockFetch = (body, {status = 200, statusText = 'OK'} = {}) => async url => {
	const response = new Response(JSON.stringify(body), {status, statusText});
	Object.defineProperty(response, 'url', {value: url});
	return response;
};

const createMockSchema = validate => ({
	'~standard': {
		version: 1,
		vendor: 'test',
		validate,
	},
});

const createPassthroughSchema = () => createMockSchema(value => ({value}));

const createFailingSchema = issues => createMockSchema(() => ({issues}));

const createNoBodySchema = t => createMockSchema(() => {
	t.fail();
});

const noBodyResponseCases = [
	{
		title: 'empty response body',
		createFetch: () => async () => new Response(''),
		checkError(t, error) {
			t.regex(error.message, /end of json input/i);
		},
	},
	{
		title: '204 no-content response',
		createFetch: () => async () => new Response(null, {status: 204}),
	},
	{
		title: '205 no-content response',
		createFetch: () => async () => new Response(null, {status: 205}),
	},
	{
		title: 'HEAD response with empty body',
		createFetch: t => async (url, options) => {
			t.is(url, '/api');
			t.is(options.method, 'HEAD');
			return new Response('');
		},
		options: {method: 'HEAD'},
	},
];

async function expectJsonSyntaxError(t, fetchFunction, options = {}) {
	const error = await t.throwsAsync(fetchFunction('/api', options), {
		instanceOf: SyntaxError,
	});

	return error;
}

test('returns parsed JSON without schema', async t => {
	const mockFetch = createMockFetch({name: 'Alice', age: 30});
	const fetchJson = withJsonResponse(mockFetch);

	const result = await fetchJson('/api/user');
	t.deepEqual(result, {name: 'Alice', age: 30});
});

test('returns parsed JSON array without schema', async t => {
	const mockFetch = createMockFetch([1, 2, 3]);
	const fetchJson = withJsonResponse(mockFetch);

	const result = await fetchJson('/api/items');
	t.deepEqual(result, [1, 2, 3]);
});

test('validates JSON response with schema and returns validated value', async t => {
	const mockFetch = createMockFetch({name: 'Alice', age: 30});
	const schema = createPassthroughSchema();
	const fetchWithSchema = withJsonResponse(mockFetch, {schema});

	const result = await fetchWithSchema('/api/user');
	t.deepEqual(result, {name: 'Alice', age: 30});
});

test('schema can transform the value', async t => {
	const mockFetch = createMockFetch({name: 'Alice', age: '30'});
	const schema = createMockSchema(value => ({value: {...value, age: Number(value.age)}}));
	const fetchWithSchema = withJsonResponse(mockFetch, {schema});

	const result = await fetchWithSchema('/api/user');
	t.deepEqual(result, {name: 'Alice', age: 30});
});

test('throws SchemaValidationError on validation failure', async t => {
	const mockFetch = createMockFetch({name: 123});
	const issues = [{message: 'Expected string, received number', path: ['name']}];
	const schema = createFailingSchema(issues);
	const fetchWithSchema = withJsonResponse(mockFetch, {schema});

	const error = await t.throwsAsync(fetchWithSchema('/api/user'), {
		instanceOf: SchemaValidationError,
	});

	t.is(error.name, 'SchemaValidationError');
	t.is(error.code, 'ERR_SCHEMA_VALIDATION');
	t.is(error.message, 'Response JSON validation failed');
	t.deepEqual(error.issues, issues);
	t.true(error.response instanceof Response);
});

test('SchemaValidationError is instanceof Error', t => {
	const error = new SchemaValidationError(
		[{message: 'test'}],
		new Response(),
	);
	t.true(error instanceof Error);
	t.true(error instanceof SchemaValidationError);
});

test('works with async schema validators', async t => {
	const mockFetch = createMockFetch({id: 1});
	const schema = createMockSchema(async value => ({value}));
	const fetchWithSchema = withJsonResponse(mockFetch, {schema});

	const result = await fetchWithSchema('/api/item');
	t.deepEqual(result, {id: 1});
});

test('throws TypeError for non-object schema', t => {
	const mockFetch = createMockFetch({});

	t.throws(() => withJsonResponse(mockFetch, {schema: 'not a schema'}), {
		instanceOf: TypeError,
		message: /Standard Schema/,
	});
});

test('throws TypeError for null schema', t => {
	const mockFetch = createMockFetch({});

	t.throws(() => withJsonResponse(mockFetch, {schema: null}), {
		instanceOf: TypeError,
		message: /Standard Schema/,
	});
});

test('throws TypeError for object without ~standard property', t => {
	const mockFetch = createMockFetch({});

	t.throws(() => withJsonResponse(mockFetch, {schema: {}}), {
		instanceOf: TypeError,
		message: /Standard Schema/,
	});
});

test('throws TypeError for object with invalid ~standard property', t => {
	const mockFetch = createMockFetch({});

	t.throws(() => withJsonResponse(mockFetch, {schema: {'~standard': 'invalid'}}), {
		instanceOf: TypeError,
		message: /Standard Schema/,
	});
});

test('throws TypeError for schema without validate function', t => {
	const mockFetch = createMockFetch({});
	const schema = {'~standard': {version: 1, vendor: 'test'}};

	t.throws(() => withJsonResponse(mockFetch, {schema}), {
		instanceOf: TypeError,
		message: /Standard Schema/,
	});
});

test('forwards request options to the underlying fetch', async t => {
	const mockFetch = async (url, options) => {
		t.is(url, '/api/user');
		t.is(options.method, 'POST');
		t.deepEqual(Object.fromEntries(new Headers(options.headers)), {'x-custom': 'value'});
		return new Response(JSON.stringify({ok: true}));
	};

	const fetchJson = withJsonResponse(mockFetch);
	const result = await fetchJson('/api/user', {method: 'POST', headers: {'x-custom': 'value'}});
	t.deepEqual(result, {ok: true});
});

test('works with Request object as input', async t => {
	const mockFetch = async request => {
		t.true(request instanceof Request);
		return new Response(JSON.stringify({id: 42}));
	};

	const fetchJson = withJsonResponse(mockFetch);
	const result = await fetchJson(new Request('https://example.com/api'));
	t.deepEqual(result, {id: 42});
});

test('works with null JSON value', async t => {
	const mockFetch = async () => new Response('null');
	const fetchJson = withJsonResponse(mockFetch);

	const result = await fetchJson('/api');
	t.is(result, null);
});

test('works with primitive JSON values', async t => {
	const fetchJson = withJsonResponse(async () => new Response(JSON.stringify(42)));
	t.is(await fetchJson('/api'), 42);

	const fetchString = withJsonResponse(async () => new Response(JSON.stringify('hello')));
	t.is(await fetchString('/api'), 'hello');

	const fetchBool = withJsonResponse(async () => new Response(JSON.stringify(true)));
	t.is(await fetchBool('/api'), true);
});

test('SchemaValidationError exposes response url and status', async t => {
	const mockFetch = createMockFetch({name: 123}, {status: 200});
	const issues = [{message: 'Expected string'}];
	const schema = createFailingSchema(issues);
	const fetchWithSchema = withJsonResponse(mockFetch, {schema});

	const error = await t.throwsAsync(fetchWithSchema('https://example.com/api/user'), {
		instanceOf: SchemaValidationError,
	});

	t.is(error.response.status, 200);
	t.is(error.response.url, 'https://example.com/api/user');
});

test('throws SyntaxError for non-JSON response', async t => {
	const mockFetch = async () => new Response('<html>Not Found</html>');
	const fetchJson = withJsonResponse(mockFetch);

	await t.throwsAsync(fetchJson('/api'), {
		instanceOf: SyntaxError,
	});
});

for (const {title, createFetch, options, checkError} of noBodyResponseCases) {
	test(`throws SyntaxError for ${title}`, async t => {
		const fetchFunction = createFetch(t);
		const error = await expectJsonSyntaxError(t, withJsonResponse(fetchFunction), options);
		checkError?.(t, error);
	});
}

for (const {title, createFetch, options} of noBodyResponseCases) {
	test(`${title} throws before schema validation`, async t => {
		const fetchFunction = createFetch(t);
		const fetchWithSchema = withJsonResponse(fetchFunction, {schema: createNoBodySchema(t)});

		await expectJsonSyntaxError(t, fetchWithSchema, options);
	});
}

test('async schema validation failure', async t => {
	const mockFetch = createMockFetch({name: 123});
	const issues = [{message: 'Expected string', path: ['name']}];
	const schema = createMockSchema(async () => ({issues}));
	const fetchWithSchema = withJsonResponse(mockFetch, {schema});

	const error = await t.throwsAsync(fetchWithSchema('/api/user'), {
		instanceOf: SchemaValidationError,
	});

	t.deepEqual(error.issues, issues);
});

test('preserves fetch metadata through wrapper', async t => {
	const {timeoutDurationSymbol} = await import('../source/utilities.js');
	const mockFetch = createMockFetch({});
	mockFetch[timeoutDurationSymbol] = 5000;

	const fetchJson = withJsonResponse(mockFetch);
	t.is(fetchJson[timeoutDurationSymbol], 5000);
});

test('wrapped function can be called multiple times', async t => {
	let callCount = 0;
	const mockFetch = async () => {
		callCount++;
		return new Response(JSON.stringify({count: callCount}));
	};

	const fetchJson = withJsonResponse(mockFetch);
	t.deepEqual(await fetchJson('/api'), {count: 1});
	t.deepEqual(await fetchJson('/api'), {count: 2});
	t.deepEqual(await fetchJson('/api'), {count: 3});
});

test('propagates fetch errors', async t => {
	const mockFetch = async () => {
		throw new TypeError('Failed to fetch');
	};

	const fetchJson = withJsonResponse(mockFetch);
	await t.throwsAsync(fetchJson('/api'), {
		instanceOf: TypeError,
		message: 'Failed to fetch',
	});
});

test('propagates errors thrown by the schema validator', async t => {
	const mockFetch = createMockFetch({name: 'Alice'});
	const schema = createMockSchema(() => {
		throw new Error('Validator crashed');
	});
	const fetchWithSchema = withJsonResponse(mockFetch, {schema});

	await t.throwsAsync(fetchWithSchema('/api'), {
		message: 'Validator crashed',
	});
});

test('preserves multiple validation issues', async t => {
	const mockFetch = createMockFetch({name: 123, age: 'not a number'});
	const issues = [
		{message: 'Expected string', path: ['name']},
		{message: 'Expected number', path: ['age']},
		{message: 'Missing field', path: ['email']},
	];
	const schema = createFailingSchema(issues);
	const fetchWithSchema = withJsonResponse(mockFetch, {schema});

	const error = await t.throwsAsync(fetchWithSchema('/api'), {
		instanceOf: SchemaValidationError,
	});

	t.is(error.issues.length, 3);
	t.deepEqual(error.issues, issues);
});

test('schema can strip extra fields from the value', async t => {
	const mockFetch = createMockFetch({name: 'Alice', age: 30, extra: 'field'});
	const schema = createMockSchema(value => ({value: {name: value.name, age: value.age}}));
	const fetchWithSchema = withJsonResponse(mockFetch, {schema});

	const result = await fetchWithSchema('/api/user');
	t.deepEqual(result, {name: 'Alice', age: 30});
});

test('empty options object behaves like no schema', async t => {
	const mockFetch = createMockFetch({id: 1});
	const fetchJson = withJsonResponse(mockFetch, {});

	const result = await fetchJson('/api');
	t.deepEqual(result, {id: 1});
});

test('SchemaValidationError has a stack trace', t => {
	const error = new SchemaValidationError([{message: 'test'}], new Response());
	t.true(error.stack.includes('SchemaValidationError'));
});

test('works with callable schema objects', async t => {
	const mockFetch = createMockFetch({name: 'Alice'});
	const schema = Object.assign(
		() => {},
		{
			'~standard': {
				version: 1,
				vendor: 'test',
				validate: value => ({value}),
			},
		},
	);
	const fetchWithSchema = withJsonResponse(mockFetch, {schema});

	const result = await fetchWithSchema('/api/user');
	t.deepEqual(result, {name: 'Alice'});
});
