import test from 'ava';
import {withTimeout} from '../source/index.js';

const createTimedMockFetch = delay => async (url, options = {}) => {
	if (options.signal?.aborted) {
		const error = new Error('The operation was aborted');
		error.name = 'AbortError';
		throw error;
	}

	return new Promise((resolve, reject) => {
		const timer = setTimeout(() => {
			resolve({
				ok: true,
				status: 200,
				statusText: 'OK',
				url,
			});
		}, delay);

		options.signal?.addEventListener('abort', () => {
			clearTimeout(timer);
			const error = new Error('The operation was aborted');
			error.name = 'AbortError';
			reject(error);
		});
	});
};

test('withTimeout - should abort request after timeout', async t => {
	const slowFetch = createTimedMockFetch(200);
	const fetchWithTimeout = withTimeout(100)(slowFetch);

	await t.throwsAsync(fetchWithTimeout('/test'), {name: 'AbortError'});
});

test('withTimeout - should respect existing abort signal via options', async t => {
	const mockFetch = createTimedMockFetch(100);
	const fetchWithTimeout = withTimeout(1000)(mockFetch);
	const controller = new AbortController();

	controller.abort();

	await t.throwsAsync(fetchWithTimeout('/test', {signal: controller.signal}), {name: 'AbortError'});
});

test('withTimeout - should respect abort signal from a Request object', async t => {
	const mockFetch = createTimedMockFetch(100);
	const fetchWithTimeout = withTimeout(1000)(mockFetch);
	const controller = new AbortController();

	controller.abort();

	const request = new Request('https://example.com/test', {signal: controller.signal});
	await t.throwsAsync(fetchWithTimeout(request), {name: 'AbortError'});
});

test('withTimeout - should complete before timeout', async t => {
	const quickFetch = createTimedMockFetch(50);
	const fetchWithTimeout = withTimeout(1000)(quickFetch);

	const response = await fetchWithTimeout('/test');
	t.deepEqual(response, {
		ok: true,
		status: 200,
		statusText: 'OK',
		url: '/test',
	});
});
