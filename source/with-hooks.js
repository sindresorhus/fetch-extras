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
