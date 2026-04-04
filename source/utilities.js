export const blockedDefaultHeaderNamesSymbol = Symbol('blockedDefaultHeaderNames');
export const inheritedRequestBodyHeaderNamesSymbol = Symbol('inheritedRequestBodyHeaderNames');
export const timeoutDurationSymbol = Symbol('timeoutDuration');
export const resolveRequestUrlSymbol = Symbol('resolveRequestUrl');
export const resolveAuthorizationHeaderSymbol = Symbol('resolveAuthorizationHeader');
export const resolveRequestHeadersSymbol = Symbol('resolveRequestHeaders');
export const requestBodyHeaderNames = [
	'content-encoding',
	'content-language',
	'content-location',
	'content-type',
];
export const blockedRequestBodyHeaderNames = ['content-length', ...requestBodyHeaderNames];
const textEncoder = new TextEncoder();

function chunkLength(chunk) {
	if (typeof chunk === 'string') {
		return textEncoder.encode(chunk).byteLength;
	}

	return chunk.byteLength;
}

function reportProgress(transferredBytes, totalBytes, onProgress) {
	const effectiveTotalBytes = Math.max(totalBytes, transferredBytes);

	const percent = totalBytes === 0
		? 0
		: Math.min(transferredBytes / (effectiveTotalBytes + 1), 1 - Number.EPSILON);

	onProgress({percent, transferredBytes, totalBytes: effectiveTotalBytes});
}

function reportCompletion(transferredBytes, totalBytes, onProgress) {
	onProgress({percent: 1, transferredBytes, totalBytes: Math.max(totalBytes, transferredBytes)});
}

export function isByteStream(stream) {
	try {
		const reader = stream.getReader({mode: 'byob'});
		reader.releaseLock();
		return true;
	} catch {
		return false;
	}
}

export function trackProgress(stream, totalBytes, onProgress) {
	let transferredBytes = 0;

	return stream.pipeThrough(new TransformStream({
		transform(chunk, controller) {
			controller.enqueue(chunk);
			transferredBytes += chunkLength(chunk);
			reportProgress(transferredBytes, totalBytes, onProgress);
		},
		flush() {
			reportCompletion(transferredBytes, totalBytes, onProgress);
		},
	}));
}

export function trackByteProgress(stream, totalBytes, onProgress) {
	let transferredBytes = 0;
	let isCanceled = false;
	let didReportCompletion = false;
	const reader = stream.getReader();

	const emitCompletion = () => {
		if (isCanceled || didReportCompletion) {
			return;
		}

		didReportCompletion = true;
		reportCompletion(transferredBytes, totalBytes, onProgress);
	};

	const watchForClose = async () => {
		try {
			await reader.closed;
			await Promise.resolve();
			emitCompletion();
		} catch {}
	};

	watchForClose();

	return new ReadableStream({
		type: 'bytes',
		async pull(controller) {
			const {done, value} = await reader.read();

			if (done) {
				controller.close();
				return;
			}

			transferredBytes += chunkLength(value);
			reportProgress(transferredBytes, totalBytes, onProgress);
			controller.enqueue(value);
		},
		cancel(reason) {
			isCanceled = true;
			return reader.cancel(reason);
		},
	});
}

/**
Creates a promise that resolves after the specified delay.

@param {number} milliseconds - The delay duration in milliseconds.
@param {{signal?: AbortSignal}} [options] - Options for the delay.
@returns {Promise<void>} A promise that resolves after the delay.
*/
export function delay(milliseconds, {signal} = {}) {
	return new Promise((resolve, reject) => {
		signal?.throwIfAborted();

		const timeout = setTimeout(() => {
			cleanup();
			resolve();
		}, milliseconds);

		const cleanup = () => {
			signal?.removeEventListener('abort', onAbort);
		};

		const onAbort = () => {
			clearTimeout(timeout);
			cleanup();
			reject(signal.reason);
		};

		signal?.addEventListener('abort', onAbort, {once: true});
	});
}

export function resolveRequestUrl(fetchFunction, urlOrRequest) {
	const resolvedUrl = fetchFunction[resolveRequestUrlSymbol]?.(urlOrRequest) ?? urlOrRequest;
	const url = resolvedUrl instanceof Request
		? resolvedUrl.url
		: String(resolvedUrl);

	return url.split('#', 1)[0];
}

export function deleteHeaders(headers, headerNames) {
	for (const headerName of headerNames) {
		headers.delete(headerName);
	}

	return headers;
}

export function setHeaders(headers, sourceHeaders) {
	if (!sourceHeaders) {
		return headers;
	}

	for (const [key, value] of new Headers(sourceHeaders)) {
		headers.set(key, value);
	}

	return headers;
}

export function getRequestReplayHeaders(request, options = {}) {
	const requestHeaders = new Headers(request?.headers);
	const callHeaders = new Headers(options.headers);

	if (request && options.body !== undefined) {
		deleteHeaders(callHeaders, options[inheritedRequestBodyHeaderNamesSymbol] ?? []);
	}

	return setHeaders(requestHeaders, callHeaders);
}

export function getRequestSignal(urlOrRequest, options = {}) {
	return options.signal ?? (urlOrRequest instanceof Request ? urlOrRequest.signal : undefined);
}

export function getTimeoutSignal(timeout, providedSignal) {
	const timeoutSignal = AbortSignal.timeout(timeout);

	if (providedSignal) {
		return AbortSignal.any([providedSignal, timeoutSignal]);
	}

	return timeoutSignal;
}

export function getFetchSignal(fetchFunction, providedSignal) {
	const timeoutDuration = fetchFunction[timeoutDurationSymbol];

	if (timeoutDuration === undefined) {
		return providedSignal;
	}

	return getTimeoutSignal(timeoutDuration, providedSignal);
}

export async function discardBody(body) {
	try {
		await body?.cancel?.();
	} catch {}
}

export function requestSnapshot(request) {
	return {
		method: request.method,
		referrer: request.referrer,
		referrerPolicy: request.referrerPolicy,
		mode: request.mode,
		credentials: request.credentials,
		cache: request.cache,
		redirect: request.redirect,
		integrity: request.integrity,
		keepalive: request.keepalive,
		signal: request.signal,
		duplex: request.duplex,
		priority: request.priority,
	};
}

export function copyFetchMetadata(targetFetch, sourceFetch) {
	/*
	Boundary: this only forwards metadata that outer wrappers need to preserve their documented behavior.
	Right now that is timeoutDurationSymbol, resolveRequestUrlSymbol, resolveAuthorizationHeaderSymbol, and resolveRequestHeadersSymbol so wrappers can preserve timeout behavior, URL-based composition semantics, Authorization-scoped refresh deduplication, and effective request-header inspection through simple wrapper chains.
	Do not expand this into a generic wrapper-introspection channel.
	*/
	if (sourceFetch[timeoutDurationSymbol] !== undefined) {
		targetFetch[timeoutDurationSymbol] = sourceFetch[timeoutDurationSymbol];
	}

	if (targetFetch[resolveRequestUrlSymbol] === undefined && sourceFetch[resolveRequestUrlSymbol] !== undefined) {
		targetFetch[resolveRequestUrlSymbol] = sourceFetch[resolveRequestUrlSymbol];
	}

	if (targetFetch[resolveAuthorizationHeaderSymbol] === undefined && sourceFetch[resolveAuthorizationHeaderSymbol] !== undefined) {
		targetFetch[resolveAuthorizationHeaderSymbol] = sourceFetch[resolveAuthorizationHeaderSymbol];
	}

	if (targetFetch[resolveRequestHeadersSymbol] === undefined && sourceFetch[resolveRequestHeadersSymbol] !== undefined) {
		targetFetch[resolveRequestHeadersSymbol] = sourceFetch[resolveRequestHeadersSymbol];
	}

	return targetFetch;
}
