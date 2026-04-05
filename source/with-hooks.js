import {
	copyFetchMetadata,
	getFetchSignal,
	getRequestOptions,
	getRequestSignal,
	resolveRequestBody,
	resolveRequestBodySymbol,
	resolveRequestHeaders,
	resolveRequestHeadersSymbol,
	resolveRequestUrl,
} from './utilities.js';

/*
Design note: `withHooks` is one function rather than separate `withBeforeRequest`/`withAfterResponse` functions (even though the split would make call-site syntax simpler) because the shared call frame lets `afterResponse` naturally see the options as modified by `beforeRequest`. Two separate wrappers could share this via a WeakMap on the Response, but that trades one coupling for a worse one: hidden global state.
*/

/**
Wraps a fetch function with hooks that run before each request and after each response.

This is the recommended way to add custom logic (logging, metrics, dynamic headers, response transformation) in the documented pipeline position after request-building wrappers, `withRetry()`, and `withTokenRefresh()`, but before `withHttpError()`. When combined with `withTokenRefresh()`, hooks observe the public call and the final response returned to the caller. The internal refresh retry is not re-hooked.

@param {typeof fetch} fetchFunction - The fetch function to wrap (usually the global `fetch`).
@param {object} [options]
@param {(context: {url: string, options: RequestInit}) => RequestInit | Response | void | Promise<RequestInit | Response | void>} [options.beforeRequest] - Called before each request. Receives the resolved URL and the request options. Return a replacement `RequestInit` to modify the request options, return a `Response` to short-circuit the request entirely (skipping the fetch call and `afterResponse`), or return `undefined` to leave them unchanged.
@param {(context: {url: string, options: RequestInit, response: Response}) => Response | void | Promise<Response | void>} [options.afterResponse] - Called after each response. Receives the response, resolved URL, and the request options. Return a replacement `Response` to modify the response, or return `undefined` to leave it unchanged.
@returns {typeof fetch} A wrapped fetch function with hooks.
*/
export function withHooks(fetchFunction, {beforeRequest, afterResponse} = {}) {
	const setInheritedHookBody = (options, body) => {
		Object.defineProperty(options, 'body', {
			value: body,
			configurable: true,
			writable: true,
		});
	};

	const shouldClearInheritedBody = (request, hookOptions, options) => {
		if (!(request instanceof Request) || hookOptions.body === undefined || Object.hasOwn(options, 'body')) {
			return false;
		}

		return ['GET', 'HEAD'].includes(options.method?.toUpperCase());
	};

	const waitForHook = async (callback, signal) => {
		signal?.throwIfAborted();

		if (!signal) {
			return callback();
		}

		return Promise.race([
			callback(),
			new Promise((_resolve, reject) => {
				signal.addEventListener('abort', () => {
					reject(signal.reason);
				}, {once: true});
			}),
		]);
	};

	const fetchWithHooks = async (urlOrRequest, options = {}) => {
		const getLifecycleSignal = options_ => getFetchSignal(fetchFunction, getRequestSignal(urlOrRequest, options_));

		const getHookOptions = (options_ = {}) => {
			const lifecycleSignal = getLifecycleSignal(options_);
			const effectiveOptions = getRequestOptions(urlOrRequest, options_);

			if (urlOrRequest instanceof Request || fetchFunction[resolveRequestHeadersSymbol] !== undefined) {
				effectiveOptions.headers = Object.fromEntries(resolveRequestHeaders(fetchFunction, urlOrRequest, options_));
			}

			if (urlOrRequest instanceof Request || fetchFunction[resolveRequestBodySymbol] !== undefined) {
				const resolvedBody = resolveRequestBody(fetchFunction, urlOrRequest, options_);

				if (resolvedBody !== undefined) {
					effectiveOptions.body = resolvedBody;
				} else if (urlOrRequest instanceof Request && urlOrRequest.body !== null) {
					setInheritedHookBody(effectiveOptions, urlOrRequest.body);
				}
			}

			if (lifecycleSignal !== undefined) {
				effectiveOptions.signal = lifecycleSignal;
			}

			return effectiveOptions;
		};

		const url = resolveRequestUrl(fetchFunction, urlOrRequest);
		let hookOptions = getHookOptions(options);

		if (beforeRequest) {
			let result = await waitForHook(() => beforeRequest({url, options: hookOptions}), hookOptions.signal);
			if (result instanceof Response) {
				return result;
			}

			if (result !== undefined) {
				if (shouldClearInheritedBody(urlOrRequest, hookOptions, result)) {
					result = {...result, body: undefined};
				}

				options = result;
				hookOptions = getHookOptions(options);
			}
		}

		const requestSignal = getRequestSignal(urlOrRequest, options);
		const fetchOptions = requestSignal === hookOptions.signal
			? options
			: {...options, signal: hookOptions.signal};
		const fetchInput = urlOrRequest instanceof Request && Object.hasOwn(options, 'body') && options.body === undefined
			? url
			: urlOrRequest;

		const response = await fetchFunction(fetchInput, fetchOptions);

		if (afterResponse) {
			const modifiedResponse = await waitForHook(() => afterResponse({url, options: hookOptions, response}), hookOptions.signal);
			if (modifiedResponse !== undefined) {
				return modifiedResponse;
			}
		}

		return response;
	};

	return copyFetchMetadata(fetchWithHooks, fetchFunction);
}
