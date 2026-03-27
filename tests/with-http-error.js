import test from 'ava';
import {HttpError, withHttpError, withTimeout} from '../source/index.js';

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
