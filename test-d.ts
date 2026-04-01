import {
	pipeline,
	withBaseUrl,
	withHeaders,
	withHttpError,
	withRateLimit,
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

void result;
void inferredResult;
void longPipelineResult;
void responsePromise;
void rateLimitedResponse;
