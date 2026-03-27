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
