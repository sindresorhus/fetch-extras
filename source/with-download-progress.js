import {isByteStream, trackByteProgress, trackProgress} from './utilities.js';

function isImmutableHeaders(headers) {
	try {
		headers.set('x-fetch-extras-immutability-check', '1');
		headers.delete('x-fetch-extras-immutability-check');
		return false;
	} catch {
		return true;
	}
}

function freezeResponseHeaders(headers) {
	Object.defineProperties(headers, {
		append: {
			value() {
				throw new TypeError('immutable');
			},
		},
		delete: {
			value() {
				throw new TypeError('immutable');
			},
		},
		set: {
			value() {
				throw new TypeError('immutable');
			},
		},
	});

	return headers;
}

function copyResponseMetadata(targetResponse, sourceResponse, immutableHeaders) {
	const properties = {
		url: {
			value: sourceResponse.url,
		},
		type: {
			value: sourceResponse.type,
		},
		redirected: {
			value: sourceResponse.redirected,
		},
		clone: {
			value() {
				const clonedResponse = Response.prototype.clone.call(this);
				copyResponseMetadata(clonedResponse, this, immutableHeaders);
				return clonedResponse;
			},
		},
	};

	if (immutableHeaders) {
		freezeResponseHeaders(targetResponse.headers);
	}

	Object.defineProperties(targetResponse, properties);
}

function responseTotalBytes(response, immutableHeaders) {
	if (immutableHeaders && response.url && response.headers.has('content-encoding')) {
		return 0;
	}

	return Math.max(0, Number(response.headers.get('content-length')) || 0);
}

function withResponseMetadata(response, trackedBody, immutableHeaders) {
	const trackedResponse = new Response(trackedBody, {
		status: response.status,
		statusText: response.statusText,
		headers: response.headers,
	});

	copyResponseMetadata(trackedResponse, response, immutableHeaders);

	return trackedResponse;
}

export function withDownloadProgress(fetchFunction, {onProgress} = {}) {
	return async (urlOrRequest, options = {}) => {
		const response = await fetchFunction(urlOrRequest, options);

		if (onProgress && response.body) {
			const immutableHeaders = isImmutableHeaders(response.headers);
			const totalBytes = responseTotalBytes(response, immutableHeaders);
			const trackedBody = isByteStream(response.body) ? trackByteProgress(response.body, totalBytes, onProgress) : trackProgress(response.body, totalBytes, onProgress);
			return withResponseMetadata(response, trackedBody, immutableHeaders);
		}

		return response;
	};
}
