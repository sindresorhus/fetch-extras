import test from 'ava';
import {withDownloadProgress, withHeaders, withUploadProgress} from '../source/index.js';
import {blockedDefaultHeaderNamesSymbol} from '../source/utilities.js';

const encoder = new TextEncoder();
const uploadUrl = 'https://example.com/upload';

function encodeChunks(...chunks) {
	return chunks.map(chunk => encoder.encode(chunk));
}

function createUploadRequest({body = 'request body', ...options} = {}) {
	return new Request(uploadUrl, {method: 'POST', body, ...options});
}

function createOverrideStream(body = 'override body') {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(encoder.encode(body));
			controller.close();
		},
	});
}

async function bodyConsumingFetch(urlOrRequest, options = {}) {
	const body = options.body ?? (urlOrRequest instanceof Request ? urlOrRequest.body : undefined);

	if (body) {
		await new Response(body).arrayBuffer();
	}

	return new Response(null, {status: 200, statusText: 'OK'});
}

function makeChunkedStream(content) {
	const half = Math.trunc(content.byteLength / 2);

	return new ReadableStream({
		start(controller) {
			controller.enqueue(content.slice(0, half));
			controller.enqueue(content.slice(half));
			controller.close();
		},
	});
}

function trackUploadProgress(fetchFunction = bodyConsumingFetch) {
	const events = [];

	return {
		events,
		fetchWithUploadProgress: withUploadProgress(fetchFunction, {
			onProgress(progress) {
				events.push(progress);
			},
		}),
	};
}

function createByteStream(bytes) {
	return new ReadableStream({
		type: 'bytes',
		start(controller) {
			controller.enqueue(bytes);
			controller.close();
		},
	});
}

async function waitForMicrotask() {
	await new Promise(resolve => {
		queueMicrotask(resolve);
	});
}

async function waitForEventCount(events, count, attempts = 10) {
	if (events.length >= count || attempts === 0) {
		return;
	}

	await waitForMicrotask();
	await waitForEventCount(events, count, attempts - 1);
}

test('withUploadProgress - upload progress fires with percent increasing to 1', async t => {
	const {events, fetchWithUploadProgress} = trackUploadProgress();
	const [content] = encodeChunks('hello world');

	await fetchWithUploadProgress('https://example.com/upload', {
		method: 'POST',
		body: makeChunkedStream(content),
	});

	t.true(events.length > 0);
	t.is(events.at(-1).percent, 1);
	t.is(events.at(-1).transferredBytes, content.byteLength);

	for (let index = 1; index < events.length; index++) {
		t.true(events[index].percent >= events[index - 1].percent);
	}
});

test('withUploadProgress - tracks explicit streamed bodies directly', async t => {
	const {events, fetchWithUploadProgress} = trackUploadProgress();
	const [content] = encodeChunks('hello world');

	await fetchWithUploadProgress('https://example.com/upload', {
		method: 'POST',
		body: makeChunkedStream(content),
		duplex: 'half',
	});

	t.true(events.length > 0);
	t.is(events.at(-1).percent, 1);
	t.is(events.at(-1).transferredBytes, content.byteLength);
});

test('withUploadProgress - reports the current chunk as soon as it is read', async t => {
	const [first, second] = encodeChunks('hello ', 'world');
	const {events, fetchWithUploadProgress} = trackUploadProgress(async (url, options) => {
		const reader = options.body.getReader();

		await reader.read();

		t.deepEqual(events, [{
			percent: 0,
			transferredBytes: first.byteLength,
			totalBytes: first.byteLength,
		}]);

		await reader.read();

		t.deepEqual(events[1], {
			percent: 0,
			transferredBytes: first.byteLength + second.byteLength,
			totalBytes: first.byteLength + second.byteLength,
		});

		await reader.read();

		t.is(events.at(-1).percent, 1);
		t.is(events.at(-1).transferredBytes, first.byteLength + second.byteLength);
		t.is(events.at(-1).totalBytes, first.byteLength + second.byteLength);

		return new Response(null, {status: 200, statusText: 'OK'});
	});

	await fetchWithUploadProgress('https://example.com/upload', {
		method: 'POST',
		body: new ReadableStream({
			start(controller) {
				controller.enqueue(first);
				controller.enqueue(second);
				controller.close();
			},
		}),
		duplex: 'half',
	});
});

test('withUploadProgress - adds duplex when wrapping streamed bodies for URL input', async t => {
	let capturedOptions;
	let capturedRequest;
	const {fetchWithUploadProgress} = trackUploadProgress(async (url, options) => {
		capturedOptions = options;
		capturedRequest = new Request(url, options);
		return bodyConsumingFetch(url, options);
	});

	await fetchWithUploadProgress('https://example.com/upload', {
		method: 'POST',
		body: new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode('hello'));
				controller.close();
			},
		}),
	});

	t.is(capturedOptions.duplex, 'half');
	t.is(capturedRequest.method, 'POST');
});

test('withUploadProgress - preserves byte streams for BYOB consumers', async t => {
	const events = [];
	const fetchWithUploadProgress = withUploadProgress(async (url, options) => {
		const reader = options.body.getReader({mode: 'byob'});
		const {done, value} = await reader.read(new Uint8Array(8));

		t.false(done);
		t.deepEqual([...value], [0, 1, 2]);

		return new Response(null, {status: 200, statusText: 'OK'});
	}, {
		onProgress(progress) {
			events.push(progress);
		},
	});

	await fetchWithUploadProgress('https://example.com/upload', {
		method: 'POST',
		body: createByteStream(new Uint8Array([0, 1, 2])),
	});

	await waitForEventCount(events, 2);

	t.deepEqual(events, [
		{percent: 0, transferredBytes: 3, totalBytes: 3},
		{percent: 1, transferredBytes: 3, totalBytes: 3},
	]);
});

test('withUploadProgress - Request overrides preserve BYOB upload bodies', async t => {
	const events = [];
	const fetchWithUploadProgress = withUploadProgress(async (urlOrRequest, options) => {
		const reader = options.body.getReader({mode: 'byob'});
		const {done, value} = await reader.read(new Uint8Array(8));

		t.false(done);
		t.deepEqual([...value], [0, 1, 2]);
		t.is(options.duplex, 'half');

		return new Response(null, {status: 200, statusText: 'OK'});
	}, {
		onProgress(progress) {
			events.push(progress);
		},
	});

	await fetchWithUploadProgress(new Request('https://example.com/upload', {method: 'POST', body: 'request body'}), {
		body: createByteStream(new Uint8Array([0, 1, 2])),
	});

	await waitForEventCount(events, 2);

	t.deepEqual(events, [
		{percent: 0, transferredBytes: 3, totalBytes: 3},
		{percent: 1, transferredBytes: 3, totalBytes: 3},
	]);
});

test('withUploadProgress - wrapping streamed URL bodies preserves caller options', async t => {
	let capturedOptions;
	const {fetchWithUploadProgress} = trackUploadProgress(async (url, options) => {
		capturedOptions = options;
		return bodyConsumingFetch(url, options);
	});

	await fetchWithUploadProgress('https://example.com/upload', {
		method: 'PATCH',
		headers: {'x-custom': 'value'},
		body: new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode('hello'));
				controller.close();
			},
		}),
	});

	t.is(capturedOptions.method, 'PATCH');
	t.is(new Headers(capturedOptions.headers).get('x-custom'), 'value');
	t.is(capturedOptions.duplex, 'half');
});

test('withUploadProgress - upload progress works with string body', async t => {
	let capturedOptions;
	const mockFetch = async (url, options) => {
		capturedOptions = options;
		return bodyConsumingFetch(url, options);
	};

	await withUploadProgress(mockFetch, {
		onProgress() {},
	})('https://example.com/upload', {
		method: 'POST',
		body: 'hello',
	});

	t.is(capturedOptions.body, 'hello');
	t.is(capturedOptions.duplex, undefined);
});

test('withUploadProgress - upload progress does not rewrite string body before fetch infers headers', async t => {
	let contentType;
	const fetchWithUploadProgress = withUploadProgress((url, options) => {
		contentType = new Request(url, options).headers.get('content-type');
		return new Response(null, {status: 200, statusText: 'OK'});
	}, {
		onProgress() {},
	});

	await fetchWithUploadProgress('https://example.com/upload', {
		method: 'POST',
		body: 'hello',
	});

	t.is(contentType, 'text/plain;charset=UTF-8');
});

test('withUploadProgress - upload progress does not rewrite URLSearchParams body before fetch infers headers', async t => {
	let contentType;
	const searchParameters = new URLSearchParams({key: 'value'});
	const fetchWithUploadProgress = withUploadProgress((url, options) => {
		contentType = new Request(url, options).headers.get('content-type');
		return new Response(null, {status: 200, statusText: 'OK'});
	}, {
		onProgress() {},
	});

	await fetchWithUploadProgress('https://example.com/upload', {
		method: 'POST',
		body: searchParameters,
	});

	t.is(contentType, 'application/x-www-form-urlencoded;charset=UTF-8');
});

test('withUploadProgress - upload progress does not rewrite Blob body', async t => {
	let capturedOptions;
	const blob = new Blob(['hello world']);
	const {events, fetchWithUploadProgress} = trackUploadProgress(async (url, options) => {
		capturedOptions = options;
		return bodyConsumingFetch(url, options);
	});

	await fetchWithUploadProgress('https://example.com/upload', {
		method: 'POST',
		body: blob,
	});

	t.is(events.length, 0);
	t.is(capturedOptions.body, blob);
	t.is(capturedOptions.duplex, undefined);
});

test('withUploadProgress - upload progress does not rewrite ArrayBuffer body', async t => {
	let capturedOptions;
	const [{buffer}] = encodeChunks('hello');
	const {events, fetchWithUploadProgress} = trackUploadProgress(async (url, options) => {
		capturedOptions = options;
		return bodyConsumingFetch(url, options);
	});

	await fetchWithUploadProgress('https://example.com/upload', {
		method: 'POST',
		body: buffer,
	});

	t.is(events.length, 0);
	t.is(capturedOptions.body, buffer);
	t.is(capturedOptions.duplex, undefined);
});

test('withUploadProgress - upload progress does not rewrite Request body without an init override', async t => {
	let capturedRequest;
	const blob = new Blob(['hello world'], {type: 'text/plain'});
	const {events, fetchWithUploadProgress} = trackUploadProgress(async urlOrRequest => {
		capturedRequest = urlOrRequest;
		return bodyConsumingFetch(urlOrRequest);
	});

	await fetchWithUploadProgress(new Request('https://example.com/upload', {method: 'POST', body: blob}));

	t.is(events.length, 0);
	t.true(capturedRequest instanceof Request);
	t.is(capturedRequest.headers.get('content-type'), blob.type);
});

test('withUploadProgress - upload progress does not rewrite non-stream Request body overrides', async t => {
	let mergedRequest;
	let bodyText;
	const {events, fetchWithUploadProgress} = trackUploadProgress(async (urlOrRequest, options) => {
		mergedRequest = new Request(urlOrRequest, options);
		bodyText = await mergedRequest.clone().text();
		return new Response(null, {status: 200, statusText: 'OK'});
	});

	await fetchWithUploadProgress(new Request('https://example.com/upload', {
		method: 'POST',
		body: 'request body',
		headers: {'x-request': 'value'},
	}), {
		headers: {'x-call': 'value'},
		body: 'override body',
	});

	t.is(events.length, 0);
	t.is(mergedRequest.headers.get('content-type'), 'text/plain;charset=UTF-8');
	t.is(mergedRequest.headers.get('x-request'), null);
	t.is(mergedRequest.headers.get('x-call'), 'value');
	t.is(bodyText, 'override body');
});

test('withUploadProgress - upload FormData passes through without progress events', async t => {
	const {events, fetchWithUploadProgress} = trackUploadProgress();

	await fetchWithUploadProgress('https://example.com/upload', {
		method: 'POST',
		body: new FormData(),
	});

	t.is(events.length, 0);
});

test('withUploadProgress - upload progress does not rewrite URLSearchParams body', async t => {
	let capturedOptions;
	const searchParameters = new URLSearchParams({key: 'value'});
	const {events, fetchWithUploadProgress} = trackUploadProgress(async (url, options) => {
		capturedOptions = options;
		return bodyConsumingFetch(url, options);
	});

	await fetchWithUploadProgress('https://example.com/upload', {
		method: 'POST',
		body: searchParameters,
	});

	t.is(events.length, 0);
	t.is(capturedOptions.body, searchParameters);
	t.is(capturedOptions.duplex, undefined);
});

test('withUploadProgress - upload progress does not rewrite Uint8Array body', async t => {
	let capturedOptions;
	const [uint8] = encodeChunks('hello');
	const {events, fetchWithUploadProgress} = trackUploadProgress(async (url, options) => {
		capturedOptions = options;
		return bodyConsumingFetch(url, options);
	});

	await fetchWithUploadProgress('https://example.com/upload', {
		method: 'POST',
		body: uint8,
	});

	t.is(events.length, 0);
	t.is(capturedOptions.body, uint8);
	t.is(capturedOptions.duplex, undefined);
});

test('withUploadProgress - upload with no body fires no progress events', async t => {
	const {events, fetchWithUploadProgress} = trackUploadProgress();

	await fetchWithUploadProgress('https://example.com/test', {method: 'GET'});

	t.is(events.length, 0);
});

test('withUploadProgress - empty streamed uploads report completion', async t => {
	const {events, fetchWithUploadProgress} = trackUploadProgress();

	await fetchWithUploadProgress('https://example.com/upload', {
		method: 'POST',
		body: new ReadableStream({
			start(controller) {
				controller.close();
			},
		}),
		duplex: 'half',
	});

	t.deepEqual(events, [{
		percent: 1,
		transferredBytes: 0,
		totalBytes: 0,
	}]);
});

test('withUploadProgress - empty byte-stream uploads report completion', async t => {
	const {events, fetchWithUploadProgress} = trackUploadProgress();

	await fetchWithUploadProgress('https://example.com/upload', {
		method: 'POST',
		body: new ReadableStream({
			type: 'bytes',
			start(controller) {
				controller.close();
			},
		}),
	});

	await waitForEventCount(events, 1);

	t.deepEqual(events, [{
		percent: 1,
		transferredBytes: 0,
		totalBytes: 0,
	}]);
});

test('withUploadProgress - upload progress does not rewrite multi-byte string body', async t => {
	const {events, fetchWithUploadProgress} = trackUploadProgress();

	await fetchWithUploadProgress('https://example.com/upload', {
		method: 'POST',
		body: '你好世界',
	});

	t.is(events.length, 0);
});

test('withDownloadProgress and withUploadProgress - can be composed together', async t => {
	const uploadEvents = [];
	const downloadEvents = [];
	const [responseContent, requestContent] = encodeChunks('response data', 'request body');
	const requestBody = makeChunkedStream(requestContent);

	const mockFetch = async (urlOrRequest, options = {}) => {
		const body = options.body ?? (urlOrRequest instanceof Request ? urlOrRequest.body : undefined);

		if (body) {
			await new Response(body).arrayBuffer();
		}

		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(responseContent);
				controller.close();
			},
		});

		return new Response(stream, {
			status: 200,
			statusText: 'OK',
			headers: new Headers({'content-length': String(responseContent.byteLength)}),
		});
	};

	const fetchWithProgress = withDownloadProgress(withUploadProgress(mockFetch, {
		onProgress(progress) {
			uploadEvents.push(progress);
		},
	}), {
		onProgress(progress) {
			downloadEvents.push(progress);
		},
	});

	const response = await fetchWithProgress('https://example.com/upload', {
		method: 'POST',
		body: requestBody,
		duplex: 'half',
	});

	await response.text();

	t.true(uploadEvents.length > 0);
	t.is(uploadEvents.at(-1).percent, 1);
	t.true(downloadEvents.length > 0);
	t.is(downloadEvents.at(-1).percent, 1);
});

test('withUploadProgress - upload progress uses init.body when overriding a Request body', async t => {
	const overrideBody = 'override body';

	const mockFetch = async (urlOrRequest, options = {}) => {
		const body = options.body ?? (urlOrRequest instanceof Request ? urlOrRequest.body : undefined);

		if (body) {
			await new Response(body).text();
		}

		return new Response(null, {status: 200, statusText: 'OK'});
	};

	const {events, fetchWithUploadProgress} = trackUploadProgress(mockFetch);

	await fetchWithUploadProgress(createUploadRequest(), {
		body: makeChunkedStream(encoder.encode(overrideBody)),
		duplex: 'half',
	});

	t.true(events.length > 0);
	t.is(events.at(-1).percent, 1);
	t.is(events.at(-1).transferredBytes, new Blob([overrideBody]).size);
});

test('withUploadProgress - Request overrides with streamed bodies inject duplex automatically', async t => {
	let capturedOptions;
	let mergedRequest;
	const {fetchWithUploadProgress} = trackUploadProgress(async (urlOrRequest, options) => {
		capturedOptions = options;
		mergedRequest = new Request(urlOrRequest, options);
		return bodyConsumingFetch(urlOrRequest, options);
	});

	await fetchWithUploadProgress(createUploadRequest(), {
		body: createOverrideStream(),
	});

	t.is(capturedOptions.duplex, 'half');
	t.true(capturedOptions.body instanceof ReadableStream);
	t.is(mergedRequest.duplex, 'half');
});

test('withUploadProgress - Request overrides with streamed bodies preserve caller options', async t => {
	const dispatcher = Symbol('dispatcher');
	let capturedOptions;
	let mergedRequest;
	let mergedRequestClone;
	const {fetchWithUploadProgress} = trackUploadProgress(async (urlOrRequest, options) => {
		capturedOptions = options;
		mergedRequest = new Request(urlOrRequest, options);
		mergedRequestClone = mergedRequest.clone();
		await new Response(mergedRequest.body).text();
		return new Response(null, {status: 200, statusText: 'OK'});
	});

	await fetchWithUploadProgress(createUploadRequest(), {
		method: 'PATCH',
		headers: {'x-custom': 'value'},
		dispatcher,
		body: createOverrideStream(),
	});

	t.is(capturedOptions.method, 'PATCH');
	t.is(new Headers(capturedOptions.headers).get('x-custom'), 'value');
	t.is(capturedOptions.dispatcher, dispatcher);
	t.is(capturedOptions.duplex, 'half');
	t.is(mergedRequest.method, 'PATCH');
	t.is(mergedRequest.headers.get('x-custom'), 'value');
	t.is(await new Response(mergedRequestClone.body).text(), 'override body');
});

test('withUploadProgress - Request body overrides preserve existing Request body-specific headers except content-length', async t => {
	let mergedRequest;
	const {fetchWithUploadProgress} = trackUploadProgress(async (urlOrRequest, options) => {
		mergedRequest = new Request(urlOrRequest, options);
		await new Response(mergedRequest.body).text();
		return new Response(null, {status: 200, statusText: 'OK'});
	});

	await fetchWithUploadProgress(createUploadRequest({
		headers: {
			'content-type': 'text/plain;charset=UTF-8',
			'content-language': 'en',
			'content-location': '/old',
			'content-encoding': 'gzip',
			'content-length': '999',
			'x-request': 'value',
		},
	}), {
		body: createOverrideStream(),
	});

	t.is(mergedRequest.headers.get('content-type'), 'text/plain;charset=UTF-8');
	t.is(mergedRequest.headers.get('content-language'), 'en');
	t.is(mergedRequest.headers.get('content-location'), '/old');
	t.is(mergedRequest.headers.get('content-encoding'), 'gzip');
	t.is(mergedRequest.headers.get('content-length'), null);
	t.is(mergedRequest.headers.get('x-request'), 'value');
});

test('withUploadProgress - Request body overrides preserve existing FormData content-type headers', async t => {
	let mergedRequest;
	const {fetchWithUploadProgress} = trackUploadProgress(async (urlOrRequest, options) => {
		mergedRequest = new Request(urlOrRequest, options);
		await new Response(mergedRequest.body).text();
		return new Response(null, {status: 200, statusText: 'OK'});
	});
	const formData = new FormData();
	formData.set('foo', 'bar');

	await fetchWithUploadProgress(createUploadRequest({
		body: formData,
		headers: {'x-request': 'value'},
	}), {
		body: createOverrideStream(),
	});

	t.truthy(mergedRequest.headers.get('content-type'));
	t.is(mergedRequest.headers.get('x-request'), 'value');
});

test('withUploadProgress - Request body overrides preserve explicit replacement content headers across the full stripped set when init.headers is provided', async t => {
	let mergedRequest;
	const {fetchWithUploadProgress} = trackUploadProgress(async (urlOrRequest, options) => {
		mergedRequest = new Request(urlOrRequest, options);
		await new Response(mergedRequest.body).text();
		return new Response(null, {status: 200, statusText: 'OK'});
	});

	await fetchWithUploadProgress(createUploadRequest({
		headers: {
			'content-type': 'text/plain;charset=UTF-8',
			'content-language': 'en',
			'content-location': '/old',
			'content-encoding': 'gzip',
		},
	}), {
		headers: {
			'content-type': 'application/json',
			'content-language': 'fr',
			'content-location': '/new',
			'content-encoding': 'br',
		},
		body: createOverrideStream(),
	});

	t.is(mergedRequest.headers.get('content-type'), 'application/json');
	t.is(mergedRequest.headers.get('content-language'), 'fr');
	t.is(mergedRequest.headers.get('content-location'), '/new');
	t.is(mergedRequest.headers.get('content-encoding'), 'br');
});

test('withUploadProgress - Request body overrides preserve existing Request body headers while blocking withHeaders body defaults', async t => {
	let mergedRequest;
	const fetchWithUploadProgress = withUploadProgress(withHeaders(async (urlOrRequest, options) => {
		mergedRequest = new Request(urlOrRequest, options);
		await new Response(mergedRequest.body).text();
		return new Response(null, {status: 200, statusText: 'OK'});
	}, {
		'content-type': 'application/json',
		'content-language': 'fr',
		'content-location': '/default',
		'content-encoding': 'br',
		'content-length': '999',
		'x-default': 'value',
	}), {
		onProgress() {},
	});

	await fetchWithUploadProgress(createUploadRequest({
		headers: {'x-request': 'value'},
	}), {
		body: createOverrideStream(),
	});

	t.is(mergedRequest.headers.get('content-type'), 'text/plain;charset=UTF-8');
	t.is(mergedRequest.headers.get('content-language'), null);
	t.is(mergedRequest.headers.get('content-location'), null);
	t.is(mergedRequest.headers.get('content-encoding'), null);
	t.is(mergedRequest.headers.get('content-length'), null);
	t.is(mergedRequest.headers.get('x-default'), 'value');
	t.is(mergedRequest.headers.get('x-request'), 'value');
});

test('withUploadProgress - Request body overrides preserve blocked default header markers on rebuilt Request objects', async t => {
	let blockedDefaultHeaderNames;
	const fetchWithUploadProgress = withUploadProgress(async urlOrRequest => {
		blockedDefaultHeaderNames = urlOrRequest[blockedDefaultHeaderNamesSymbol];
		await new Response(urlOrRequest.body).text();
		return new Response(null, {status: 200, statusText: 'OK'});
	}, {
		onProgress() {},
	});
	const request = createUploadRequest({
		headers: {'x-request': 'value'},
	});
	request[blockedDefaultHeaderNamesSymbol] = ['authorization', 'cookie'];

	await fetchWithUploadProgress(request, {
		body: createOverrideStream(),
	});

	t.deepEqual(blockedDefaultHeaderNames, ['authorization', 'cookie']);
});

test('withUploadProgress - Request body overrides strip inherited body headers when wrapped by withHeaders', async t => {
	let mergedRequest;
	const fetchWithHeaders = withHeaders(withUploadProgress(async (urlOrRequest, options) => {
		mergedRequest = new Request(urlOrRequest, options);
		await new Response(mergedRequest.body).text();
		return new Response(null, {status: 200, statusText: 'OK'});
	}, {
		onProgress() {},
	}), {
		'x-default': 'value',
	});

	await fetchWithHeaders(createUploadRequest({
		headers: {
			'content-type': 'text/plain;charset=UTF-8',
			'content-length': '999',
			'x-request': 'value',
		},
	}), {
		body: createOverrideStream(),
	});

	t.is(mergedRequest.headers.get('content-type'), null);
	t.is(mergedRequest.headers.get('content-length'), null);
	t.is(mergedRequest.headers.get('x-default'), 'value');
	t.is(mergedRequest.headers.get('x-request'), 'value');
});

test('withUploadProgress - Request body overrides preserve explicit body headers when wrapped by withHeaders', async t => {
	let mergedRequest;
	const fetchWithHeaders = withHeaders(withUploadProgress(async (urlOrRequest, options) => {
		mergedRequest = new Request(urlOrRequest, options);
		await new Response(mergedRequest.body).text();
		return new Response(null, {status: 200, statusText: 'OK'});
	}, {
		onProgress() {},
	}), {
		'x-default': 'value',
	});

	await fetchWithHeaders(createUploadRequest({
		headers: {
			'content-type': 'application/json',
			'content-length': '13',
			'x-request': 'value',
		},
	}), {
		headers: {
			'content-type': 'application/json',
			'content-length': '13',
			'x-call': 'value',
		},
		body: createOverrideStream(),
	});

	t.is(mergedRequest.headers.get('content-type'), 'application/json');
	t.is(mergedRequest.headers.get('content-length'), '13');
	t.is(mergedRequest.headers.get('x-default'), 'value');
	t.is(mergedRequest.headers.get('x-call'), 'value');
	t.is(mergedRequest.headers.get('x-request'), 'value');
});

test('withUploadProgress - Request body overrides preserve explicit replacement content headers across the full stripped set when wrapped by withHeaders', async t => {
	let mergedRequest;
	const fetchWithHeaders = withHeaders(withUploadProgress(async (urlOrRequest, options) => {
		mergedRequest = new Request(urlOrRequest, options);
		await new Response(mergedRequest.body).text();
		return new Response(null, {status: 200, statusText: 'OK'});
	}, {
		onProgress() {},
	}), {
		'x-default': 'value',
	});

	await fetchWithHeaders(createUploadRequest({
		headers: {
			'content-type': 'application/json',
			'content-language': 'fr',
			'content-location': '/upload',
			'content-encoding': 'br',
			'content-length': '13',
			'x-request': 'value',
		},
	}), {
		headers: {
			'content-type': 'application/json',
			'content-language': 'fr',
			'content-location': '/upload',
			'content-encoding': 'br',
			'content-length': '13',
			'x-call': 'value',
		},
		body: createOverrideStream(),
	});

	t.is(mergedRequest.headers.get('content-type'), 'application/json');
	t.is(mergedRequest.headers.get('content-language'), 'fr');
	t.is(mergedRequest.headers.get('content-location'), '/upload');
	t.is(mergedRequest.headers.get('content-encoding'), 'br');
	t.is(mergedRequest.headers.get('content-length'), '13');
	t.is(mergedRequest.headers.get('x-default'), 'value');
	t.is(mergedRequest.headers.get('x-call'), 'value');
	t.is(mergedRequest.headers.get('x-request'), 'value');
});

test('withUploadProgress - Request body overrides preserve outer withHeaders body defaults when the original Request has no body headers', async t => {
	let mergedRequest;
	const fetchWithHeaders = withHeaders(withUploadProgress(async (urlOrRequest, options) => {
		mergedRequest = new Request(urlOrRequest, options);
		await new Response(mergedRequest.body).text();
		return new Response(null, {status: 200, statusText: 'OK'});
	}, {
		onProgress() {},
	}), {
		'content-type': 'application/json',
		'content-language': 'fr',
		'content-location': '/upload',
		'content-encoding': 'br',
		'content-length': '13',
		'x-default': 'value',
	});

	await fetchWithHeaders(new Request('https://example.com/upload', {
		method: 'POST',
		headers: {'x-request': 'value'},
	}), {
		body: createOverrideStream(),
	});

	t.is(mergedRequest.headers.get('content-type'), 'application/json');
	t.is(mergedRequest.headers.get('content-language'), 'fr');
	t.is(mergedRequest.headers.get('content-location'), '/upload');
	t.is(mergedRequest.headers.get('content-encoding'), 'br');
	t.is(mergedRequest.headers.get('content-length'), '13');
	t.is(mergedRequest.headers.get('x-default'), 'value');
	t.is(mergedRequest.headers.get('x-request'), 'value');
});

test('withUploadProgress - Request body overrides preserve explicit per-call body headers over blocked withHeaders defaults', async t => {
	let mergedRequest;
	const fetchWithUploadProgress = withUploadProgress(withHeaders(async (urlOrRequest, options) => {
		mergedRequest = new Request(urlOrRequest, options);
		await new Response(mergedRequest.body).text();
		return new Response(null, {status: 200, statusText: 'OK'});
	}, {
		'content-type': 'application/json',
		'content-language': 'fr',
		'content-location': '/default',
		'content-encoding': 'br',
		'x-default': 'value',
	}), {
		onProgress() {},
	});

	await fetchWithUploadProgress(createUploadRequest({
		headers: {'x-request': 'value'},
	}), {
		headers: {
			'content-type': 'text/plain',
			'content-language': 'en',
			'content-location': '/override',
			'content-encoding': 'gzip',
			'x-call': 'value',
		},
		body: createOverrideStream(),
	});

	t.is(mergedRequest.headers.get('content-type'), 'text/plain');
	t.is(mergedRequest.headers.get('content-language'), 'en');
	t.is(mergedRequest.headers.get('content-location'), '/override');
	t.is(mergedRequest.headers.get('content-encoding'), 'gzip');
	t.is(mergedRequest.headers.get('x-default'), 'value');
	t.is(mergedRequest.headers.get('x-call'), 'value');
	t.is(mergedRequest.headers.get('x-request'), 'value');
});

test('withUploadProgress - Request body overrides preserve explicit per-call content-length over blocked withHeaders defaults', async t => {
	let mergedRequest;
	const fetchWithUploadProgress = withUploadProgress(withHeaders(async (urlOrRequest, options) => {
		mergedRequest = new Request(urlOrRequest, options);
		await new Response(mergedRequest.body).text();
		return new Response(null, {status: 200, statusText: 'OK'});
	}, {
		'content-type': 'application/json',
		'content-length': '999',
		'x-default': 'value',
	}), {
		onProgress() {},
	});

	await fetchWithUploadProgress(createUploadRequest({
		headers: {'x-request': 'value'},
	}), {
		headers: {
			'content-type': 'text/plain',
			'content-length': '13',
			'x-call': 'value',
		},
		body: createOverrideStream(),
	});

	t.is(mergedRequest.headers.get('content-type'), 'text/plain');
	t.is(mergedRequest.headers.get('content-length'), '13');
	t.is(mergedRequest.headers.get('x-default'), 'value');
	t.is(mergedRequest.headers.get('x-call'), 'value');
	t.is(mergedRequest.headers.get('x-request'), 'value');
});

test('withUploadProgress - Request body overrides preserve explicit per-call body headers across nested withHeaders wrappers', async t => {
	let mergedRequest;
	const fetchWithUploadProgress = withUploadProgress(withHeaders(withHeaders(async (urlOrRequest, options) => {
		mergedRequest = new Request(urlOrRequest, options);
		await new Response(mergedRequest.body).text();
		return new Response(null, {status: 200, statusText: 'OK'});
	}, {
		'content-type': 'application/json',
		'content-language': 'fr',
		'x-inner': 'value',
	}), {
		'content-location': '/default',
		'content-encoding': 'br',
		'x-outer': 'value',
	}), {
		onProgress() {},
	});

	await fetchWithUploadProgress(createUploadRequest({
		headers: {'x-request': 'value'},
	}), {
		headers: {
			'content-type': 'text/plain',
			'content-language': 'en',
			'content-location': '/override',
			'content-encoding': 'gzip',
			'x-call': 'value',
		},
		body: createOverrideStream(),
	});

	t.is(mergedRequest.headers.get('content-type'), 'text/plain');
	t.is(mergedRequest.headers.get('content-language'), 'en');
	t.is(mergedRequest.headers.get('content-location'), '/override');
	t.is(mergedRequest.headers.get('content-encoding'), 'gzip');
	t.is(mergedRequest.headers.get('x-inner'), 'value');
	t.is(mergedRequest.headers.get('x-outer'), 'value');
	t.is(mergedRequest.headers.get('x-call'), 'value');
	t.is(mergedRequest.headers.get('x-request'), 'value');
});

test('withUploadProgress - Request body overrides preserve explicit per-call content-length across case-insensitive nested withHeaders wrappers', async t => {
	let mergedRequest;
	const fetchWithUploadProgress = withUploadProgress(withHeaders(withHeaders(async (urlOrRequest, options) => {
		mergedRequest = new Request(urlOrRequest, options);
		await new Response(mergedRequest.body).text();
		return new Response(null, {status: 200, statusText: 'OK'});
	}, {
		'Content-Type': 'application/json',
		'x-inner': 'value',
	}), {
		'Content-Length': '999',
		'x-outer': 'value',
	}), {
		onProgress() {},
	});

	await fetchWithUploadProgress(createUploadRequest({
		headers: {'x-request': 'value'},
	}), {
		headers: {
			'content-type': 'text/plain',
			'content-length': '13',
			'x-call': 'value',
		},
		body: createOverrideStream(),
	});

	t.is(mergedRequest.headers.get('content-type'), 'text/plain');
	t.is(mergedRequest.headers.get('content-length'), '13');
	t.is(mergedRequest.headers.get('x-inner'), 'value');
	t.is(mergedRequest.headers.get('x-outer'), 'value');
	t.is(mergedRequest.headers.get('x-call'), 'value');
	t.is(mergedRequest.headers.get('x-request'), 'value');
});

test('withUploadProgress - Request body overrides preserve existing Request body headers while blocking case-insensitive nested withHeaders body defaults', async t => {
	let mergedRequest;
	const fetchWithUploadProgress = withUploadProgress(withHeaders(withHeaders(async (urlOrRequest, options) => {
		mergedRequest = new Request(urlOrRequest, options);
		await new Response(mergedRequest.body).text();
		return new Response(null, {status: 200, statusText: 'OK'});
	}, {
		'Content-Type': 'application/json',
		'Content-Language': 'fr',
		'x-inner': 'value',
	}), {
		'Content-Length': '999',
		'Content-Encoding': 'br',
		'x-outer': 'value',
	}), {
		onProgress() {},
	});

	await fetchWithUploadProgress(createUploadRequest({
		headers: {'x-request': 'value'},
	}), {
		body: createOverrideStream(),
	});

	t.is(mergedRequest.headers.get('content-type'), 'text/plain;charset=UTF-8');
	t.is(mergedRequest.headers.get('content-language'), null);
	t.is(mergedRequest.headers.get('content-encoding'), null);
	t.is(mergedRequest.headers.get('content-length'), null);
	t.is(mergedRequest.headers.get('x-inner'), 'value');
	t.is(mergedRequest.headers.get('x-outer'), 'value');
	t.is(mergedRequest.headers.get('x-request'), 'value');
});

test('withUploadProgress - Request body overrides do not mutate the original Request', async t => {
	const originalRequest = createUploadRequest({
		body: new Blob(['request body'], {type: 'text/plain'}),
		headers: {'x-request': 'value'},
	});
	const {fetchWithUploadProgress} = trackUploadProgress();

	await fetchWithUploadProgress(originalRequest, {
		body: createOverrideStream(),
	});

	t.is(originalRequest.headers.get('content-type'), 'text/plain');
	t.is(originalRequest.headers.get('x-request'), 'value');
	t.is(await originalRequest.clone().text(), 'request body');
});

test('withUploadProgress - Request body overrides preserve compatible original Request metadata and drop incompatible keepalive', async t => {
	let capturedRequest;
	let mergedRequest;
	const originalRequest = createUploadRequest({
		method: 'PATCH',
		body: 'request body',
		mode: 'same-origin',
		credentials: 'omit',
		cache: 'no-store',
		redirect: 'manual',
		integrity: 'sha256-test',
		keepalive: true,
		referrerPolicy: 'origin',
		headers: {'x-request': 'value'},
	});
	const {fetchWithUploadProgress} = trackUploadProgress(async (urlOrRequest, options) => {
		capturedRequest = urlOrRequest;
		mergedRequest = new Request(urlOrRequest, options);
		await new Response(mergedRequest.body).text();
		return new Response(null, {status: 200, statusText: 'OK'});
	});

	await fetchWithUploadProgress(originalRequest, {
		body: createOverrideStream(),
	});

	t.is(mergedRequest.method, originalRequest.method);
	t.is(mergedRequest.redirect, originalRequest.redirect);
	t.is(mergedRequest.integrity, originalRequest.integrity);
	t.false(mergedRequest.keepalive);
	t.is(mergedRequest.headers.get('x-request'), 'value');
	t.is(capturedRequest.mode, originalRequest.mode);
	t.is(capturedRequest.credentials, originalRequest.credentials);
	t.is(capturedRequest.cache, originalRequest.cache);
	t.is(capturedRequest.referrerPolicy, originalRequest.referrerPolicy);
});

test('withUploadProgress - Request body overrides preserve Request priority when supported', async t => {
	if (!('priority' in Request.prototype)) {
		t.pass();
		return;
	}

	let capturedRequest;
	const originalRequest = createUploadRequest({
		priority: 'high',
	});
	const {fetchWithUploadProgress} = trackUploadProgress(async urlOrRequest => {
		capturedRequest = urlOrRequest;
		return new Response(null, {status: 200, statusText: 'OK'});
	});

	await fetchWithUploadProgress(originalRequest, {
		body: createOverrideStream(),
	});

	t.is(capturedRequest.priority, originalRequest.priority);
});

test('withUploadProgress - Request body overrides preserve existing Request body headers while blocking nested withHeaders body defaults', async t => {
	let mergedRequest;
	const fetchWithUploadProgress = withUploadProgress(withHeaders(withHeaders(async (urlOrRequest, options) => {
		mergedRequest = new Request(urlOrRequest, options);
		await new Response(mergedRequest.body).text();
		return new Response(null, {status: 200, statusText: 'OK'});
	}, {
		'content-type': 'application/json',
		'content-language': 'fr',
		'x-inner': 'value',
	}), {
		'content-length': '999',
		'content-encoding': 'br',
		'x-outer': 'value',
	}), {
		onProgress() {},
	});

	await fetchWithUploadProgress(createUploadRequest({
		headers: {'x-request': 'value'},
	}), {
		body: createOverrideStream(),
	});

	t.is(mergedRequest.headers.get('content-type'), 'text/plain;charset=UTF-8');
	t.is(mergedRequest.headers.get('content-language'), null);
	t.is(mergedRequest.headers.get('content-encoding'), null);
	t.is(mergedRequest.headers.get('content-length'), null);
	t.is(mergedRequest.headers.get('x-inner'), 'value');
	t.is(mergedRequest.headers.get('x-outer'), 'value');
	t.is(mergedRequest.headers.get('x-request'), 'value');
});

test('withUploadProgress - Request body overrides preserve abort behavior from the original Request signal when not overridden', async t => {
	const abortController = new AbortController();
	let mergedRequest;
	const {fetchWithUploadProgress} = trackUploadProgress(async (urlOrRequest, options) => {
		mergedRequest = new Request(urlOrRequest, options);
		await new Response(mergedRequest.body).text();
		return new Response(null, {status: 200, statusText: 'OK'});
	});

	await fetchWithUploadProgress(createUploadRequest({
		signal: abortController.signal,
	}), {
		body: createOverrideStream(),
	});

	abortController.abort('stop');

	t.true(mergedRequest.signal.aborted);
	t.is(mergedRequest.signal.reason, 'stop');
});

test('withUploadProgress - Request body overrides preserve abort behavior from an explicit signal override', async t => {
	const originalAbortController = new AbortController();
	const overrideAbortController = new AbortController();
	let mergedRequest;
	const {fetchWithUploadProgress} = trackUploadProgress(async (urlOrRequest, options) => {
		mergedRequest = new Request(urlOrRequest, options);
		await new Response(mergedRequest.body).text();
		return new Response(null, {status: 200, statusText: 'OK'});
	});

	await fetchWithUploadProgress(createUploadRequest({
		signal: originalAbortController.signal,
	}), {
		signal: overrideAbortController.signal,
		body: createOverrideStream(),
	});

	overrideAbortController.abort('stop');

	t.true(mergedRequest.signal.aborted);
	t.is(mergedRequest.signal.reason, 'stop');
	t.false(originalAbortController.signal.aborted);
});

test('withUploadProgress - passes through unchanged when no callback provided', async t => {
	let capturedOptions;
	const mockFetch = async (url, options) => {
		capturedOptions = options;
		return new Response(null, {status: 200, statusText: 'OK'});
	};

	const fetchWithUploadProgress = withUploadProgress(mockFetch);

	await fetchWithUploadProgress('https://example.com/upload', {
		method: 'POST',
		body: new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode('hello'));
				controller.close();
			},
		}),
		duplex: 'half',
	});

	t.true(capturedOptions.body instanceof ReadableStream);
	t.is(capturedOptions.duplex, 'half');
});

test('withUploadProgress - propagates fetch errors without firing progress events', async t => {
	const events = [];
	const fetchWithUploadProgress = withUploadProgress(async () => {
		throw new Error('network failure');
	}, {
		onProgress(progress) {
			events.push(progress);
		},
	});

	await t.throwsAsync(
		fetchWithUploadProgress('https://example.com/upload', {
			method: 'POST',
			body: new ReadableStream({
				start(controller) {
					controller.enqueue(encoder.encode('hello'));
					controller.close();
				},
			}),
		}),
		{message: 'network failure'},
	);

	t.is(events.length, 0);
});
