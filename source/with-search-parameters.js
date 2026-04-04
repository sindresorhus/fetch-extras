import {copyFetchMetadata, resolveRequestUrlSymbol} from './utilities.js';

/**
Wraps a fetch function to include default search parameters on every request. Per-call parameters in the URL take priority over the defaults. String URLs and `URL` objects are modified. `Request` objects are passed through unchanged.

@param {typeof fetch} fetchFunction - The fetch function to wrap (usually the global `fetch`).
@param {Record<string, string> | URLSearchParams | ReadonlyArray<readonly [string, string]>} defaultSearchParameters - Default search parameters to include on every request.
@returns {typeof fetch} A wrapped fetch function that merges the default search parameters into every request URL.
*/
export function withSearchParameters(fetchFunction, defaultSearchParameters) {
	const defaults = new URLSearchParams(defaultSearchParameters);

	const mergeSearchParameters = existingParameters => {
		const merged = new URLSearchParams(defaults);

		// Per-call URL parameters override defaults (like withHeaders)
		for (const key of existingParameters.keys()) {
			merged.delete(key);
		}

		for (const [key, value] of existingParameters) {
			merged.append(key, value);
		}

		return merged;
	};

	const applyToUrl = url => {
		const merged = mergeSearchParameters(url.searchParams);
		const newUrl = new URL(url);
		newUrl.search = merged.toString();
		return newUrl;
	};

	const resolveRequestUrlWithSearchParameters = urlOrRequest => {
		if (urlOrRequest instanceof URL) {
			return applyToUrl(urlOrRequest).href;
		}

		if (typeof urlOrRequest !== 'string') {
			return urlOrRequest instanceof Request ? urlOrRequest.url : String(urlOrRequest);
		}

		const resolvedRequestUrl = fetchFunction[resolveRequestUrlSymbol]?.(urlOrRequest) ?? urlOrRequest;
		const resolvedUrl = resolvedRequestUrl instanceof Request ? resolvedRequestUrl.url : String(resolvedRequestUrl);

		if (/^[a-z][a-z\d+\-.]*:/i.test(resolvedUrl)) {
			return applyToUrl(new URL(resolvedUrl)).href;
		}

		const hashIndex = resolvedUrl.indexOf('#');
		const fragment = hashIndex === -1 ? '' : resolvedUrl.slice(hashIndex);
		const urlWithoutFragment = hashIndex === -1 ? resolvedUrl : resolvedUrl.slice(0, hashIndex);

		const questionIndex = urlWithoutFragment.indexOf('?');
		const urlBase = questionIndex === -1 ? urlWithoutFragment : urlWithoutFragment.slice(0, questionIndex);
		const existingSearch = questionIndex === -1 ? '' : urlWithoutFragment.slice(questionIndex + 1);

		const merged = mergeSearchParameters(new URLSearchParams(existingSearch));
		const search = merged.toString();
		return urlBase + (search ? `?${search}` : '') + fragment;
	};

	const fetchWithSearchParameters = async (urlOrRequest, options = {}) => {
		if (urlOrRequest instanceof URL) {
			return fetchFunction(applyToUrl(urlOrRequest), options);
		}

		return fetchFunction(
			typeof urlOrRequest === 'string' ? resolveRequestUrlWithSearchParameters(urlOrRequest) : urlOrRequest,
			options,
		);
	};

	fetchWithSearchParameters[resolveRequestUrlSymbol] = resolveRequestUrlWithSearchParameters;

	return copyFetchMetadata(fetchWithSearchParameters, fetchFunction);
}
