import {
	copyFetchMetadata,
	defersConcurrencySlotSymbol,
	enqueueAbortable,
	getFetchSignal,
	getRequestSignal,
	waitForConcurrencySlotSymbol,
} from './utilities.js';

export function withConcurrency(fetchFunction, {maxConcurrentRequests}) {
	if (!Number.isInteger(maxConcurrentRequests) || maxConcurrentRequests < 1) {
		throw new TypeError('`maxConcurrentRequests` must be a positive integer.');
	}

	let activeCount = 0;
	const queue = [];

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

			return await fetchFunction(urlOrRequest, signal ? {...resolvedOptions, signal} : resolvedOptions);
		} finally {
			releaseSlot?.();
		}
	};

	return copyFetchMetadata(fetchWithConcurrency, fetchFunction);
}
