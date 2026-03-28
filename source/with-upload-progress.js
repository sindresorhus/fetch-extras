import {
	blockedRequestBodyHeaderNames,
	blockedDefaultHeaderNamesSymbol,
	inheritedRequestBodyHeaderNamesSymbol,
	isByteStream,
	trackByteProgress,
	trackProgress,
} from './utilities.js';

function stripInheritedBodyHeaders(headers, headerNames) {
	const cleanedHeaders = new Headers(headers);

	for (const headerName of headerNames) {
		cleanedHeaders.delete(headerName);
	}

	return cleanedHeaders;
}

function stripContentLength(headers) {
	const cleanedHeaders = new Headers(headers);
	cleanedHeaders.delete('content-length');
	return cleanedHeaders;
}

function requestSnapshot(request) {
	const snapshot = {
		method: request.method,
		referrer: request.referrer,
		referrerPolicy: request.referrerPolicy,
		mode: request.mode,
		credentials: request.credentials,
		cache: request.cache,
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

export function withUploadProgress(fetchFunction, {onProgress} = {}) {
	return async (urlOrRequest, options = {}) => {
		if (onProgress) {
			const {body} = options;

			if (body instanceof ReadableStream) {
				const trackedStream = isByteStream(body) ? trackByteProgress(body, 0, onProgress) : trackProgress(body, 0, onProgress);

				if (urlOrRequest instanceof Request) {
					if (options[inheritedRequestBodyHeaderNamesSymbol]) {
						options = {
							...options,
							headers: stripInheritedBodyHeaders(options.headers, options[inheritedRequestBodyHeaderNamesSymbol]),
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
}
