import {
	copyFetchMetadata,
	getRequestSignal,
	getTimeoutSignal,
	timeoutDurationSymbol,
} from './utilities.js';

export function withTimeout(fetchFunction, timeout) {
	const fetchWithTimeout = async (urlOrRequest, options = {}) => {
		const signal = getTimeoutSignal(timeout, getRequestSignal(urlOrRequest, options));
		return fetchFunction(urlOrRequest, {...options, signal});
	};

	fetchWithTimeout[timeoutDurationSymbol] = timeout;

	return copyFetchMetadata(fetchWithTimeout, fetchFunction);
}
