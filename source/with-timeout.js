import {timeoutDurationSymbol} from './utilities.js';

export function withTimeout(fetchFunction, timeout) {
	const fetchWithTimeout = async (urlOrRequest, options = {}) => {
		const providedSignal = options.signal ?? (urlOrRequest instanceof Request && urlOrRequest.signal);
		const timeoutSignal = AbortSignal.timeout(timeout);
		const signal = providedSignal ? AbortSignal.any([providedSignal, timeoutSignal]) : timeoutSignal;
		return fetchFunction(urlOrRequest, {...options, signal});
	};

	fetchWithTimeout[timeoutDurationSymbol] = timeout;

	return fetchWithTimeout;
}
