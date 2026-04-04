import test from 'ava';
import {withBaseUrl, withHttpError, withTimeout} from '../source/index.js';

function resolveUrl(url) {
	if (url instanceof Request) {
		return url.url;
	}

	if (url instanceof URL) {
		return url.href;
	}

	return url;
}

const mockFetch = async url => ({
	ok: true,
	status: 200,
	statusText: 'OK',
	url: resolveUrl(url),
});

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

test('withBaseUrl - resolves relative URL', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl('/users');

	t.is(response.url, 'https://api.example.com/users');
});

test('withBaseUrl - accepts URL object as baseUrl', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, new URL('https://api.example.com'));
	const response = await fetchWithBaseUrl('/users');

	t.is(response.url, 'https://api.example.com/users');
});

test('withBaseUrl - does not modify absolute URLs', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl('https://other.example.com/endpoint');

	t.is(response.url, 'https://other.example.com/endpoint');
});

test('withBaseUrl - does not modify absolute URLs with uppercase schemes', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl('HTTPS://other.example.com/endpoint');

	t.is(response.url, 'HTTPS://other.example.com/endpoint');
});

test('withBaseUrl - file protocol URL is treated as absolute', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl('file:///path/to/file');

	t.is(response.url, 'file:///path/to/file');
});

test('withBaseUrl - data URL is treated as absolute', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const dataUrl = 'data:text/plain;base64,SGVsbG8gV29ybGQ=';
	const response = await fetchWithBaseUrl(dataUrl);

	t.is(response.url, dataUrl);
});

test('withBaseUrl - passes through URL objects unchanged', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl(new URL('https://other.example.com/endpoint'));

	t.is(response.url, 'https://other.example.com/endpoint');
});

test('withBaseUrl - passes through Request objects unchanged', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const request = new Request('https://other.example.com/endpoint');
	const response = await fetchWithBaseUrl(request);

	t.is(response.url, 'https://other.example.com/endpoint');
});

test('withBaseUrl - preserves Request method and headers', async t => {
	let receivedMethod;
	let receivedHeaders;
	const mockFetch_ = async request => {
		receivedMethod = request.method;
		receivedHeaders = request.headers;
		return new Response('ok');
	};

	const fetchWithBaseUrl = withBaseUrl(mockFetch_, 'https://api.example.com');
	const request = new Request('https://other.example.com/endpoint', {
		method: 'POST',
		headers: {Authorization: 'Bearer token'},
		body: 'body',
	});

	await fetchWithBaseUrl(request);

	t.is(receivedMethod, 'POST');
	t.is(receivedHeaders.get('authorization'), 'Bearer token');
});

test('withBaseUrl - does not validate base URL when input is not a string', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'not a valid url');
	const url = new URL('https://example.com/users');
	const response = await fetchWithBaseUrl(url);

	t.is(response.url, 'https://example.com/users');
});

test('withBaseUrl - preserves query parameters', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl('/users?page=1&limit=10');

	t.is(response.url, 'https://api.example.com/users?page=1&limit=10');
});

test('withBaseUrl - preserves fragments', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl('/users#section');

	t.is(response.url, 'https://api.example.com/users#section');
});

test('withBaseUrl - input with fragment and query', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl('/docs?section=api#endpoint');

	t.is(response.url, 'https://api.example.com/docs?section=api#endpoint');
});

test('withBaseUrl - can be combined with withHttpError', async t => {
	const fetchWithBoth = withHttpError(withBaseUrl(mockFetch, 'https://api.example.com'));
	const response = await fetchWithBoth('/users');

	t.is(response.url, 'https://api.example.com/users');
	t.is(response.status, 200);
});

test('withBaseUrl - can be combined with withTimeout', async t => {
	const timedFetch = createTimedMockFetch(50);
	const fetchWithBoth = withBaseUrl(withTimeout(timedFetch, 1000), 'https://api.example.com');
	const response = await fetchWithBoth('/users');

	t.is(response.url, 'https://api.example.com/users');
});

test('withBaseUrl - base URL with path and trailing slash', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/v1/');
	const response = await fetchWithBaseUrl('users');

	t.is(response.url, 'https://api.example.com/v1/users');
});

test('withBaseUrl - base URL with path without trailing slash', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/v1');
	const response = await fetchWithBaseUrl('users');

	t.is(response.url, 'https://api.example.com/v1/users');
});

test('withBaseUrl - relative URL without leading slash', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl('users');

	t.is(response.url, 'https://api.example.com/users');
});

test('withBaseUrl - input with multiple path segments', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/v1');
	const response = await fetchWithBaseUrl('users/123/profile');

	t.is(response.url, 'https://api.example.com/v1/users/123/profile');
});

test('withBaseUrl - relative path with dot-slash', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/v1');
	const response = await fetchWithBaseUrl('./users');

	t.is(response.url, 'https://api.example.com/v1/users');
});

test('withBaseUrl - relative path with parent directory', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/v1/admin');
	const response = await fetchWithBaseUrl('../users');

	t.is(response.url, 'https://api.example.com/v1/users');
});

test('withBaseUrl - input URL is just a slash', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/v1');
	const response = await fetchWithBaseUrl('/');

	t.is(response.url, 'https://api.example.com/v1/');
});

test('withBaseUrl - input starting with many slashes', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/v1');
	const response = await fetchWithBaseUrl('///users');

	t.is(response.url, 'https://api.example.com/v1/users');
});

test('withBaseUrl - handles empty string URL', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/v1/');
	const response = await fetchWithBaseUrl('');

	t.is(response.url, 'https://api.example.com/v1/');
});

test('withBaseUrl - throws on invalid base URL', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'not a valid url');

	const error = await t.throwsAsync(
		() => fetchWithBaseUrl('/users'),
		{instanceOf: TypeError},
	);

	t.true(error.message.includes('Invalid URL'));
});

test('withBaseUrl - passes fetch options through unchanged', async t => {
	const receivedOptions = {};

	const mockFetchWithOptions = async (url, options = {}) => {
		Object.assign(receivedOptions, options);
		return {
			ok: true,
			status: 200,
			statusText: 'OK',
			url: resolveUrl(url),
		};
	};

	const fetchWithBaseUrl = withBaseUrl(mockFetchWithOptions, 'https://api.example.com');
	const options = {method: 'POST', headers: {'Content-Type': 'application/json'}};
	await fetchWithBaseUrl('/users', options);

	t.is(receivedOptions.method, 'POST');
	t.is(receivedOptions.headers['Content-Type'], 'application/json');
});

test('withBaseUrl - multiple trailing slashes in base URL', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/v1//');
	const response = await fetchWithBaseUrl('users');

	t.is(response.url, 'https://api.example.com/v1//users');
});

test('withBaseUrl - double-slash at start resolves against the base URL scheme', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl('//other.example.com/users');

	t.is(response.url, 'https://other.example.com/users');
});

test('withBaseUrl - base URL with port number', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com:8080/v1');
	const response = await fetchWithBaseUrl('users');

	t.is(response.url, 'https://api.example.com:8080/v1/users');
});

test('withBaseUrl - base URL with IPv6 address', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'http://[::1]:3000/api');
	const response = await fetchWithBaseUrl('users');

	t.is(response.url, 'http://[::1]:3000/api/users');
});

test('withBaseUrl - base URL query parameters are stripped', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com?key=value');
	const response = await fetchWithBaseUrl('/users');

	t.is(response.url, 'https://api.example.com/users');
});

test('withBaseUrl - base URL with query and relative input path', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/endpoint?key=value');
	const response = await fetchWithBaseUrl('/data');

	t.is(response.url, 'https://api.example.com/endpoint/data');
});

test('withBaseUrl - base URL fragment is stripped', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/v1#old');
	const response = await fetchWithBaseUrl('users');

	t.is(response.url, 'https://api.example.com/v1/users');
});

test('withBaseUrl - input with only query parameters', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/search');
	const response = await fetchWithBaseUrl('?q=test');

	t.is(response.url, 'https://api.example.com/search?q=test');
});

test('withBaseUrl - input with only fragment', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/docs');
	const response = await fetchWithBaseUrl('#section');

	t.is(response.url, 'https://api.example.com/docs#section');
});

test('withBaseUrl - query-only input replaces base URL query params', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/search?page=1');
	const response = await fetchWithBaseUrl('?q=test');

	t.is(response.url, 'https://api.example.com/search?q=test');
});

test('withBaseUrl - fragment-only input preserves base URL query params', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/docs?key=value');
	const response = await fetchWithBaseUrl('#section');

	t.is(response.url, 'https://api.example.com/docs?key=value#section');
});

test('withBaseUrl - input that looks like domain but is treated as path', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl('example.com/path');

	t.is(response.url, 'https://api.example.com/example.com/path');
});
