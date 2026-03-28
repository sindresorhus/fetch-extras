export const blockedDefaultHeaderNamesSymbol = Symbol('blockedDefaultHeaderNames');
export const inheritedRequestBodyHeaderNamesSymbol = Symbol('inheritedRequestBodyHeaderNames');
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

		const rejectWithAbortReason = () => {
			try {
				signal.throwIfAborted();
			} catch (error) {
				reject(error);
			}
		};

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
			rejectWithAbortReason();
		};

		signal?.addEventListener('abort', onAbort, {once: true});
	});
}
