import {
	pipeline,
	SchemaValidationError,
	throwIfHttpError,
	withBaseUrl,
	withCache,
	withConcurrency,
	withDeduplication,
	withDownloadProgress,
	withHeaders,
	withHooks,
	withHttpError,
	withJsonBody,
	withJsonResponse,
	withRateLimit,
	withResponse,
	withRetry,
	withSearchParameters,
	withTimeout,
	withTokenRefresh,
	withUploadProgress,
	type ResponseTransform,
	type StandardSchemaV1,
	type StandardSchemaV1InferOutput,
	type StandardSchemaV1Issue,
	type StandardSchemaV1Options,
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

const directHttpErrorResponse: Response = throwIfHttpError(new Response());
const promisedHttpErrorResponse: Promise<Response> = throwIfHttpError(Promise.resolve(new Response()));

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

const veryLongPipelineResult: string = pipeline(
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
	(value: number): number => value + 1,
	(value: number): string => value.toString(),
);

const apiFetch = pipeline(
	fetch,
	withTimeout(5000),
	withBaseUrl('https://api.example.com'),
	withHeaders(new Headers({authorization: 'Bearer token'})),
	withHeaders(() => ({authorization: 'Bearer token'})),
	withHeaders(async () => ({authorization: 'Bearer token'})),
	withHttpError(),
);

const responsePromise: Promise<Response> = apiFetch('/users');

const rateLimitedFetch = withRateLimit({requestsPerInterval: 10, interval: 1000})(fetch);
const rateLimitedResponse: Promise<Response> = rateLimitedFetch('/api');

const cachedFetch = withCache({ttl: 60_000})(fetch);
const cachedResponse: Promise<Response> = cachedFetch('/api');
const tokenRefreshFetch = withTokenRefresh({
	refreshToken() {
		return 'sync-token';
	},
})(fetch);
const tokenRefreshResponse: Promise<Response> = tokenRefreshFetch('/api');
const readonlySearchParameters = [['apiKey', 'token']] as const;
const fetchWithReadonlySearchParameters = withSearchParameters(readonlySearchParameters)(fetch);
const readonlySearchParametersResponse: Promise<Response> = fetchWithReadonlySearchParameters('/api');

void result;
void inferredResult;
void directHttpErrorResponse;
void promisedHttpErrorResponse;
void longPipelineResult;
void veryLongPipelineResult;
void responsePromise;
void rateLimitedResponse;
const deduplicatedFetch = withDeduplication()(fetch);
const deduplicatedResponse: Promise<Response> = deduplicatedFetch('/api');

const jsonFetch = withJsonBody()(fetch);
const jsonResponse: Promise<Response> = jsonFetch('/api', {method: 'POST', body: {name: 'Alice'}});
const jsonArrayResponse: Promise<Response> = jsonFetch('/api', {method: 'POST', body: [1, 2, 3]});
const jsonStringResponse: Promise<Response> = jsonFetch('/api', {method: 'POST', body: 'plain string'});

// Verify withJsonBody composes in the documented pipeline order
const jsonPipelineFetch = pipeline(
	fetch,
	withBaseUrl('https://api.example.com'),
	withJsonBody(),
	withHttpError(),
);
const jsonPipelineResponse: Promise<Response> = jsonPipelineFetch('/users', {method: 'POST', body: {name: 'Alice'}});

const customFetchWithProperty = Object.assign(fetch, {customProperty: 'value'});
const wrappedCustomFetch = withHttpError()(customFetchWithProperty);
const wrappedCustomFetchResponse: Promise<Response> = wrappedCustomFetch('/custom');
// @ts-expect-error Extra function properties are not preserved by wrappers.
void wrappedCustomFetch.customProperty;

void cachedResponse;
void tokenRefreshResponse;
void deduplicatedResponse;
void readonlySearchParametersResponse;
void jsonResponse;
void jsonArrayResponse;
void jsonStringResponse;
void jsonPipelineResponse;
void wrappedCustomFetchResponse;

// WithHooks
const fetchWithHooks = withHooks({
	beforeRequest({url, options}) {
		void url;
		void options;
	},
	afterResponse({url, options, response}) {
		void url;
		void options;
		void response;
	},
})(fetch);
const hooksResponse: Promise<Response> = fetchWithHooks('/api');
void hooksResponse;

// WithHooks in pipeline
const hooksPipelineFetch = pipeline(
	fetch,
	withBaseUrl('https://api.example.com'),
	withHooks({
		beforeRequest({url, options}) {
			return {...options, headers: {'X-Request-ID': url}};
		},
		afterResponse({response}) {
			return response;
		},
	}),
	withHttpError(),
);
const hooksPipelineResponse: Promise<Response> = hooksPipelineFetch('/users');
void hooksPipelineResponse;

// WithHooks with no options
const fetchWithNoHooks = withHooks()(fetch);
const noHooksResponse: Promise<Response> = fetchWithNoHooks('/api');
void noHooksResponse;

// `withJsonResponse` (no schema)
const fetchJson = withJsonResponse()(fetch);
const jsonData: Promise<unknown> = fetchJson('/api/data');
void jsonData;
// @ts-expect-error withJsonResponse does not widen request bodies by itself.
void fetchJson('/api/data', {method: 'POST', body: {name: 'Alice'}});

const fetchJsonWithEmptyOptions = withJsonResponse({})(fetch);
const jsonDataWithEmptyOptions: Promise<unknown> = fetchJsonWithEmptyOptions('/api/data');
void jsonDataWithEmptyOptions;

// `withJsonResponse` (no schema) in pipeline
const fetchJsonPipeline = pipeline(
	fetch,
	withTimeout(5000),
	withHttpError(),
	withJsonResponse(),
);
const pipelineJson: Promise<unknown> = fetchJsonPipeline('/api/data');
void pipelineJson;

const fetchJsonBodyPipeline = pipeline(
	fetch,
	withJsonBody(),
	withJsonResponse(),
);
const jsonBodyPipelineData: Promise<unknown> = fetchJsonBodyPipeline('/api/data', {method: 'POST', body: {}});
const jsonArrayBodyPipelineData: Promise<unknown> = fetchJsonBodyPipeline('/api/data', {method: 'POST', body: []});
const jsonReadonlyArrayBodyPipelineData: Promise<unknown> = fetchJsonBodyPipeline('/api/data', {method: 'POST', body: ['Alice'] as const});
// @ts-expect-error withJsonResponse returns parsed data, not a Response.
const jsonBodyPipelineResponse: Promise<Response> = fetchJsonBodyPipeline('/api/data', {method: 'POST', body: {}});
void jsonBodyPipelineData;
void jsonArrayBodyPipelineData;
void jsonReadonlyArrayBodyPipelineData;
void jsonBodyPipelineResponse;

// `withJsonResponse` (with schema)
type User = {name: string; age: number};
const userSchema: StandardSchemaV1<unknown, User> = {
	// eslint-disable-next-line @typescript-eslint/naming-convention
	'~standard': {
		version: 1,
		vendor: 'test',
		validate(value) {
			return {value: value as User};
		},
	},
};

const fetchUser = withJsonResponse({schema: userSchema})(fetch);
const user: Promise<User> = fetchUser('/api/user');
void user;

const schemaOptions: StandardSchemaV1Options = {
	libraryOptions: {
		abortEarly: true,
	},
};
const fetchUserWithSchemaOptions = withJsonResponse({schema: userSchema, schemaOptions})(fetch);
const userWithSchemaOptions: Promise<User> = fetchUserWithSchemaOptions('/api/user');
void userWithSchemaOptions;

const enabled = Math.random() > 0.5;
const maybeSchemaOptions = enabled ? {schema: userSchema} : {};
const fetchMaybeValidatedUser = withJsonResponse(maybeSchemaOptions)(fetch);
const maybeValidatedUser: Promise<unknown> = fetchMaybeValidatedUser('/api/user');
void maybeValidatedUser;

// WithJsonResponse (with schema) in pipeline
const fetchUserPipeline = pipeline(
	fetch,
	withTimeout(5000),
	withBaseUrl('https://api.example.com'),
	withHttpError(),
	withJsonResponse({schema: userSchema}),
);
const pipelineUser: Promise<User> = fetchUserPipeline('/users/1');
void pipelineUser;

const fetchUserJsonBodyPipeline = pipeline(
	fetch,
	withJsonBody(),
	withHttpError(),
	withJsonResponse({schema: userSchema}),
);
const jsonBodyPipelineUser: Promise<User> = fetchUserJsonBodyPipeline('/users', {method: 'POST', body: {name: 'Alice'}});
// @ts-expect-error withJsonResponse with schema returns validated data, not a Response.
const jsonBodyPipelineUserResponse: Promise<Response> = fetchUserJsonBodyPipeline('/users', {method: 'POST', body: {name: 'Alice'}});
void jsonBodyPipelineUser;
void jsonBodyPipelineUserResponse;

const fetchUserJsonBodyRequestBuilderPipeline = pipeline(
	fetch,
	withTimeout(5000),
	withBaseUrl('https://api.example.com'),
	withSearchParameters({apiKey: 'token'}),
	withHeaders({authorization: 'Bearer token'}),
	withJsonBody(),
	withHttpError(),
	withJsonResponse({schema: userSchema}),
);
const jsonBodyRequestBuilderUser: Promise<User> = fetchUserJsonBodyRequestBuilderPipeline('/users', {method: 'POST', body: {name: 'Alice'}});
void jsonBodyRequestBuilderUser;

const fetchUserJsonBodyHooksPipeline = pipeline(
	fetch,
	withJsonBody(),
	withHooks(),
	withHttpError(),
	withJsonResponse({schema: userSchema}),
);
const jsonBodyHooksUser: Promise<User> = fetchUserJsonBodyHooksPipeline('/users', {method: 'POST', body: {name: 'Alice'}});
void jsonBodyHooksUser;

const fetchUserJsonBodyRetryPipeline = pipeline(
	fetch,
	withJsonBody(),
	withRetry({methods: ['POST']}),
	withTokenRefresh({refreshToken: () => 'token'}),
	withHttpError(),
	withJsonResponse({schema: userSchema}),
);
const jsonBodyRetryUser: Promise<User> = fetchUserJsonBodyRetryPipeline('/users', {method: 'POST', body: {name: 'Alice'}});
void jsonBodyRetryUser;

const fetchUserJsonBodyQueuedPipeline = pipeline(
	fetch,
	withJsonBody(),
	withRateLimit({requestsPerInterval: 10, interval: 1000}),
	withConcurrency({maxConcurrentRequests: 2}),
	withHttpError(),
	withJsonResponse({schema: userSchema}),
);
const jsonBodyQueuedUser: Promise<User> = fetchUserJsonBodyQueuedPipeline('/users', {method: 'POST', body: {name: 'Alice'}});
void jsonBodyQueuedUser;

const fetchUserJsonBodyStoragePipeline = pipeline(
	fetch,
	withJsonBody(),
	withDeduplication(),
	withCache({ttl: 1000}),
	withHttpError(),
	withJsonResponse({schema: userSchema}),
);
const jsonBodyStorageUser: Promise<User> = fetchUserJsonBodyStoragePipeline('/users', {method: 'POST', body: {name: 'Alice'}});
void jsonBodyStorageUser;

const fetchUserJsonBodyProgressPipeline = pipeline(
	fetch,
	withJsonBody(),
	withDownloadProgress(),
	withUploadProgress(),
	withHttpError(),
	withJsonResponse({schema: userSchema}),
);
const jsonBodyProgressUser: Promise<User> = fetchUserJsonBodyProgressPipeline('/users', {method: 'POST', body: {name: 'Alice'}});
void jsonBodyProgressUser;

// WithResponse
const responseTransform: ResponseTransform<string> = async response => response.text();

const fetchText = withResponse(responseTransform)(fetch);
const text: Promise<string> = fetchText('/api/text');
void text;
// @ts-expect-error withResponse does not widen request bodies by itself.
void fetchText('/api/text', {method: 'POST', body: {name: 'Alice'}});

const fetchStatus = withResponse(response => response.status)(fetch);
const status: Promise<number> = fetchStatus('/api/status');
void status;

const fetchEmptyJson = withResponse(async response => {
	if (response.status === 204 || response.status === 205) {
		return undefined;
	}

	return response.json();
})(fetch);
const emptyJson: Promise<unknown> = fetchEmptyJson('/api/empty');
void emptyJson;

const fetchTextPipeline = pipeline(
	fetch,
	withTimeout(5000),
	withHttpError(),
	withResponse(async response => response.text()),
);
const pipelineText: Promise<string> = fetchTextPipeline('/api/text');
void pipelineText;

const fetchTextJsonBodyPipeline = pipeline(
	fetch,
	withJsonBody(),
	withHttpError(),
	withResponse(async response => response.text()),
);
const jsonObjectBodyPipelineText: Promise<string> = fetchTextJsonBodyPipeline('/api/text', {method: 'POST', body: {name: 'Alice'}});
const jsonArrayBodyPipelineText: Promise<string> = fetchTextJsonBodyPipeline('/api/text', {method: 'POST', body: []});
void jsonObjectBodyPipelineText;
void jsonArrayBodyPipelineText;

// WithJsonResponse infers output type from schema types
type InferredOutput = StandardSchemaV1InferOutput<typeof userSchema>;
const _inferCheck: InferredOutput = {name: 'Alice', age: 30};
void _inferCheck;

// SchemaValidationError shape
const schemaError = new SchemaValidationError([{message: 'test'}], new Response());
const _errorName: 'SchemaValidationError' = schemaError.name;
const _errorCode: 'ERR_SCHEMA_VALIDATION' = schemaError.code;
const _errorIssues: readonly StandardSchemaV1Issue[] = schemaError.issues;
const _errorResponse: Response = schemaError.response;
void _errorName;
void _errorCode;
void _errorIssues;
void _errorResponse;
