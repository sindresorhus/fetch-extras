import {
	copyFetchMetadata,
	defersFetchStartSymbol,
	getResolvedRequestHeaders,
	getRequestOptions,
	notifyFetchStart,
	resolveRequestBody,
	resolveRequestBodySymbol,
	resolveRequestHeadersSymbol,
	resolveRequestUrl,
	waitForAbortable,
	withFetchSignal,
	withResolvedRequestHeaders,
} from './utilities.js';

const inheritedHookBodies = new WeakSet();

/*
Design note: `withHooks` is one function rather than separate `withBeforeRequest`/`withAfterResponse` functions (even though the split would make call-site syntax simpler) because the shared call frame lets `afterResponse` naturally see the options as modified by `beforeRequest`. Two separate wrappers could share this via a WeakMap on the Response, but that trades one coupling for a worse one: hidden global state.
*/

/**
Wraps a fetch function with hooks that run before each request and after each response.

This is the recommended way to add custom logic (logging, metrics, dynamic headers, response transformation) in documented `pipeline()` order after request-building wrappers, `withRetry()`, and `withTokenRefresh()`, but before `withHttpError()`. Hooks receive the effective request state for their stage, including URL, headers, and replayable body transformations already prepared by upstream wrappers in documented `pipeline()` order. When combined with `withTokenRefresh()`, hooks observe the public call and the final response returned to the caller. The internal refresh retry is not re-hooked.

@param {object} [options]
@param {(context: {url: string, options: RequestInit}) => RequestInit | Response | void | Promise<RequestInit | Response | void>} [options.beforeRequest] - Called before each request. Receives the resolved URL and the request options. Return a replacement `RequestInit` to modify the request options, return a `Response` to short-circuit the request entirely (skipping the fetch call and `afterResponse`), or return `undefined` to leave them unchanged.
@param {(context: {url: string, options: RequestInit, response: Response}) => Response | void | Promise<Response | void>} [options.afterResponse] - Called after each response. Receives the resolved URL, the request options, and the response. Return a replacement `Response` to modify the response, or return `undefined` to leave it unchanged.
@returns {(fetchFunction: typeof fetch) => typeof fetch} A function that accepts a fetch function and returns a wrapped fetch function with hooks.
*/
export function withHooks({beforeRequest, afterResponse} = {}) {
	return fetchFunction => {
		const setInheritedHookBody = (options, body) => {
			// Hooks should be able to inspect an inherited Request body without turning it into an explicit override when the same object is returned unchanged.
			inheritedHookBodies.add(options);
			Object.setPrototypeOf(options, {
				body,
			});
		};

		const fetchWithHooks = async (urlOrRequest, options = {}) => {
			const getHookOptions = async (options_ = {}) => {
				const effectiveOptions = getRequestOptions(urlOrRequest, options_);

				if (urlOrRequest instanceof Request || fetchFunction[resolveRequestHeadersSymbol] !== undefined) {
					effectiveOptions.headers = Object.fromEntries(await getResolvedRequestHeaders(fetchFunction, urlOrRequest, options_));
				}

				if (urlOrRequest instanceof Request || fetchFunction[resolveRequestBodySymbol] !== undefined) {
					const resolvedBody = resolveRequestBody(fetchFunction, urlOrRequest, options_);

					if (resolvedBody !== undefined) {
						effectiveOptions.body = resolvedBody;
					} else if (urlOrRequest instanceof Request && urlOrRequest.body !== null) {
						setInheritedHookBody(effectiveOptions, urlOrRequest.body);
					}
				}

				const lifecycleSignal = withFetchSignal(fetchFunction, urlOrRequest, options_).signal;

				if (lifecycleSignal !== undefined) {
					effectiveOptions.signal = lifecycleSignal;
				}

				return effectiveOptions;
			};

			const getFetchOptions = (options_, headers, signal) => {
				// Strip the prototype-only inherited body marker before calling the inner fetch so no-op hooks do not change downstream wrapper semantics.
				let fetchOptions = inheritedHookBodies.has(options_) ? {...options_} : options_;

				if (headers !== undefined) {
					fetchOptions = withResolvedRequestHeaders(fetchOptions, headers);
				}

				return signal === undefined
					? fetchOptions
					: {...fetchOptions, signal};
			};

			const shouldClearInheritedBody = (request, hookOptions, options_) => {
				if (!(request instanceof Request) || hookOptions.body === undefined || Object.hasOwn(options_, 'body')) {
					return false;
				}

				return ['GET', 'HEAD'].includes(options_.method?.toUpperCase());
			};

			const url = resolveRequestUrl(fetchFunction, urlOrRequest);
			let hookOptions = await getHookOptions(options);

			if (beforeRequest) {
				const result = await waitForAbortable(() => beforeRequest({url, options: hookOptions}), hookOptions.signal);
				if (result instanceof Response) {
					return result;
				}

				if (result !== undefined) {
					let nextOptions = result;

					if (shouldClearInheritedBody(urlOrRequest, hookOptions, nextOptions)) {
						nextOptions = {...nextOptions, body: undefined};
					}

					options = nextOptions;
					hookOptions = await getHookOptions(options);
				}
			}

			const finalFetchOptions = getFetchOptions(options, hookOptions.headers, hookOptions.signal);
			const fetchInput = urlOrRequest instanceof Request && Object.hasOwn(finalFetchOptions, 'body') && finalFetchOptions.body === undefined
				? url
				: urlOrRequest;

			notifyFetchStart(fetchFunction, finalFetchOptions);
			const response = await fetchFunction(fetchInput, finalFetchOptions);

			if (afterResponse) {
				const modifiedResponse = await waitForAbortable(() => afterResponse({url, options: hookOptions, response}), hookOptions.signal);
				if (modifiedResponse !== undefined) {
					return modifiedResponse;
				}
			}

			return response;
		};

		const wrappedFetch = copyFetchMetadata(fetchWithHooks, fetchFunction);
		wrappedFetch[defersFetchStartSymbol] = true;
		return wrappedFetch;
	};
}
