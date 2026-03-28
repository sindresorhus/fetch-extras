import {once} from 'node:events';
import http from 'node:http';
import {gzipSync} from 'node:zlib';
import test from 'ava';
import {withDownloadProgress, withHeaders} from '../source/index.js';

const encoder = new TextEncoder();

function encodeChunks(...chunks) {
	return chunks.map(chunk => encoder.encode(chunk));
}

function createStreamingFetch(chunks, contentLength) {
	return async () => {
		const stream = new ReadableStream({
			start(controller) {
				for (const chunk of chunks) {
					controller.enqueue(chunk instanceof Uint8Array ? chunk : encoder.encode(chunk));
				}

				controller.close();
			},
		});

		const headers = new Headers();

		if (contentLength !== undefined) {
			headers.set('content-length', String(contentLength));
		}

		return new Response(stream, {status: 200, statusText: 'OK', headers});
	};
}

async function withServer(listener, action) {
	const server = http.createServer(listener);
	server.listen(0, '127.0.0.1');
	await once(server, 'listening');

	try {
		const {port} = server.address();
		return await action(`http://127.0.0.1:${port}`);
	} finally {
		server.close();
		await once(server, 'close');
	}
}

function trackDownloadProgress(chunks, contentLength) {
	const events = [];

	return {
		events,
		fetchWithDownloadProgress: withDownloadProgress(createStreamingFetch(chunks, contentLength), {
			onProgress(progress) {
				events.push(progress);
			},
		}),
	};
}

async function readByteStream(response) {
	const reader = response.body.getReader({mode: 'byob'});
	const buffer = new Uint8Array(8);
	const {done, value} = await reader.read(buffer);

	return {done, value, reader};
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

async function readAll(reader, chunks = []) {
	const {done, value} = await reader.read();

	if (done) {
		return chunks;
	}

	chunks.push(value);
	return readAll(reader, chunks);
}

test('withDownloadProgress - download progress reports correct byte counts at each step', async t => {
	const [first, second] = encodeChunks('hello ', 'world');
	const total = first.byteLength + second.byteLength;
	const {events, fetchWithDownloadProgress} = trackDownloadProgress([first, second], total);

	const response = await fetchWithDownloadProgress('https://example.com/test');
	await response.text();

	t.is(events.length, 3);
	t.is(events[0].transferredBytes, 6);
	t.is(events[0].totalBytes, 11);
	t.true(events[0].percent > 0 && events[0].percent < 1);
	t.is(events[1].transferredBytes, 11);
	t.is(events[1].totalBytes, 11);
	t.true(events[1].percent > 0 && events[1].percent < 1);
	t.is(events[2].transferredBytes, 11);
	t.is(events[2].totalBytes, 11);
	t.is(events[2].percent, 1);
});

test('withDownloadProgress - reports the current chunk as soon as it is read', async t => {
	const [first, second] = encodeChunks('hello ', 'world');
	const firstLength = first.byteLength;
	const totalLength = first.byteLength + second.byteLength;
	const {events, fetchWithDownloadProgress} = trackDownloadProgress([first, second], totalLength);

	const response = await fetchWithDownloadProgress('https://example.com/test');
	const reader = response.body.getReader();

	await reader.read();

	t.deepEqual(events, [{
		percent: firstLength / (totalLength + 1),
		transferredBytes: firstLength,
		totalBytes: totalLength,
	}]);

	await reader.read();
	await reader.read();
});

test('withDownloadProgress - preserves byte-stream readers', async t => {
	const response = await withDownloadProgress(fetch, {
		onProgress() {},
	})('data:application/octet-stream;base64,AAEC');
	const {done, value} = await readByteStream(response);

	t.false(done);
	t.deepEqual([...value], [0, 1, 2]);
});

test('withDownloadProgress - BYOB readers receive completion without an extra read', async t => {
	const events = [];
	const response = await withDownloadProgress(fetch, {
		onProgress(progress) {
			events.push(progress);
		},
	})('data:application/octet-stream;base64,AAEC');
	const {done, value} = await readByteStream(response);

	t.false(done);
	t.deepEqual([...value], [0, 1, 2]);

	await waitForEventCount(events, 2);

	t.deepEqual(events, [
		{percent: 0, transferredBytes: 3, totalBytes: 3},
		{percent: 1, transferredBytes: 3, totalBytes: 3},
	]);
});

test('withDownloadProgress - BYOB readers preserve declared totals until completion', async t => {
	const events = [];
	const fetchWithDownloadProgress = withDownloadProgress(async () => new Response(new ReadableStream({
		type: 'bytes',
		start(controller) {
			controller.enqueue(new Uint8Array([0, 1, 2]));
			controller.close();
		},
	}), {
		headers: {'content-length': '10'},
	}), {
		onProgress(progress) {
			events.push(progress);
		},
	});
	const response = await fetchWithDownloadProgress('https://example.com/test');
	const {done, value} = await readByteStream(response);

	t.false(done);
	t.deepEqual([...value], [0, 1, 2]);

	await waitForEventCount(events, 2);

	t.true(events[0].percent > 0 && events[0].percent < 1);
	t.is(events[0].transferredBytes, 3);
	t.is(events[0].totalBytes, 10);
	t.is(events[1].percent, 1);
	t.is(events[1].transferredBytes, 3);
	t.is(events[1].totalBytes, 10);
});

test('withDownloadProgress - native encoded responses treat totals as unknown', async t => {
	const text = 'hello world '.repeat(100);
	const compressedBody = gzipSync(text);
	const events = [];
	const fetchWithDownloadProgress = withDownloadProgress(fetch, {
		onProgress(progress) {
			events.push(progress);
		},
	});

	await withServer((request, response) => {
		response.writeHead(200, {
			'content-encoding': 'gzip',
			'content-length': String(compressedBody.byteLength),
		});
		response.end(compressedBody);
	}, async url => {
		const response = await fetchWithDownloadProgress(url);
		const reader = response.body.getReader();
		const {done, value} = await reader.read();

		t.false(done);
		t.is(events[0].percent, 0);
		t.is(events[0].transferredBytes, value.byteLength);
		t.is(events[0].totalBytes, value.byteLength);

		const chunks = await readAll(reader, [value]);

		t.is(new TextDecoder().decode(Buffer.concat(chunks)), text);
	});

	t.is(events.at(-1).percent, 1);
	t.is(events.at(-1).transferredBytes, text.length);
	t.is(events.at(-1).totalBytes, text.length);
});

test('withDownloadProgress - wrapped native encoded responses treat totals as unknown', async t => {
	const text = 'hello world '.repeat(100);
	const compressedBody = gzipSync(text);
	const events = [];
	const fetchWithDownloadProgress = withDownloadProgress(withHeaders(fetch, {
		'x-test': '1',
	}), {
		onProgress(progress) {
			events.push(progress);
		},
	});

	await withServer((request, response) => {
		t.is(request.headers['x-test'], '1');
		response.writeHead(200, {
			'content-encoding': 'gzip',
			'content-length': String(compressedBody.byteLength),
		});
		response.end(compressedBody);
	}, async url => {
		const response = await fetchWithDownloadProgress(url);
		const reader = response.body.getReader();
		const {done, value} = await reader.read();

		t.false(done);
		t.is(events[0].percent, 0);
		t.is(events[0].transferredBytes, value.byteLength);
		t.is(events[0].totalBytes, value.byteLength);

		const chunks = await readAll(reader, [value]);

		t.is(new TextDecoder().decode(Buffer.concat(chunks)), text);
	});

	t.is(events.at(-1).percent, 1);
	t.is(events.at(-1).transferredBytes, text.length);
	t.is(events.at(-1).totalBytes, text.length);
});

test('withDownloadProgress - mutable encoded responses preserve declared totals', async t => {
	const events = [];
	const fetchWithDownloadProgress = withDownloadProgress(async () => new Response(new ReadableStream({
		type: 'bytes',
		start(controller) {
			controller.enqueue(new Uint8Array([0, 1, 2]));
			controller.close();
		},
	}), {
		headers: {
			'content-length': '10',
			'content-encoding': 'gzip',
		},
	}), {
		onProgress(progress) {
			events.push(progress);
		},
	});
	const response = await fetchWithDownloadProgress('https://example.com/test');
	const {done, value} = await readByteStream(response);

	t.false(done);
	t.deepEqual([...value], [0, 1, 2]);

	await waitForEventCount(events, 2);

	t.true(events[0].percent > 0 && events[0].percent < 1);
	t.is(events[0].transferredBytes, 3);
	t.is(events[0].totalBytes, 10);
	t.is(events[1].percent, 1);
	t.is(events[1].transferredBytes, 3);
	t.is(events[1].totalBytes, 10);
});

test('withDownloadProgress - multi-chunk BYOB readers complete only after the final chunk', async t => {
	const events = [];
	const fetchWithDownloadProgress = withDownloadProgress(async () => new Response(new ReadableStream({
		type: 'bytes',
		start(controller) {
			controller.enqueue(new Uint8Array([0, 1]));
			controller.enqueue(new Uint8Array([2, 3]));
			controller.close();
		},
	})), {
		onProgress(progress) {
			events.push(progress);
		},
	});
	const response = await fetchWithDownloadProgress('https://example.com/test');
	const reader = response.body.getReader({mode: 'byob'});

	t.deepEqual([...await read(reader, 8)], [0, 1]);
	t.deepEqual(events, [
		{percent: 0, transferredBytes: 2, totalBytes: 2},
	]);

	t.deepEqual([...await read(reader, 8)], [2, 3]);
	await waitForEventCount(events, 3);
	t.deepEqual(events, [
		{percent: 0, transferredBytes: 2, totalBytes: 2},
		{percent: 0, transferredBytes: 4, totalBytes: 4},
		{percent: 1, transferredBytes: 4, totalBytes: 4},
	]);

	reader.releaseLock();
	const endOfFileReader = response.body.getReader();
	t.deepEqual(await endOfFileReader.read(), {done: true, value: undefined});
	await waitForMicrotask();
	t.is(events.length, 3);
});

test('withDownloadProgress - cloned responses preserve byte-stream readers', async t => {
	const response = await withDownloadProgress(fetch, {
		onProgress() {},
	})('data:application/octet-stream;base64,AAEC');
	const clonedResponse = response.clone();
	const {done, value} = await readByteStream(clonedResponse);

	t.false(done);
	t.deepEqual([...value], [0, 1, 2]);
	t.deepEqual([...new Uint8Array(await response.arrayBuffer())], [0, 1, 2]);
});

test('withDownloadProgress - consuming a clone first does not duplicate progress events', async t => {
	const events = [];
	const response = await withDownloadProgress(fetch, {
		onProgress(progress) {
			events.push(progress);
		},
	})('data:text/plain,hello');
	const clonedResponse = response.clone();

	t.is(await clonedResponse.text(), 'hello');
	const eventCountAfterClone = events.length;
	t.true(eventCountAfterClone >= 1);
	t.is(events.at(-1).percent, 1);
	t.is(await response.text(), 'hello');
	t.is(events.length, eventCountAfterClone);
	t.is(events.at(-1).transferredBytes, 5);
});

test('withDownloadProgress - wrapped native fetch responses keep immutable headers', async t => {
	const response = await withDownloadProgress(fetch, {
		onProgress() {},
	})('data:text/plain,hello');

	const error = await t.throwsAsync(async () => {
		response.headers.set('x-custom', 'value');
	}, {instanceOf: TypeError});

	t.truthy(error);
});

test('withDownloadProgress - wrapped native fetch responses keep Headers brand', async t => {
	const response = await withDownloadProgress(fetch, {
		onProgress() {},
	})('data:text/plain,hello');

	t.true(response.headers instanceof Headers);
});

test('withDownloadProgress - cloned wrapped native fetch responses keep immutable headers', async t => {
	const response = await withDownloadProgress(fetch, {
		onProgress() {},
	})('data:text/plain,hello');
	const clonedResponse = response.clone();

	const error = await t.throwsAsync(async () => {
		clonedResponse.headers.set('x-custom', 'value');
	}, {instanceOf: TypeError});

	t.truthy(error);
});

test('withDownloadProgress - cloned wrapped native fetch responses keep Headers brand', async t => {
	const response = await withDownloadProgress(fetch, {
		onProgress() {},
	})('data:text/plain,hello');
	const clonedResponse = response.clone();

	t.true(clonedResponse.headers instanceof Headers);
});

test('withDownloadProgress - wrapped clones keep mutable headers independent', async t => {
	const response = await withDownloadProgress(async () => new Response('hello', {
		headers: {'x-custom': 'value'},
	}), {
		onProgress() {},
	})('https://example.com/test');
	const clonedResponse = response.clone();

	response.headers.set('x-custom', 'changed');

	t.is(response.headers.get('x-custom'), 'changed');
	t.is(clonedResponse.headers.get('x-custom'), 'value');
});

test('withDownloadProgress - wrapped mutable headers stay connected to response metadata', async t => {
	const response = await withDownloadProgress(async () => new Response('hello', {
		headers: {'content-type': 'text/plain'},
	}), {
		onProgress() {},
	})('https://example.com/test');

	response.headers.set('content-type', 'application/json');
	const blob = await response.blob();

	t.is(blob.type, 'application/json');
});

test('withDownloadProgress - wrapped mutable clone headers stay connected to clone metadata', async t => {
	const response = await withDownloadProgress(async () => new Response('hello', {
		headers: {'content-type': 'text/plain'},
	}), {
		onProgress() {},
	})('https://example.com/test');
	const clonedResponse = response.clone();

	clonedResponse.headers.set('content-type', 'application/json');
	const cloneBlob = await clonedResponse.blob();

	t.is(cloneBlob.type, 'application/json');
});

test('withDownloadProgress - deleting wrapped mutable content-type clears blob metadata', async t => {
	const response = await withDownloadProgress(async () => new Response('hello', {
		headers: {'content-type': 'text/plain'},
	}), {
		onProgress() {},
	})('https://example.com/test');

	response.headers.delete('content-type');
	const blob = await response.blob();

	t.is(blob.type, '');
});

test('withDownloadProgress - deleting wrapped mutable clone content-type clears clone blob metadata', async t => {
	const response = await withDownloadProgress(async () => new Response('hello', {
		headers: {'content-type': 'text/plain'},
	}), {
		onProgress() {},
	})('https://example.com/test');
	const clonedResponse = response.clone();

	clonedResponse.headers.delete('content-type');
	const cloneBlob = await clonedResponse.blob();

	t.is(cloneBlob.type, '');
});

test('withDownloadProgress - wrapped native fetch responses preserve blob metadata type', async t => {
	const response = await withDownloadProgress(fetch, {
		onProgress() {},
	})('data:text/plain,hello');
	const blob = await response.blob();

	t.is(blob.type, 'text/plain');
});

test('withDownloadProgress - cloned wrapped native fetch responses preserve blob metadata type', async t => {
	const response = await withDownloadProgress(fetch, {
		onProgress() {},
	})('data:text/plain,hello');
	const clonedResponse = response.clone();
	const blob = await clonedResponse.blob();

	t.is(blob.type, 'text/plain');
});

test('withDownloadProgress - canceling a wrapped reader cancels the source stream', async t => {
	let cancellationReason;
	const fetchWithDownloadProgress = withDownloadProgress(async () => new Response(new ReadableStream({
		type: 'bytes',
		pull() {},
		cancel(reason) {
			cancellationReason = reason;
		},
	})), {
		onProgress() {},
	});

	const response = await fetchWithDownloadProgress('https://example.com/test');
	const reader = response.body.getReader({mode: 'byob'});

	await reader.cancel('stop');

	t.is(cancellationReason, 'stop');
});

test('withDownloadProgress - canceling a wrapped reader does not report completion', async t => {
	const events = [];
	const fetchWithDownloadProgress = withDownloadProgress(async () => new Response(new ReadableStream({
		type: 'bytes',
		start(controller) {
			controller.enqueue(new Uint8Array([0, 1, 2]));
		},
	})), {
		onProgress(progress) {
			events.push(progress);
		},
	});

	const response = await fetchWithDownloadProgress('https://example.com/test');
	const reader = response.body.getReader({mode: 'byob'});

	t.deepEqual([...await read(reader, 8)], [0, 1, 2]);
	await reader.cancel('stop');

	t.is(events.length, 1);
	t.true(events[0].percent < 1);
});

test('withDownloadProgress - canceling after the first BYOB read does not pull ahead', async t => {
	let pullCount = 0;
	const fetchWithDownloadProgress = withDownloadProgress(async () => new Response(new ReadableStream({
		type: 'bytes',
		pull(controller) {
			pullCount++;

			if (pullCount === 1) {
				controller.enqueue(new Uint8Array([0, 1, 2]));
			}
		},
	})), {
		onProgress() {},
	});

	const response = await fetchWithDownloadProgress('https://example.com/test');
	const reader = response.body.getReader({mode: 'byob'});

	t.deepEqual([...await read(reader, 8)], [0, 1, 2]);
	await reader.cancel('stop');

	t.is(pullCount, 1);
});

async function read(reader, size) {
	const {done, value} = await reader.read(new Uint8Array(size));

	return done ? new Uint8Array() : value;
}

test('withDownloadProgress - tracks downloads directly', async t => {
	const {events, fetchWithDownloadProgress} = trackDownloadProgress(['hello', ' world'], 11);

	const response = await fetchWithDownloadProgress('https://example.com/test');

	t.is(await response.text(), 'hello world');
	t.is(events.at(-1).percent, 1);
	t.is(events.at(-1).transferredBytes, 11);
});

test('withDownloadProgress - download response body data is intact after wrapping', async t => {
	const content = encoder.encode('hello world');
	const half = Math.trunc(content.byteLength / 2);
	const mockFetch = createStreamingFetch([content.slice(0, half), content.slice(half)], content.byteLength);

	const fetchWithDownloadProgress = withDownloadProgress(mockFetch, {
		onProgress() {},
	});

	const response = await fetchWithDownloadProgress('https://example.com/test');

	t.is(await response.text(), 'hello world');
});

test('withDownloadProgress - download progress totalBytes adapts to actual when content-length is absent', async t => {
	const [first, second] = encodeChunks('hello ', 'world');
	const {events, fetchWithDownloadProgress} = trackDownloadProgress([first, second], undefined);

	const response = await fetchWithDownloadProgress('https://example.com/test');
	await response.text();

	t.is(events.length, 3);
	t.is(events[0].percent, 0);
	t.is(events[0].transferredBytes, 6);
	t.is(events[0].totalBytes, 6);
	t.is(events[1].percent, 0);
	t.is(events[1].transferredBytes, 11);
	t.is(events[1].totalBytes, 11);
	t.is(events[2].percent, 1);
	t.is(events[2].transferredBytes, 11);
	t.is(events[2].totalBytes, 11);
});

test('withDownloadProgress - unknown-size downloads report current bytes before completion', async t => {
	const [first, second] = encodeChunks('hello ', 'world');
	const firstLength = first.byteLength;
	const totalLength = first.byteLength + second.byteLength;
	const {events, fetchWithDownloadProgress} = trackDownloadProgress([first, second]);

	const response = await fetchWithDownloadProgress('https://example.com/test');
	const reader = response.body.getReader();

	await reader.read();

	t.deepEqual(events, [{
		percent: 0,
		transferredBytes: firstLength,
		totalBytes: firstLength,
	}]);

	await reader.read();
	await reader.read();

	t.is(events.at(-1).percent, 1);
	t.is(events.at(-1).transferredBytes, totalLength);
	t.is(events.at(-1).totalBytes, totalLength);
});

test('withDownloadProgress - download progress percent stays below 1 before the final chunk', async t => {
	const [content] = encodeChunks('hi');
	const half = Math.trunc(content.byteLength / 2);
	const {events, fetchWithDownloadProgress} = trackDownloadProgress([content.slice(0, half), content.slice(half)], content.byteLength);

	const response = await fetchWithDownloadProgress('https://example.com/test');
	await response.text();

	for (const event of events.slice(0, 1)) {
		t.true(event.percent < 1);
	}

	t.is(events.at(-1).percent, 1);
});

test('withDownloadProgress - short content-length does not report completion before EOF', async t => {
	const [content] = encodeChunks('hi');
	const half = Math.trunc(content.byteLength / 2);
	const {events, fetchWithDownloadProgress} = trackDownloadProgress([content.slice(0, half), content.slice(half)], 1);

	const response = await fetchWithDownloadProgress('https://example.com/test');
	await response.text();

	for (const event of events.slice(0, -1)) {
		t.true(event.percent < 1);
	}

	t.is(events.at(-1).percent, 1);
	t.is(events.at(-1).transferredBytes, content.byteLength);
	t.is(events.at(-1).totalBytes, content.byteLength);
});

test('withDownloadProgress - short content-length keeps overflowed progress moving until completion', async t => {
	const chunks = encodeChunks('a', 'b', 'c');
	const {events, fetchWithDownloadProgress} = trackDownloadProgress(chunks, 1);

	const response = await fetchWithDownloadProgress('https://example.com/test');
	await response.text();

	t.is(events.length, 4);
	t.true(events[0].percent > 0 && events[0].percent < 1);
	t.true(events[1].percent > events[0].percent);
	t.true(events[1].percent < 1);
	t.true(events[2].percent > events[1].percent);
	t.true(events[2].percent < 1);
	t.is(events[3].percent, 1);
	t.is(events[3].transferredBytes, 3);
	t.is(events[3].totalBytes, 3);
});

test('withDownloadProgress - long content-length preserves the declared total until completion', async t => {
	const [content] = encodeChunks('hello world');
	const contentLength = content.byteLength;
	const {events, fetchWithDownloadProgress} = trackDownloadProgress([content], contentLength + 5);

	const response = await fetchWithDownloadProgress('https://example.com/test');
	await response.text();

	t.is(events.length, 2);
	t.true(events[0].percent > 0 && events[0].percent < 1);
	t.is(events[0].transferredBytes, contentLength);
	t.is(events[0].totalBytes, contentLength + 5);
	t.is(events[1].percent, 1);
	t.is(events[1].transferredBytes, contentLength);
	t.is(events[1].totalBytes, contentLength + 5);
});

test('withDownloadProgress - empty streamed responses report completion', async t => {
	const {events, fetchWithDownloadProgress} = trackDownloadProgress([], 0);

	const response = await fetchWithDownloadProgress('https://example.com/test');

	t.is(await response.text(), '');
	t.deepEqual(events, [{
		percent: 1,
		transferredBytes: 0,
		totalBytes: 0,
	}]);
});

test('withDownloadProgress - empty byte-stream responses report completion', async t => {
	const events = [];
	const fetchWithDownloadProgress = withDownloadProgress(async () => new Response(new ReadableStream({
		type: 'bytes',
		start(controller) {
			controller.close();
		},
	})), {
		onProgress(progress) {
			events.push(progress);
		},
	});

	const response = await fetchWithDownloadProgress('https://example.com/test');

	t.is(await response.text(), '');
	await waitForEventCount(events, 1);
	t.deepEqual(events, [{
		percent: 1,
		transferredBytes: 0,
		totalBytes: 0,
	}]);
});

test('withDownloadProgress - passes through unchanged when no callback provided', async t => {
	let callCount = 0;
	const simpleFetch = async () => {
		callCount++;
		return new Response('ok', {status: 200});
	};

	const fetchWithDownloadProgress = withDownloadProgress(simpleFetch);
	const response = await fetchWithDownloadProgress('https://example.com/test');

	t.is(callCount, 1);
	t.is(response.status, 200);
	t.is(await response.text(), 'ok');
});

test('withDownloadProgress - returns original response when response has no body', async t => {
	const noBodyFetch = async () => new Response(null, {status: 204, statusText: 'No Content'});
	const events = [];

	const fetchWithDownloadProgress = withDownloadProgress(noBodyFetch, {
		onProgress(progress) {
			events.push(progress);
		},
	});

	const response = await fetchWithDownloadProgress('https://example.com/test');

	t.is(response.status, 204);
	t.is(events.length, 0);
});

test('withDownloadProgress - single-chunk download fires one event with percent 1', async t => {
	const [content] = encodeChunks('hello world');
	const contentLength = content.byteLength;
	const {events, fetchWithDownloadProgress} = trackDownloadProgress([content], contentLength);

	const response = await fetchWithDownloadProgress('https://example.com/test');
	await response.text();

	t.is(events.length, 2);
	t.true(events[0].percent > 0 && events[0].percent < 1);
	t.true(events[0].percent > 0.9);
	t.is(events[0].transferredBytes, contentLength);
	t.is(events[0].totalBytes, contentLength);
	t.is(events[1].percent, 1);
	t.is(events[1].transferredBytes, contentLength);
	t.is(events[1].totalBytes, contentLength);
});

test('withDownloadProgress - many-chunk download has monotonically increasing progress', async t => {
	const chunks = Array.from({length: 10}, (_, index) => encoder.encode(`chunk${index}`));
	const totalBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const {events, fetchWithDownloadProgress} = trackDownloadProgress(chunks, totalBytes);

	const response = await fetchWithDownloadProgress('https://example.com/test');
	await response.text();

	t.is(events.length, 11);
	t.is(events.at(-1).percent, 1);
	t.is(events.at(-1).transferredBytes, totalBytes);

	for (let index = 1; index < events.length; index++) {
		t.true(events[index].percent >= events[index - 1].percent);
		t.true(events[index].transferredBytes >= events[index - 1].transferredBytes);
	}
});

test('withDownloadProgress - download preserves response status, statusText, and headers', async t => {
	const mockFetch = async () => {
		const stream = new ReadableStream({
			start(controller) {
				controller.enqueue(encoder.encode('data'));
				controller.close();
			},
		});

		return new Response(stream, {
			status: 201,
			statusText: 'Created',
			headers: new Headers({'x-custom': 'value', 'content-length': '4'}),
		});
	};

	const fetchWithDownloadProgress = withDownloadProgress(mockFetch, {
		onProgress() {},
	});

	const response = await fetchWithDownloadProgress('https://example.com/test');

	t.is(response.status, 201);
	t.is(response.statusText, 'Created');
	t.is(response.headers.get('x-custom'), 'value');
});

test('withDownloadProgress - download preserves response metadata from fetch', async t => {
	const events = [];
	const response = await withDownloadProgress(fetch, {
		onProgress(progress) {
			events.push(progress);
		},
	})('data:text/plain,hi');
	const clonedResponse = response.clone();

	t.is(response.url, 'data:text/plain,hi');
	t.is(response.type, 'basic');
	t.false(response.redirected);
	t.is(clonedResponse.url, 'data:text/plain,hi');
	t.is(clonedResponse.type, 'basic');
	t.false(clonedResponse.redirected);
	t.is(await clonedResponse.text(), 'hi');
	t.is(events.at(-1).percent, 1);
	t.is(events.at(-1).transferredBytes, 2);
	t.is(await response.text(), 'hi');
});

test('withDownloadProgress - cloned wrapped custom responses preserve status, statusText, and headers', async t => {
	const response = await withDownloadProgress(async () => new Response('hello', {
		status: 201,
		statusText: 'Created',
		headers: {'x-custom': 'value'},
	}), {
		onProgress() {},
	})('https://example.com/test');
	const clonedResponse = response.clone();

	t.is(clonedResponse.status, 201);
	t.is(clonedResponse.statusText, 'Created');
	t.is(clonedResponse.headers.get('x-custom'), 'value');
	t.is(await clonedResponse.text(), 'hello');
});

test('withDownloadProgress - forwards URL and options to underlying fetch', async t => {
	let capturedUrl;
	let capturedOptions;

	const mockFetch = async (url, options) => {
		capturedUrl = url;
		capturedOptions = options;
		return new Response('ok', {status: 200});
	};

	const fetchWithDownloadProgress = withDownloadProgress(mockFetch);

	await fetchWithDownloadProgress('https://example.com/test', {
		method: 'POST',
		headers: {'x-custom': 'value'},
	});

	t.is(capturedUrl, 'https://example.com/test');
	t.is(capturedOptions.method, 'POST');
	t.deepEqual(capturedOptions.headers, {'x-custom': 'value'});
});

test('withDownloadProgress - propagates fetch errors without firing progress events', async t => {
	const events = [];
	const fetchWithDownloadProgress = withDownloadProgress(async () => {
		throw new Error('network failure');
	}, {
		onProgress(progress) {
			events.push(progress);
		},
	});

	await t.throwsAsync(
		fetchWithDownloadProgress('https://example.com/test'),
		{message: 'network failure'},
	);

	t.is(events.length, 0);
});

test('withDownloadProgress - tracks string chunks with correct byte lengths', async t => {
	const events = [];
	const fetchWithDownloadProgress = withDownloadProgress(async () => new Response(new ReadableStream({
		start(controller) {
			controller.enqueue('hello ');
			controller.enqueue('世界');
			controller.close();
		},
	})), {
		onProgress(progress) {
			events.push(progress);
		},
	});

	const response = await fetchWithDownloadProgress('https://example.com/test');
	const reader = response.body.getReader();
	await readAll(reader);

	t.is(events.length, 3);
	t.is(events[0].transferredBytes, 6);
	t.is(events[1].transferredBytes, 12);
	t.is(events[2].percent, 1);
	t.is(events[2].transferredBytes, 12);
});
