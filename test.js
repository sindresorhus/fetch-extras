import test from 'ava';
import {
	HttpError,
	throwIfHttpError,
	withHttpError,
	withTimeout,
} from './index.js';

const createBasicMockFetch = () => async url => {
	if (url === '/ok') {
		return {
			ok: true,
			status: 200,
			statusText: 'OK',
			url,
		};
	}

	return {
		ok: false,
		status: 404,
		statusText: 'Not Found',
		url,
	};
};

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

test('throwIfHttpError - should not throw for ok responses', async t => {
	const mockFetch = createBasicMockFetch();
	const response = await mockFetch('/ok');
	await t.notThrowsAsync(throwIfHttpError(response));
});

test('throwIfHttpError - should throw HttpError for non-ok responses', async t => {
	const mockFetch = createBasicMockFetch();
	const response = await mockFetch('/not-found');
	await t.throwsAsync(throwIfHttpError(response), {instanceOf: HttpError});
});

test('throwIfHttpError - should work with promise responses', async t => {
	const mockFetch = createBasicMockFetch();
	await t.throwsAsync(throwIfHttpError(mockFetch('/not-found')), {instanceOf: HttpError});
});

test('withHttpError - should pass through successful responses', async t => {
	const mockFetch = createBasicMockFetch();
	const fetchWithError = withHttpError(mockFetch);

	const response = await fetchWithError('/ok');
	t.deepEqual(response, {
		ok: true,
		status: 200,
		statusText: 'OK',
		url: '/ok',
	});
});

test('withHttpError - should throw HttpError for error responses', async t => {
	const mockFetch = createBasicMockFetch();
	const fetchWithError = withHttpError(mockFetch);

	const error = await t.throwsAsync(fetchWithError('/not-found'), {instanceOf: HttpError});
	t.is(error.response.status, 404);
});

test('withHttpError - can be combined with withTimeout', async t => {
	const mockFetch = createTimedMockFetch(50);
	const fetchWithTimeoutAndError = withHttpError(withTimeout(mockFetch, 1000));

	const response = await fetchWithTimeoutAndError('/test');
	t.deepEqual(response, {
		ok: true,
		status: 200,
		statusText: 'OK',
		url: '/test',
	});
});

test('withHttpError - throws HttpError even with timeout', async t => {
	const mockFetch = async url => ({
		ok: false,
		status: 500,
		statusText: 'Internal Server Error',
		url,
	});

	const fetchWithTimeoutAndError = withHttpError(withTimeout(mockFetch, 1000));

	const error = await t.throwsAsync(fetchWithTimeoutAndError('/test'), {instanceOf: HttpError});
	t.is(error.response.status, 500);
});

test('withTimeout - should abort request after timeout', async t => {
	const slowFetch = createTimedMockFetch(200);
	const fetchWithTimeout = withTimeout(slowFetch, 100);

	await t.throwsAsync(fetchWithTimeout('/test'), {name: 'AbortError'});
});

test('withTimeout - should respect existing abort signal', async t => {
	const mockFetch = createTimedMockFetch(100);
	const fetchWithTimeout = withTimeout(mockFetch, 1000);
	const controller = new AbortController();

	controller.abort();

	await t.throwsAsync(fetchWithTimeout('/test', {signal: controller.signal}), {name: 'AbortError'});
});

test('withTimeout - should complete before timeout', async t => {
	const quickFetch = createTimedMockFetch(50);
	const fetchWithTimeout = withTimeout(quickFetch, 1000);

	const response = await fetchWithTimeout('/test');
	t.deepEqual(response, {
		ok: true,
		status: 200,
		statusText: 'OK',
		url: '/test',
	});
});
