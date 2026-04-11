import {
	copyFetchMetadata,
	defersConcurrencySlotSymbol,
	defersFetchStartSymbol,
	enqueueAbortable,
	getFetchSignal,
	getRequestSignal,
	notifyFetchStart,
	waitForConcurrencySlotSymbol,
} from './utilities.js';

export function withConcurrency({maxConcurrentRequests}) {
	if (!Number.isInteger(maxConcurrentRequests) || maxConcurrentRequests < 1) {
		throw new TypeError('`maxConcurrentRequests` must be a positive integer.');
	}

	let activeCount = 0;
	const queue = [];

	return fetchFunction => {
		const tryNext = () => {
			while (queue.length > 0 && activeCount < maxConcurrentRequests) {
				const entry = queue.shift();

				if (entry.signal?.aborted) {
					entry.reject(entry.signal.reason);
					continue;
				}

				activeCount++;
				entry.resolve();
			}
		};

		const waitForSlot = async signal => {
			signal?.throwIfAborted();

			if (activeCount < maxConcurrentRequests) {
				activeCount++;
				return;
			}

			await enqueueAbortable(queue, {signal});
		};

		const createReleaseSlot = () => {
			let didReleaseSlot = false;

			return () => {
				if (didReleaseSlot) {
					return;
				}

				didReleaseSlot = true;
				activeCount--;
				tryNext();
			};
		};

		const fetchWithConcurrency = async (urlOrRequest, options = {}) => {
			const signal = getFetchSignal(fetchFunction, getRequestSignal(urlOrRequest, options));
			let releaseSlot;

			const acquireSlot = async () => {
				if (releaseSlot) {
					return;
				}

				await waitForSlot(signal);
				releaseSlot = createReleaseSlot();
			};

			signal?.throwIfAborted();
			const resolvedOptions = fetchFunction[defersConcurrencySlotSymbol]
				? {...options, [waitForConcurrencySlotSymbol]: acquireSlot}
				: options;

			try {
				if (!fetchFunction[defersConcurrencySlotSymbol]) {
					await acquireSlot();
				}

				const fetchOptions = signal ? {...resolvedOptions, signal} : resolvedOptions;
				notifyFetchStart(fetchFunction, fetchOptions);
				return await fetchFunction(urlOrRequest, fetchOptions);
			} finally {
				releaseSlot?.();
			}
		};

		const wrappedFetch = copyFetchMetadata(fetchWithConcurrency, fetchFunction);
		wrappedFetch[defersFetchStartSymbol] = true;
		return wrappedFetch;
	};
}
