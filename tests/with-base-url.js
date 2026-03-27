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

test('withBaseUrl - resolves protocol-relative URLs against the base URL scheme', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl('//other.example.com/endpoint');

	t.is(response.url, 'https://other.example.com/endpoint');
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

test('withBaseUrl - preserves query parameters', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl('/users?page=1&limit=10');

	t.is(response.url, 'https://api.example.com/users?page=1&limit=10');
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

test('withBaseUrl - can be combined with both withHttpError and withTimeout', async t => {
	const timedFetch = createTimedMockFetch(50);
	const fetchWithAll = withHttpError(withBaseUrl(withTimeout(timedFetch, 1000), 'https://api.example.com'));
	const response = await fetchWithAll('/users');

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

test('withBaseUrl - preserves fragments', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl('/users#section');

	t.is(response.url, 'https://api.example.com/users#section');
});

test('withBaseUrl - preserves special characters and encoding', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl('/users/john%20doe?email=test%40example.com');

	t.is(response.url, 'https://api.example.com/users/john%20doe?email=test%40example.com');
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

test('withBaseUrl - base URL with query parameters', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com?key=value');
	const response = await fetchWithBaseUrl('/users');

	t.is(response.url, 'https://api.example.com/users');
});

test('withBaseUrl - input URL with multiple path segments', async t => {
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

test('withBaseUrl - base URL is just domain', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl('users');

	t.is(response.url, 'https://api.example.com/users');
});

test('withBaseUrl - base URL with username in auth', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://user@api.example.com');
	const response = await fetchWithBaseUrl('users');

	t.is(response.url, 'https://user@api.example.com/users');
});

test('withBaseUrl - base URL with username and password in auth', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://user:pass@api.example.com');
	const response = await fetchWithBaseUrl('users');

	t.is(response.url, 'https://user:pass@api.example.com/users');
});

test('withBaseUrl - unicode characters in base URL path', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/v1/café');
	const response = await fetchWithBaseUrl('menu');

	t.is(response.url, 'https://api.example.com/v1/caf%C3%A9/menu');
});

test('withBaseUrl - unicode characters in input URL', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl('/café/menu');

	t.is(response.url, 'https://api.example.com/caf%C3%A9/menu');
});

test('withBaseUrl - input with complex query string', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/v1');
	const response = await fetchWithBaseUrl('search?q=hello&page=1&sort=asc');

	t.is(response.url, 'https://api.example.com/v1/search?q=hello&page=1&sort=asc');
});

test('withBaseUrl - input with fragment and query', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl('/docs?section=api#endpoint');

	t.is(response.url, 'https://api.example.com/docs?section=api#endpoint');
});

test('withBaseUrl - base URL with fragment (unusual but valid)', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/v1#old');
	const response = await fetchWithBaseUrl('users');

	t.is(response.url, 'https://api.example.com/v1/users');
});

test('withBaseUrl - very long path', async t => {
	const longPath = 'a'.repeat(1000);
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl(`/${longPath}`);

	t.is(response.url, `https://api.example.com/${longPath}`);
});

test('withBaseUrl - base URL as URL object with path', async t => {
	const baseUrl = new URL('https://api.example.com/v1');
	const fetchWithBaseUrl = withBaseUrl(mockFetch, baseUrl);
	const response = await fetchWithBaseUrl('users');

	t.is(response.url, 'https://api.example.com/v1/users');
});

test('withBaseUrl - file protocol URL as absolute URL', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl('file:///path/to/file');

	t.is(response.url, 'file:///path/to/file');
});

test('withBaseUrl - data URL as absolute URL', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const dataUrl = 'data:text/plain;base64,SGVsbG8gV29ybGQ=';
	const response = await fetchWithBaseUrl(dataUrl);

	t.is(response.url, dataUrl);
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

test('withBaseUrl - base URL ending with just slash', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/');
	const response = await fetchWithBaseUrl('users');

	t.is(response.url, 'https://api.example.com/users');
});

test('withBaseUrl - input starting with many slashes', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/v1');
	const response = await fetchWithBaseUrl('///users');

	t.is(response.url, 'https://api.example.com/v1/users');
});

test('withBaseUrl - base URL is localhost', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'http://localhost:3000');
	const response = await fetchWithBaseUrl('api/users');

	t.is(response.url, 'http://localhost:3000/api/users');
});

test('withBaseUrl - base URL is 127.0.0.1', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'http://127.0.0.1:8080/v1');
	const response = await fetchWithBaseUrl('users');

	t.is(response.url, 'http://127.0.0.1:8080/v1/users');
});

test('withBaseUrl - base URL with IPv6 address', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'http://[::1]:3000/api');
	const response = await fetchWithBaseUrl('users');

	t.is(response.url, 'http://[::1]:3000/api/users');
});

test('withBaseUrl - colon in path (not port)', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/v1:beta');
	const response = await fetchWithBaseUrl('users');

	t.is(response.url, 'https://api.example.com/v1:beta/users');
});

test('withBaseUrl - semicolon in path', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/v1;session=abc');
	const response = await fetchWithBaseUrl('users');

	t.is(response.url, 'https://api.example.com/v1;session=abc/users');
});

test('withBaseUrl - numeric path segments', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/123/456');
	const response = await fetchWithBaseUrl('789');

	t.is(response.url, 'https://api.example.com/123/456/789');
});

test('withBaseUrl - tilde in path', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/~user');
	const response = await fetchWithBaseUrl('files');

	t.is(response.url, 'https://api.example.com/~user/files');
});

test('withBaseUrl - plus sign in path (URL encoding)', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/search+results');
	const response = await fetchWithBaseUrl('details');

	t.is(response.url, 'https://api.example.com/search+results/details');
});

test('withBaseUrl - hyphen in path', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/v1-beta');
	const response = await fetchWithBaseUrl('users');

	t.is(response.url, 'https://api.example.com/v1-beta/users');
});

test('withBaseUrl - underscore in path', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/api_v1');
	const response = await fetchWithBaseUrl('users');

	t.is(response.url, 'https://api.example.com/api_v1/users');
});

test('withBaseUrl - dot in path segment', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/v1.0.0');
	const response = await fetchWithBaseUrl('users');

	t.is(response.url, 'https://api.example.com/v1.0.0/users');
});

test('withBaseUrl - percent-encoded slashes in input', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl('/path%2Fwith%2Fencoded%2Fslashes');

	t.is(response.url, 'https://api.example.com/path%2Fwith%2Fencoded%2Fslashes');
});

test('withBaseUrl - input with multiple query parameters same name', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl('/search?tag=a&tag=b&tag=c');

	t.is(response.url, 'https://api.example.com/search?tag=a&tag=b&tag=c');
});

test('withBaseUrl - base URL with trailing path and no slash', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/path');
	const response = await fetchWithBaseUrl('subpath');

	t.is(response.url, 'https://api.example.com/path/subpath');
});

test('withBaseUrl - base URL with trailing path and slash', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/path/');
	const response = await fetchWithBaseUrl('subpath');

	t.is(response.url, 'https://api.example.com/path/subpath');
});

test('withBaseUrl - base URL with query and input with path', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/endpoint?key=value');
	const response = await fetchWithBaseUrl('/data');

	t.is(response.url, 'https://api.example.com/endpoint/data');
});

test('withBaseUrl - base URL with multiple hyphens', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://my-api-service-v1.example.com');
	const response = await fetchWithBaseUrl('users');

	t.is(response.url, 'https://my-api-service-v1.example.com/users');
});

test('withBaseUrl - subdomain with multiple levels', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.v1.staging.example.com');
	const response = await fetchWithBaseUrl('users');

	t.is(response.url, 'https://api.v1.staging.example.com/users');
});

test('withBaseUrl - base URL with fragment and input', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com#section');
	const response = await fetchWithBaseUrl('users');

	t.is(response.url, 'https://api.example.com/users');
});

test('withBaseUrl - does not modify absolute URLs with uppercase schemes', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl('HTTPS://other.example.com/endpoint');

	t.is(response.url, 'HTTPS://other.example.com/endpoint');
});

test('withBaseUrl - input with encoded space', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl('/users/john%20doe');

	t.is(response.url, 'https://api.example.com/users/john%20doe');
});

test('withBaseUrl - input with encoded equals', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl('/search?query=hello%3dworld');

	t.is(response.url, 'https://api.example.com/search?query=hello%3dworld');
});

test('withBaseUrl - very deeply nested paths', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/a/b/c/d/e/f/g');
	const response = await fetchWithBaseUrl('h/i/j/k');

	t.is(response.url, 'https://api.example.com/a/b/c/d/e/f/g/h/i/j/k');
});

test('withBaseUrl - base URL with single path component', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/v1');
	const response = await fetchWithBaseUrl('users');

	t.is(response.url, 'https://api.example.com/v1/users');
});

test('withBaseUrl - input that looks like domain but is path', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl('example.com/path');

	t.is(response.url, 'https://api.example.com/example.com/path');
});

test('withBaseUrl - numeric base URL path', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com/2024');
	const response = await fetchWithBaseUrl('january');

	t.is(response.url, 'https://api.example.com/2024/january');
});

test('withBaseUrl - request object is passed through as-is', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const request = new Request('https://other.example.com/endpoint', {method: 'POST'});
	const response = await fetchWithBaseUrl(request);

	t.is(response.url, 'https://other.example.com/endpoint');
});

test('withBaseUrl - URL object with query string', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const url = new URL('https://other.example.com/endpoint?page=1');
	const response = await fetchWithBaseUrl(url);

	t.is(response.url, 'https://other.example.com/endpoint?page=1');
});

test('withBaseUrl - input with encoded ampersand', async t => {
	const fetchWithBaseUrl = withBaseUrl(mockFetch, 'https://api.example.com');
	const response = await fetchWithBaseUrl('/search?q=hello%26world');

	t.is(response.url, 'https://api.example.com/search?q=hello%26world');
});
