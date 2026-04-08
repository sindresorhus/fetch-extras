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

export function withRateLimit(fetchFunction, {requestsPerInterval, interval}) {
	if (!Number.isInteger(requestsPerInterval) || requestsPerInterval < 1) {
		throw new TypeError('`requestsPerInterval` must be a positive integer.');
	}

	if (typeof interval !== 'number' || interval <= 0 || !Number.isFinite(interval)) {
		throw new TypeError('`interval` must be a positive finite number.');
	}

	const reservations = [];
	const queue = [];
	let nextSlotTimeout;
	const now = () => performance.now();

	const prune = currentTime => {
		const cutoff = currentTime - interval;
		for (let index = reservations.length - 1; index >= 0; index--) {
			const reservation = reservations[index];
			if (reservation.timestamp !== undefined && reservation.timestamp <= cutoff) {
				reservations.splice(index, 1);
			}
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

			if (reservations.length >= requestsPerInterval) {
				const oldestStartedReservation = reservations.find(reservation => reservation.timestamp !== undefined);
				if (!oldestStartedReservation) {
					return;
				}

				const waitTime = Math.max(oldestStartedReservation.timestamp + interval - currentTime, 0);
				nextSlotTimeout = setTimeout(() => {
					nextSlotTimeout = undefined;
					schedule();
				}, waitTime);
				return;
			}

			const reservation = {
				timestamp: undefined,
			};
			reservations.push(reservation);
			queue.shift();
			entry.resolve(reservation);
		}
	};

	const releaseReservation = reservation => {
		const index = reservations.indexOf(reservation);
		if (index === -1) {
			return;
		}

		reservations.splice(index, 1);
		schedule({force: true});
	};

	const fetchWithRateLimit = async (urlOrRequest, options = {}) => {
		const signal = getFetchSignal(fetchFunction, getRequestSignal(urlOrRequest, options));
		signal?.throwIfAborted();

		const reservation = await enqueueAbortable(queue, {
			signal,
			onAbort() {
				schedule({force: true});
			},
			onEnqueue() {
				schedule();
			},
		});

		const resolvedOptions = signal ? {...options, signal} : options;
		try {
			await resolvedOptions[waitForConcurrencySlotSymbol]?.();
			signal?.throwIfAborted();
		} catch (error) {
			releaseReservation(reservation);
			throw error;
		}

		reservation.timestamp = now();
		schedule({force: true});
		notifyFetchStart(fetchFunction, resolvedOptions);
		return fetchFunction(urlOrRequest, resolvedOptions);
	};

	const wrappedFetch = copyFetchMetadata(fetchWithRateLimit, fetchFunction);
	wrappedFetch[defersConcurrencySlotSymbol] = true;
	wrappedFetch[defersFetchStartSymbol] = true;
	return wrappedFetch;
}
