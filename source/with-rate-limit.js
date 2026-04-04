import {copyFetchMetadata, getFetchSignal, getRequestSignal} from './utilities.js';

export function withRateLimit(fetchFunction, {requestsPerInterval, interval}) {
	if (!Number.isInteger(requestsPerInterval) || requestsPerInterval < 1) {
		throw new TypeError('`requestsPerInterval` must be a positive integer.');
	}

	if (typeof interval !== 'number' || interval <= 0 || !Number.isFinite(interval)) {
		throw new TypeError('`interval` must be a positive finite number.');
	}

	const timestamps = [];
	const queue = [];
	let nextSlotTimeout;
	const now = () => performance.now();

	const prune = currentTime => {
		const cutoff = currentTime - interval;
		while (timestamps.length > 0 && timestamps[0] <= cutoff) {
			timestamps.shift();
		}
	};

	const clearNextSlotTimeout = () => {
		if (nextSlotTimeout === undefined) {
			return;
		}

		clearTimeout(nextSlotTimeout);
		nextSlotTimeout = undefined;
	};

	const schedule = ({force = false} = {}) => {
		if (nextSlotTimeout !== undefined && !force) {
			return;
		}

		clearNextSlotTimeout();

		const currentTime = now();
		prune(currentTime);

		while (queue.length > 0) {
			const entry = queue[0];

			if (entry.signal?.aborted) {
				queue.shift();
				entry.reject(entry.signal.reason);
				continue;
			}

			if (timestamps.length >= requestsPerInterval) {
				const waitTime = Math.max(timestamps[0] + interval - currentTime, 0);
				nextSlotTimeout = setTimeout(() => {
					nextSlotTimeout = undefined;
					schedule();
				}, waitTime);
				return;
			}

			timestamps.push(currentTime);
			queue.shift();
			entry.resolve();
		}
	};

	const fetchWithRateLimit = async (urlOrRequest, options = {}) => {
		const signal = getFetchSignal(fetchFunction, getRequestSignal(urlOrRequest, options));

		signal?.throwIfAborted();

		await new Promise((resolve, reject) => {
			let isSettled = false;

			const cleanup = () => {
				signal?.removeEventListener('abort', onAbort);
			};

			const settle = callback => {
				if (isSettled) {
					return;
				}

				isSettled = true;
				cleanup();
				callback();
			};

			const onAbort = () => {
				const index = queue.indexOf(entry);
				if (index !== -1) {
					queue.splice(index, 1);
				}

				settle(() => {
					reject(signal.reason);
				});
				schedule({force: true});
			};

			const entry = {
				signal,
				resolve() {
					settle(resolve);
				},
				reject(error) {
					settle(() => {
						reject(error);
					});
				},
			};

			signal?.addEventListener('abort', onAbort, {once: true});
			queue.push(entry);
			schedule();
		});

		return fetchFunction(urlOrRequest, signal ? {...options, signal} : options);
	};

	return copyFetchMetadata(fetchWithRateLimit, fetchFunction);
}
