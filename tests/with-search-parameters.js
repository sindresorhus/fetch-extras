import test from 'ava';
import {
	withSearchParameters,
	withBaseUrl,
	withHeaders,
	withHttpError,
	withTimeout,
	withDeduplication,
	pipeline,
} from '../source/index.js';

const mockFetch = async url => ({
	ok: true,
	status: 200,
	statusText: 'OK',
	url,
});

test('appends default parameters to URL without existing parameters', async t => {
	const fetchWithParameters = withSearchParameters({apiKey: 'abc', format: 'json'})(mockFetch);
	const response = await fetchWithParameters('/users');

	t.is(response.url, '/users?apiKey=abc&format=json');
});

test('merges with existing URL parameters', async t => {
	const fetchWithParameters = withSearchParameters({apiKey: 'abc'})(mockFetch);
	const response = await fetchWithParameters('/users?page=2');

	t.is(response.url, '/users?apiKey=abc&page=2');
});

test('per-call URL parameters override defaults', async t => {
	const fetchWithParameters = withSearchParameters({page: '1', apiKey: 'abc'})(mockFetch);
	const response = await fetchWithParameters('/users?page=5');

	t.is(response.url, '/users?apiKey=abc&page=5');
});

test('preserves multi-value URL parameters', async t => {
	const fetchWithParameters = withSearchParameters({apiKey: 'abc'})(mockFetch);
	const response = await fetchWithParameters('/users?tags=a&tags=b');

	t.is(response.url, '/users?apiKey=abc&tags=a&tags=b');
});

test('multi-value URL parameters fully override default for that key', async t => {
	const fetchWithParameters = withSearchParameters({tags: 'default'})(mockFetch);
	const response = await fetchWithParameters('/users?tags=a&tags=b');

	t.is(response.url, '/users?tags=a&tags=b');
});

test('preserves fragment', async t => {
	const fetchWithParameters = withSearchParameters({apiKey: 'abc'})(mockFetch);
	const response = await fetchWithParameters('/docs#section');

	t.is(response.url, '/docs?apiKey=abc#section');
});

test('preserves fragment with existing parameters', async t => {
	const fetchWithParameters = withSearchParameters({apiKey: 'abc'})(mockFetch);
	const response = await fetchWithParameters('/docs?page=1#section');

	t.is(response.url, '/docs?apiKey=abc&page=1#section');
});

test('appends default parameters to URL objects', async t => {
	const fetchWithParameters = withSearchParameters({apiKey: 'abc'})(mockFetch);
	const url = new URL('https://example.com/users');
	const response = await fetchWithParameters(url);

	t.true(response.url instanceof URL);
	t.is(response.url.href, 'https://example.com/users?apiKey=abc');
});

test('snapshots default search parameters when creating the wrapper factory', async t => {
	const defaultSearchParameters = new URLSearchParams({apiKey: 'abc'});
	const addSearchParameters = withSearchParameters(defaultSearchParameters);
	defaultSearchParameters.set('apiKey', 'mutated');
	const fetchWithParameters = addSearchParameters(mockFetch);
	const response = await fetchWithParameters('/users');

	t.is(response.url, '/users?apiKey=abc');
});

test('does not mutate the original URL object', async t => {
	const fetchWithParameters = withSearchParameters({apiKey: 'abc'})(mockFetch);
	const url = new URL('https://example.com/users');
	await fetchWithParameters(url);

	t.is(url.href, 'https://example.com/users');
});

test('per-call URL object parameters override defaults', async t => {
	const fetchWithParameters = withSearchParameters({apiKey: 'abc', format: 'json'})(mockFetch);
	const url = new URL('https://example.com/users?format=xml');
	const response = await fetchWithParameters(url);

	t.is(response.url.href, 'https://example.com/users?apiKey=abc&format=xml');
});

test('passes through Request objects unchanged', async t => {
	const fetchWithParameters = withSearchParameters({apiKey: 'abc'})(mockFetch);
	const request = new Request('https://example.com/users');
	const response = await fetchWithParameters(request);

	t.is(response.url, request);
});

test('passes options through for URL objects', async t => {
	let receivedOptions;
	const capturingFetch = async (url, options = {}) => {
		receivedOptions = options;
		return {
			ok: true,
			status: 200,
			statusText: 'OK',
			url,
		};
	};

	const fetchWithParameters = withSearchParameters({apiKey: 'abc'})(capturingFetch);
	await fetchWithParameters(new URL('https://example.com/users'), {method: 'POST'});

	t.is(receivedOptions.method, 'POST');
});

test('accepts URLSearchParams as defaults', async t => {
	const fetchWithParameters = withSearchParameters(new URLSearchParams({apiKey: 'abc'}))(mockFetch);
	const response = await fetchWithParameters('/users');

	t.is(response.url, '/users?apiKey=abc');
});

test('accepts array of tuples as defaults', async t => {
	const fetchWithParameters = withSearchParameters([['apiKey', 'abc'], ['format', 'json']])(mockFetch);
	const response = await fetchWithParameters('/users');

	t.is(response.url, '/users?apiKey=abc&format=json');
});

test('handles empty default parameters', async t => {
	const fetchWithParameters = withSearchParameters({})(mockFetch);
	const response = await fetchWithParameters('/users?page=1');

	t.is(response.url, '/users?page=1');
});

test('handles URL with only query string', async t => {
	const fetchWithParameters = withSearchParameters({apiKey: 'abc'})(mockFetch);
	const response = await fetchWithParameters('?page=1');

	t.is(response.url, '?apiKey=abc&page=1');
});

test('handles empty string URL', async t => {
	const fetchWithParameters = withSearchParameters({apiKey: 'abc'})(mockFetch);
	const response = await fetchWithParameters('');

	t.is(response.url, '?apiKey=abc');
});

test('URL-encodes parameter values', async t => {
	const fetchWithParameters = withSearchParameters({query: 'hello world'})(mockFetch);
	const response = await fetchWithParameters('/search');

	t.is(response.url, '/search?query=hello+world');
});

test('passes options through unchanged', async t => {
	let receivedOptions;
	const capturingFetch = async (url, options = {}) => {
		receivedOptions = options;
		return {
			ok: true,
			status: 200,
			statusText: 'OK',
			url,
		};
	};

	const fetchWithParameters = withSearchParameters({apiKey: 'abc'})(capturingFetch);
	await fetchWithParameters('/users', {method: 'POST', headers: {'Content-Type': 'application/json'}});

	t.is(receivedOptions.method, 'POST');
	t.is(receivedOptions.headers['Content-Type'], 'application/json');
});

test('composes with withBaseUrl in pipeline', async t => {
	let receivedUrl;
	const capturingFetch = async url => {
		receivedUrl = url;
		return {
			ok: true,
			status: 200,
			statusText: 'OK',
			url,
		};
	};

	const apiFetch = pipeline(
		capturingFetch,
		withBaseUrl('https://api.example.com'),
		withSearchParameters({apiKey: 'abc'}),
	);

	await apiFetch('/users');

	t.is(receivedUrl, 'https://api.example.com/users?apiKey=abc');
});

test('composes with withBaseUrl and withHttpError in pipeline', async t => {
	let receivedUrl;
	const capturingFetch = async url => {
		receivedUrl = url;
		return new Response('ok', {status: 200});
	};

	const apiFetch = pipeline(
		capturingFetch,
		withBaseUrl('https://api.example.com'),
		withSearchParameters({apiKey: 'abc'}),
		withHttpError(),
	);

	await apiFetch('/users?page=2');

	t.is(receivedUrl, 'https://api.example.com/users?apiKey=abc&page=2');
});

test('preserves resolved absolute URL metadata for outer wrappers in pipeline', async t => {
	let callCount = 0;
	const mockFetch = async url => {
		callCount++;
		await Promise.resolve();
		return new Response(url);
	};

	const apiFetch = pipeline(
		mockFetch,
		withBaseUrl('https://api.example.com'),
		withSearchParameters({apiKey: 'abc'}),
		withDeduplication(),
	);

	const [firstResponse, secondResponse] = await Promise.all([
		apiFetch('/users'),
		apiFetch('https://api.example.com/users?apiKey=abc'),
	]);

	t.is(callCount, 1);
	t.is(await firstResponse.text(), 'https://api.example.com/users?apiKey=abc');
	t.is(await secondResponse.text(), 'https://api.example.com/users?apiKey=abc');
});

test('absolute URL with existing parameters', async t => {
	const fetchWithParameters = withSearchParameters({apiKey: 'abc'})(mockFetch);
	const response = await fetchWithParameters('https://example.com/users?page=1');

	t.is(response.url, 'https://example.com/users?apiKey=abc&page=1');
});

test('empty defaults and no URL parameters leaves URL unchanged', async t => {
	const fetchWithParameters = withSearchParameters({})(mockFetch);
	const response = await fetchWithParameters('/users');

	t.is(response.url, '/users');
});

test('multi-value defaults via tuples', async t => {
	const fetchWithParameters = withSearchParameters([['tags', 'a'], ['tags', 'b']])(mockFetch);
	const response = await fetchWithParameters('/users');

	t.is(response.url, '/users?tags=a&tags=b');
});

test('per-call parameters override multi-value defaults', async t => {
	const fetchWithParameters = withSearchParameters([['tags', 'a'], ['tags', 'b']])(mockFetch);
	const response = await fetchWithParameters('/users?tags=x');

	t.is(response.url, '/users?tags=x');
});

test('preserves fragment containing a question mark', async t => {
	const fetchWithParameters = withSearchParameters({apiKey: 'abc'})(mockFetch);
	const response = await fetchWithParameters('/page#section?foo=bar');

	t.is(response.url, '/page?apiKey=abc#section?foo=bar');
});

test('handles fragment-only URL', async t => {
	const fetchWithParameters = withSearchParameters({apiKey: 'abc'})(mockFetch);
	const response = await fetchWithParameters('#section');

	t.is(response.url, '?apiKey=abc#section');
});

test('stacking two withSearchParameters wrappers merges both', async t => {
	const inner = withSearchParameters({apiKey: 'abc'})(mockFetch);
	const outer = withSearchParameters({format: 'json'})(inner);
	const response = await outer('/users');

	t.is(response.url, '/users?format=json&apiKey=abc');
});

test('per-call parameters override both layers of stacked wrappers', async t => {
	const inner = withSearchParameters({apiKey: 'abc', format: 'xml'})(mockFetch);
	const outer = withSearchParameters({format: 'json'})(inner);
	const response = await outer('/users?format=csv');

	t.is(response.url, '/users?apiKey=abc&format=csv');
});

test('special characters in parameter values are encoded', async t => {
	const fetchWithParameters = withSearchParameters({redirect: 'https://example.com/cb?ok=1'})(mockFetch);
	const response = await fetchWithParameters('/auth');

	t.is(response.url, '/auth?redirect=https%3A%2F%2Fexample.com%2Fcb%3Fok%3D1');
});

test('special characters in parameter names are encoded', async t => {
	const fetchWithParameters = withSearchParameters({'my key': 'value'})(mockFetch);
	const response = await fetchWithParameters('/search');

	t.is(response.url, '/search?my+key=value');
});

test('composes with withBaseUrl without pipeline helper', async t => {
	let receivedUrl;
	const capturingFetch = async url => {
		receivedUrl = url;
		return {
			ok: true,
			status: 200,
			statusText: 'OK',
			url,
		};
	};

	const fetchWithBaseUrl = withBaseUrl('https://api.example.com')(capturingFetch);
	const fetchWithBoth = withSearchParameters({apiKey: 'abc'})(fetchWithBaseUrl);

	await fetchWithBoth('/users');

	t.is(receivedUrl, 'https://api.example.com/users?apiKey=abc');
});

test('composes with withBaseUrl and per-call override without pipeline helper', async t => {
	let receivedUrl;
	const capturingFetch = async url => {
		receivedUrl = url;
		return {
			ok: true,
			status: 200,
			statusText: 'OK',
			url,
		};
	};

	const fetchWithBaseUrl = withBaseUrl('https://api.example.com')(capturingFetch);
	const fetchWithBoth = withSearchParameters({apiKey: 'abc'})(fetchWithBaseUrl);

	await fetchWithBoth('/users?page=2');

	t.is(receivedUrl, 'https://api.example.com/users?apiKey=abc&page=2');
});

test('normalizes resolved URL objects before merging search parameters', async t => {
	const {resolveRequestUrlSymbol} = await import('../source/utilities.js');
	const metadataAwareFetch = async url => ({
		ok: true,
		status: 200,
		statusText: 'OK',
		url,
	});
	metadataAwareFetch[resolveRequestUrlSymbol] = urlOrRequest => new URL(urlOrRequest, 'https://api.example.com');
	const fetchWithParameters = withSearchParameters({
		apiKey: 'abc',
	})(metadataAwareFetch);
	const response = await fetchWithParameters('/users');

	t.is(response.url, 'https://api.example.com/users?apiKey=abc');
});

test('reuses the same wrapped function for multiple calls', async t => {
	const fetchWithParameters = withSearchParameters({apiKey: 'abc'})(mockFetch);

	const response1 = await fetchWithParameters('/a');
	const response2 = await fetchWithParameters('/b?page=1');

	t.is(response1.url, '/a?apiKey=abc');
	t.is(response2.url, '/b?apiKey=abc&page=1');
});

test('all default parameters overridden leaves only per-call parameters', async t => {
	const fetchWithParameters = withSearchParameters({a: '1', b: '2'})(mockFetch);
	const response = await fetchWithParameters('/path?a=x&b=y');

	t.is(response.url, '/path?a=x&b=y');
});

test('empty per-call parameter value is preserved', async t => {
	const fetchWithParameters = withSearchParameters({apiKey: 'abc'})(mockFetch);
	const response = await fetchWithParameters('/search?q=');

	t.is(response.url, '/search?apiKey=abc&q=');
});

test('empty default parameter value is preserved', async t => {
	const fetchWithParameters = withSearchParameters({flag: ''})(mockFetch);
	const response = await fetchWithParameters('/users');

	t.is(response.url, '/users?flag=');
});

test('trailing question mark with no parameters', async t => {
	const fetchWithParameters = withSearchParameters({apiKey: 'abc'})(mockFetch);
	const response = await fetchWithParameters('/users?');

	t.is(response.url, '/users?apiKey=abc');
});

test('encoded hash %23 in query value is not treated as fragment', async t => {
	const fetchWithParameters = withSearchParameters({apiKey: 'abc'})(mockFetch);
	const response = await fetchWithParameters('/search?q=a%23b');

	t.is(response.url, '/search?apiKey=abc&q=a%23b');
});

test('query value containing multiple question marks', async t => {
	const fetchWithParameters = withSearchParameters({apiKey: 'abc'})(mockFetch);
	const response = await fetchWithParameters('/search?q=what?why');

	t.is(response.url, '/search?apiKey=abc&q=what%3Fwhy');
});

test('query and fragment both empty', async t => {
	const fetchWithParameters = withSearchParameters({apiKey: 'abc'})(mockFetch);
	const response = await fetchWithParameters('/users?#');

	t.is(response.url, '/users?apiKey=abc#');
});

test('preserves timeout metadata through copyFetchMetadata', async t => {
	const timedFetch = withTimeout(5000)(mockFetch);
	const fetchWithParameters = withSearchParameters({apiKey: 'abc'})(timedFetch);

	const controller = new AbortController();
	const response = await fetchWithParameters('/users', {signal: controller.signal});

	t.is(response.url, '/users?apiKey=abc');
});

test('composes with withHeaders in pipeline', async t => {
	let receivedUrl;
	let receivedOptions;
	const capturingFetch = async (url, options = {}) => {
		receivedUrl = url;
		receivedOptions = options;
		return new Response('ok', {status: 200});
	};

	const apiFetch = pipeline(
		capturingFetch,
		withBaseUrl('https://api.example.com'),
		withSearchParameters({apiKey: 'abc'}),
		withHeaders({Authorization: 'Bearer token'}),
	);

	await apiFetch('/users');

	t.is(receivedUrl, 'https://api.example.com/users?apiKey=abc');
	t.is(receivedOptions.headers.get('authorization'), 'Bearer token');
});

test('does not mutate defaults between calls', async t => {
	const defaults = {apiKey: 'abc', format: 'json'};
	const fetchWithParameters = withSearchParameters(defaults)(mockFetch);

	await fetchWithParameters('/a?format=xml');
	const response = await fetchWithParameters('/b');

	t.is(response.url, '/b?apiKey=abc&format=json');
});

test('url with port number', async t => {
	const fetchWithParameters = withSearchParameters({apiKey: 'abc'})(mockFetch);
	const response = await fetchWithParameters('https://example.com:8080/users?page=1');

	t.is(response.url, 'https://example.com:8080/users?apiKey=abc&page=1');
});

test('url with username and password', async t => {
	const fetchWithParameters = withSearchParameters({apiKey: 'abc'})(mockFetch);
	const response = await fetchWithParameters('https://user:pass@example.com/users');

	t.is(response.url, 'https://user:pass@example.com/users?apiKey=abc');
});

test('unicode parameter values', async t => {
	const fetchWithParameters = withSearchParameters({name: 'café'})(mockFetch);
	const response = await fetchWithParameters('/search');

	t.is(response.url, '/search?name=caf%C3%A9');
});

test('per-call parameter with same key but multiple values replaces all default values for that key', async t => {
	const fetchWithParameters = withSearchParameters([['color', 'red'], ['color', 'blue']])(mockFetch);
	const response = await fetchWithParameters('/items?color=green&color=yellow');

	t.is(response.url, '/items?color=green&color=yellow');
});

test('passes options through for Request objects', async t => {
	let receivedOptions;
	const capturingFetch = async (url, options = {}) => {
		receivedOptions = options;
		return {
			ok: true,
			status: 200,
			statusText: 'OK',
			url,
		};
	};

	const fetchWithParameters = withSearchParameters({apiKey: 'abc'})(capturingFetch);
	await fetchWithParameters(new Request('https://example.com/users'), {method: 'PUT'});

	t.is(receivedOptions.method, 'PUT');
});

test('URL object with fragment preserves fragment', async t => {
	const fetchWithParameters = withSearchParameters({apiKey: 'abc'})(mockFetch);
	const url = new URL('https://example.com/docs#section');
	const response = await fetchWithParameters(url);

	t.is(response.url.href, 'https://example.com/docs?apiKey=abc#section');
});

test('URL object with existing parameters and fragment', async t => {
	const fetchWithParameters = withSearchParameters({apiKey: 'abc'})(mockFetch);
	const url = new URL('https://example.com/docs?page=1#section');
	const response = await fetchWithParameters(url);

	t.is(response.url.href, 'https://example.com/docs?apiKey=abc&page=1#section');
});

test('URL object with empty defaults passes through unchanged', async t => {
	const fetchWithParameters = withSearchParameters({})(mockFetch);
	const url = new URL('https://example.com/users?page=1');
	const response = await fetchWithParameters(url);

	t.is(response.url.href, 'https://example.com/users?page=1');
});

test('URL object multi-value per-call parameters override defaults', async t => {
	const fetchWithParameters = withSearchParameters([['tags', 'a'], ['tags', 'b']])(mockFetch);
	const url = new URL('https://example.com/items?tags=x');
	const response = await fetchWithParameters(url);

	t.is(response.url.href, 'https://example.com/items?tags=x');
});

test('deduplication with URL object uses resolved URL as key', async t => {
	let callCount = 0;
	const countingFetch = async url => {
		callCount++;
		await Promise.resolve();
		return new Response(url instanceof URL ? url.href : url);
	};

	const apiFetch = pipeline(
		countingFetch,
		withSearchParameters({apiKey: 'abc'}),
		withDeduplication(),
	);

	const [first, second] = await Promise.all([
		apiFetch('https://example.com/users'),
		apiFetch('https://example.com/users?apiKey=abc'),
	]);

	t.is(callCount, 1);
	t.is(await first.text(), 'https://example.com/users?apiKey=abc');
	t.is(await second.text(), 'https://example.com/users?apiKey=abc');
});

test('withBaseUrl resolves query params that withSearchParameters then merges into', async t => {
	let receivedUrl;
	const capturingFetch = async url => {
		receivedUrl = url;
		return {
			ok: true,
			status: 200,
			statusText: 'OK',
			url,
		};
	};

	const apiFetch = pipeline(
		capturingFetch,
		withBaseUrl('https://api.example.com'),
		withSearchParameters({apiKey: 'abc'}),
	);

	await apiFetch('/users?page=2');

	t.is(receivedUrl, 'https://api.example.com/users?apiKey=abc&page=2');
});
