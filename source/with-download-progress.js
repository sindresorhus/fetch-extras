import {
	copyFetchMetadata,
	isByteStream,
	isImmutableHeaders,
	trackByteProgress,
	trackProgress,
	withResponseMetadata,
} from './utilities.js';

function responseTotalBytes(response, immutableHeaders) {
	if (immutableHeaders && response.url && response.headers.has('content-encoding')) {
		return 0;
	}

	return Math.max(0, Number(response.headers.get('content-length')) || 0);
}

export function withDownloadProgress(fetchFunction, {onProgress} = {}) {
	const fetchWithDownloadProgress = async (urlOrRequest, options = {}) => {
		const response = await fetchFunction(urlOrRequest, options);

		if (onProgress && response.body) {
			const immutableHeaders = isImmutableHeaders(response.headers);
			const totalBytes = responseTotalBytes(response, immutableHeaders);
			const trackedBody = isByteStream(response.body) ? trackByteProgress(response.body, totalBytes, onProgress) : trackProgress(response.body, totalBytes, onProgress);
			return withResponseMetadata(response, trackedBody);
		}

		return response;
	};

	return copyFetchMetadata(fetchWithDownloadProgress, fetchFunction);
}
