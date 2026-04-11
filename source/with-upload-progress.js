import {
	blockedRequestBodyHeaderNames,
	blockedDefaultHeaderNamesSymbol,
	copyFetchMetadata,
	deleteHeaders,
	inheritedRequestBodyHeaderNamesSymbol,
	isByteStream,
	trackByteProgress,
	trackProgress,
} from './utilities.js';

function stripContentLength(headers) {
	const cleanedHeaders = new Headers(headers);
	cleanedHeaders.delete('content-length');
	return cleanedHeaders;
}

function mergeMissingRequestHeaders(headers, requestHeaders) {
	const mergedHeaders = new Headers(headers);

	for (const [headerName, headerValue] of requestHeaders) {
		if (headerName === 'content-length' || mergedHeaders.has(headerName)) {
			continue;
		}

		mergedHeaders.set(headerName, headerValue);
	}

	return mergedHeaders;
}

function requestSnapshot(request) {
	const snapshot = {
		method: request.method,
		referrer: request.referrer,
		referrerPolicy: request.referrerPolicy,
		mode: request.mode,
		credentials: request.credentials,
		cache: request.cache,
		keepalive: request.keepalive,
		redirect: request.redirect,
		integrity: request.integrity,
		signal: request.signal,
		headers: stripContentLength(request.headers),
	};

	if ('priority' in request) {
		snapshot.priority = request.priority;
	}

	return snapshot;
}

function markBlockedDefaultHeaders(object, headerNames) {
	object[blockedDefaultHeaderNamesSymbol] = [
		...(object[blockedDefaultHeaderNamesSymbol] ?? []),
		...headerNames,
	];

	return object;
}

export function withUploadProgress({onProgress} = {}) {
	return fetchFunction => {
		const fetchWithUploadProgress = async (urlOrRequest, options = {}) => {
			if (onProgress) {
				const {body} = options;

				if (body instanceof ReadableStream) {
					const trackedStream = isByteStream(body) ? trackByteProgress(body, 0, onProgress) : trackProgress(body, 0, onProgress);

					if (urlOrRequest instanceof Request) {
						if (options[inheritedRequestBodyHeaderNamesSymbol]) {
							options = {
								...options,
								headers: deleteHeaders(new Headers(options.headers), options[inheritedRequestBodyHeaderNamesSymbol]),
							};
						} else {
							options = {
								...options,
								headers: mergeMissingRequestHeaders(options.headers, urlOrRequest.headers),
							};
						}

						const rebuiltRequest = new Request(urlOrRequest.url, requestSnapshot(urlOrRequest));
						rebuiltRequest[blockedDefaultHeaderNamesSymbol] = urlOrRequest[blockedDefaultHeaderNamesSymbol];
						urlOrRequest = rebuiltRequest;
					}

					options = markBlockedDefaultHeaders({...options, body: trackedStream, duplex: 'half'}, blockedRequestBodyHeaderNames);
				}
			}

			return fetchFunction(urlOrRequest, options);
		};

		return copyFetchMetadata(fetchWithUploadProgress, fetchFunction);
	};
}
