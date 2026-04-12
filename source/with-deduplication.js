import {
	copyFetchMetadata,
	getResolvedRequestHeaders,
	hasHeaders,
	resolveRequestHeadersSymbol,
	resolveRequestUrl,
	timeoutDurationSymbol,
	withResolvedRequestHeaders,
} from './utilities.js';

function enqueueWaiter(entry) {
	return new Promise((resolve, reject) => {
		entry.waiters.push({resolve, reject});
	});
}

function normalizeDeduplicationKey(key) {
	try {
		return new URL(key).href;
	} catch {
		return key;
	}
}

function resolveDeduplicationKey(fetchFunction, urlOrRequest) {
	return normalizeDeduplicationKey(resolveRequestUrl(fetchFunction, urlOrRequest));
}

function shouldDeduplicate(fetchFunction, urlOrRequest, options) {
	const method = (options.method ?? (urlOrRequest instanceof Request ? urlOrRequest.method : 'GET')).toUpperCase();

	if (method !== 'GET') {
		return false;
	}

	if (urlOrRequest instanceof Request) {
		return false;
	}

	if (fetchFunction[timeoutDurationSymbol] !== undefined) {
		return false;
	}

	return Object.keys(options).length === 0;
}

async function getFetchOptionsWithResolvedHeaders(fetchFunction, urlOrRequest, options) {
	const resolvedHeaders = await getResolvedRequestHeaders(fetchFunction, urlOrRequest, options);

	return withResolvedRequestHeaders(options, resolvedHeaders);
}

export function withDeduplication() {
	return fetchFunction => {
		// In-flight deduplication is per wrapped fetch function, not per curried wrapper factory.
		const pending = new Map();

		const fetchWithDeduplication = async function (urlOrRequest, options) {
			let requestOptions = options ?? {};

			if (!shouldDeduplicate(fetchFunction, urlOrRequest, requestOptions)) {
				return fetchFunction(urlOrRequest, options);
			}

			if (fetchFunction[resolveRequestHeadersSymbol] !== undefined) {
				const requestOptionsWithResolvedHeaders = await getFetchOptionsWithResolvedHeaders(fetchFunction, urlOrRequest, requestOptions);

				if (hasHeaders(requestOptionsWithResolvedHeaders.headers)) {
					return fetchFunction(urlOrRequest, requestOptionsWithResolvedHeaders);
				}

				requestOptions = requestOptionsWithResolvedHeaders;
			}

			const key = resolveDeduplicationKey(fetchFunction, urlOrRequest);
			const existingEntry = pending.get(key);
			if (existingEntry) {
				return enqueueWaiter(existingEntry);
			}

			const entry = {waiters: []};
			pending.set(key, entry);
			const responsePromise = enqueueWaiter(entry);

			try {
				const response = await fetchFunction(urlOrRequest, requestOptions);
				const [firstWaiter, ...otherWaiters] = entry.waiters;

				firstWaiter.resolve(response);

				for (const waiter of otherWaiters) {
					waiter.resolve(response.clone());
				}
			} catch (error) {
				for (const waiter of entry.waiters) {
					waiter.reject(error);
				}
			} finally {
				pending.delete(key);
			}

			return responsePromise;
		};

		return copyFetchMetadata(fetchWithDeduplication, fetchFunction);
	};
}
