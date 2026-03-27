import test from 'ava';
import {HttpError, throwIfHttpError} from '../source/index.js';

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

test('HttpError - message includes status code and URL', t => {
	const response = {
		ok: false,
		status: 404,
		statusText: 'Not Found',
		url: 'https://example.com/api',
	};
	const error = new HttpError(response);

	t.is(error.message, 'Request failed with status code 404 Not Found: https://example.com/api');
});

test('HttpError - empty statusText produces clean message without trailing space', t => {
	const response = {
		ok: false,
		status: 404,
		statusText: '',
		url: 'https://example.com/api',
	};
	const error = new HttpError(response);

	t.is(error.message, 'Request failed with status code 404: https://example.com/api');
});

test('HttpError - has ERR_HTTP_RESPONSE_NOT_OK code', t => {
	const response = {
		ok: false,
		status: 500,
		statusText: 'Internal Server Error',
		url: 'https://example.com',
	};
	const error = new HttpError(response);

	t.is(error.code, 'ERR_HTTP_RESPONSE_NOT_OK');
});

test('HttpError - attaches the response object', t => {
	const response = {
		ok: false,
		status: 403,
		statusText: 'Forbidden',
		url: 'https://example.com',
	};
	const error = new HttpError(response);

	t.is(error.response, response);
});
