import {
	pipeline,
	withBaseUrl,
	withCache,
	withDeduplication,
	withHeaders,
	withHttpError,
	withJsonBody,
	withRateLimit,
	withSearchParameters,
	withTimeout,
} from './source/index.js';

const result: number = pipeline(
	1,
	(value: number): string => value.toString(),
	(value: string): number => value.length,
);

const inferredResult: number = pipeline(
	1,
	value => value.toString(),
	value => value.length,
);

const longPipelineResult: string = pipeline(
	1,
	(value: number): number => value + 1,
	(value: number): number => value + 1,
	(value: number): number => value + 1,
	(value: number): number => value + 1,
	(value: number): number => value + 1,
	(value: number): number => value + 1,
	(value: number): string => value.toString(),
);

pipeline(
	1,
	(value: number): number => value + 1,
	(value: number): number => value + 1,
	(value: number): number => value + 1,
	(value: number): number => value + 1,
	(value: number): number => value + 1,
	(value: number): number => value + 1,
	(value: number): number => value + 1,
	(value: number): number => value + 1,
	(value: number): number => value + 1,
	(value: number): number => value + 1,
	(value: number): string => value.toString(),
);

const apiFetch = pipeline(
	fetch,
	fetchFunction => withTimeout(fetchFunction, 5000),
	fetchFunction => withBaseUrl(fetchFunction, 'https://api.example.com'),
	fetchFunction => withHeaders(fetchFunction, new Headers({authorization: 'Bearer token'})),
	withHttpError,
);

const responsePromise: Promise<Response> = apiFetch('/users');

const rateLimitedFetch = withRateLimit(fetch, {requestsPerInterval: 10, interval: 1000});
const rateLimitedResponse: Promise<Response> = rateLimitedFetch('/api');

const cachedFetch = withCache(fetch, {ttl: 60_000});
const cachedResponse: Promise<Response> = cachedFetch('/api');
const readonlySearchParameters = [['apiKey', 'token']] as const;
const fetchWithReadonlySearchParameters = withSearchParameters(fetch, readonlySearchParameters);
const readonlySearchParametersResponse: Promise<Response> = fetchWithReadonlySearchParameters('/api');

void result;
void inferredResult;
void longPipelineResult;
void responsePromise;
void rateLimitedResponse;
const deduplicatedFetch = withDeduplication(fetch);
const deduplicatedResponse: Promise<Response> = deduplicatedFetch('/api');

const jsonFetch = withJsonBody(fetch);
const jsonResponse: Promise<Response> = jsonFetch('/api', {method: 'POST', body: {name: 'Alice'}});
const jsonArrayResponse: Promise<Response> = jsonFetch('/api', {method: 'POST', body: [1, 2, 3]});
const jsonStringResponse: Promise<Response> = jsonFetch('/api', {method: 'POST', body: 'plain string'});

// Verify withJsonBody composes in the documented pipeline order
const jsonPipelineFetch = pipeline(
	fetch,
	fetchFunction => withBaseUrl(fetchFunction, 'https://api.example.com'),
	withJsonBody,
	withHttpError,
);
const jsonPipelineResponse: Promise<Response> = jsonPipelineFetch('/users', {method: 'POST', body: {name: 'Alice'}});

const customFetchWithProperty = Object.assign(fetch, {customProperty: 'value'});
const wrappedCustomFetch = withHttpError(customFetchWithProperty);
const wrappedCustomFetchResponse: Promise<Response> = wrappedCustomFetch('/custom');
// @ts-expect-error Extra function properties are not preserved by wrappers.
void wrappedCustomFetch.customProperty;

const customJsonFetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response & {readonly custom: true}> => {
	void input;
	void init;
	return new Response() as Response & {readonly custom: true};
};

const wrappedCustomJsonFetch = withJsonBody(customJsonFetch);
const wrappedCustomJsonFetchResponse: Promise<Response & {readonly custom: true}> = wrappedCustomJsonFetch('/custom', {body: {name: 'Alice'}});

const headersOnlyFetch = async (input: RequestInfo | URL, init?: {readonly headers?: HeadersInit}): Promise<Response> => {
	void input;
	void init;
	return new Response();
};

const wrappedHeadersOnlyFetch = withJsonBody(headersOnlyFetch);
const wrappedHeadersOnlyFetchResponse: Promise<Response> = wrappedHeadersOnlyFetch('/headers-only', {headers: {'x-test': '1'}});
// @ts-expect-error Wrapped fetch should not gain unrelated RequestInit fields.
void wrappedHeadersOnlyFetch('/headers-only', {method: 'POST'});

const readonlyBodyFetch = async (input: RequestInfo | URL, init?: {readonly body?: string}): Promise<Response> => {
	void input;
	void init;
	return new Response();
};

const wrappedReadonlyBodyFetch = withJsonBody(readonlyBodyFetch);
const wrappedReadonlyBodyFetchResponse: Promise<Response> = wrappedReadonlyBodyFetch('/readonly-body', {body: {name: 'Alice'}});

const bodyForbiddenFetch = async (input: RequestInfo | URL, init?: {readonly body?: never}): Promise<Response> => {
	void input;
	void init;
	return new Response();
};

const wrappedBodyForbiddenFetch = withJsonBody(bodyForbiddenFetch);
// @ts-expect-error Wrapped fetch should not allow body when the original init forbids it.
void wrappedBodyForbiddenFetch('/body-forbidden', {body: {name: 'Alice'}});

const singleArgumentFetch = async (input: RequestInfo | URL): Promise<Response> => {
	void input;
	return new Response();
};

const wrappedSingleArgumentFetch = withJsonBody(singleArgumentFetch);
const wrappedSingleArgumentFetchResponse: Promise<Response> = wrappedSingleArgumentFetch('/single');
// @ts-expect-error Wrapped fetch should preserve the original parameter list.
void wrappedSingleArgumentFetch('/single', {body: {name: 'Alice'}});

void cachedResponse;
void deduplicatedResponse;
void readonlySearchParametersResponse;
void jsonResponse;
void jsonArrayResponse;
void jsonStringResponse;
void jsonPipelineResponse;
void wrappedCustomFetchResponse;
void wrappedCustomJsonFetchResponse;
void wrappedHeadersOnlyFetchResponse;
void wrappedReadonlyBodyFetchResponse;
void wrappedSingleArgumentFetchResponse;
