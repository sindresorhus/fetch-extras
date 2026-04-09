import test from 'ava';
import {HttpError, throwIfHttpError} from '../source/index.js';

test('throwIfHttpError - should work with promise responses', async t => {
	const responsePromise = Promise.resolve(new Response('', {
		status: 404,
		statusText: 'Not Found',
	}));

	await t.throwsAsync(throwIfHttpError(responsePromise), {instanceOf: HttpError});
});

test('throwIfHttpError - should return Response instances synchronously when ok', t => {
	const response = new Response('', {
		status: 200,
		statusText: 'OK',
	});

	t.is(throwIfHttpError(response), response);
});

test('throwIfHttpError - should throw synchronously for non-ok Response instances', t => {
	const response = new Response('', {
		status: 404,
		statusText: 'Not Found',
	});

	const error = t.throws(() => throwIfHttpError(response), {instanceOf: HttpError});
	t.is(error.response, response);
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
