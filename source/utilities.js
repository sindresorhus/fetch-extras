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
