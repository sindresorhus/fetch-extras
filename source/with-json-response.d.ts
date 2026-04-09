// Standard Schema types (inlined from https://standardschema.dev)

export type StandardSchemaV1Issue = {
	readonly message: string;
	readonly path?: ReadonlyArray<PropertyKey | {readonly key: PropertyKey}> | undefined;
};

type StandardSchemaV1SuccessResult<OutputType> = {
	readonly value: OutputType;
	readonly issues?: undefined;
};

type StandardSchemaV1FailureResult = {
	readonly issues: readonly StandardSchemaV1Issue[];
	readonly value?: undefined;
};

type StandardSchemaV1Result<OutputType> = StandardSchemaV1SuccessResult<OutputType> | StandardSchemaV1FailureResult;

type StandardSchemaV1Types<InputType, OutputType> = {
	readonly input: InputType;
	readonly output: OutputType;
};

type StandardSchemaV1Options = {
	readonly libraryOptions?: Readonly<Record<string, unknown>> | undefined;
};

export type StandardSchemaV1<InputType = unknown, OutputType = InputType> = {
	readonly '~standard': {
		readonly version: 1;
		readonly vendor: string;
		readonly validate: (
			value: unknown,
			options?: StandardSchemaV1Options,
		) => StandardSchemaV1Result<OutputType> | Promise<StandardSchemaV1Result<OutputType>>;
		readonly types?: StandardSchemaV1Types<InputType, OutputType> | undefined;
	};
};

/* eslint-disable @typescript-eslint/indent */
export type StandardSchemaV1InferOutput<Schema extends StandardSchemaV1> = Schema['~standard'] extends {
	readonly types: StandardSchemaV1Types<unknown, infer OutputType>;
}
	? OutputType
	: Extract<
		Awaited<ReturnType<Schema['~standard']['validate']>>,
		StandardSchemaV1SuccessResult<unknown>
	> extends StandardSchemaV1SuccessResult<infer OutputType>
		? OutputType
		: unknown;
/* eslint-enable @typescript-eslint/indent */

/**
Custom error class thrown when [Standard Schema](https://standardschema.dev) validation fails in {@link withJsonResponse}. It has an `issues` property with the validation issues from the schema and a `response` property with the original `Response` object.

This error represents a schema rejection, not an HTTP failure. The request succeeded, but the response data did not match the expected schema.

@example
```
import {withJsonResponse, SchemaValidationError} from 'fetch-extras';
import {z} from 'zod';

const userSchema = z.object({name: z.string()});
const fetchUser = withJsonResponse(fetch, {schema: userSchema});

try {
	const user = await fetchUser('/api/user');
	console.log(user.name);
} catch (error) {
	if (error instanceof SchemaValidationError) {
		console.error(error.issues);
		console.log(error.response.status);
	}
}
```
*/
export class SchemaValidationError extends Error {
	readonly name: 'SchemaValidationError';
	readonly code: 'ERR_SCHEMA_VALIDATION';

	/**
	The validation issues from the Standard Schema validator.
	*/
	readonly issues: readonly StandardSchemaV1Issue[];

	/**
	The original `Response` object. Note that the body has already been consumed for JSON parsing.
	*/
	readonly response: Response;

	constructor(issues: readonly StandardSchemaV1Issue[], response: Response);
}

/**
Wraps a fetch function to automatically parse response bodies as JSON. Optionally validates the parsed JSON against a [Standard Schema](https://standardschema.dev).

Unlike other wrappers, this one returns parsed data instead of a `Response`, so it should be placed last in a [`pipeline`](pipeline.md).

Empty responses are not special-cased. If the response body is empty, including `204`, `205`, or `HEAD` responses, this wrapper throws the same `SyntaxError` as `Response.json()`. This is intentional: returning `null` would widen every call site's return type to `T | null`, forcing unnecessary null-checks. If your endpoint can return empty responses, handle that before this wrapper in the pipeline.

@param fetchFunction - The fetch function to wrap (usually the global `fetch`).
@returns A wrapped fetch function that returns the parsed JSON data.
@throws {SyntaxError} When the response body is empty or is not valid JSON.

@example
```
import {withJsonResponse} from 'fetch-extras';

const fetchJson = withJsonResponse(fetch);
const data = await fetchJson('/api/user/1');

console.log(data.name);
```

@example
```
import {pipeline, withHttpError, withTimeout, withJsonResponse} from 'fetch-extras';

const fetchJson = pipeline(
	fetch,
	f => withTimeout(f, 5000),
	withHttpError,
	withJsonResponse,
);

const data = await fetchJson('/api/user/1');
```
*/
export function withJsonResponse<FetchFunction extends typeof fetch>(
	fetchFunction: FetchFunction,
): (...arguments_: Parameters<FetchFunction>) => Promise<unknown>;

/**
Wraps a fetch function to automatically parse response bodies as JSON and validate against a [Standard Schema](https://standardschema.dev).

Use a Standard Schema compatible validator such as [Zod](https://zod.dev) (v3.24+), [Valibot](https://valibot.dev), or [ArkType](https://arktype.io).

Unlike other wrappers, this one returns validated data instead of a `Response`, so it should be placed last in a [`pipeline`](pipeline.md).

Empty responses are not special-cased. If the response body is empty, including `204`, `205`, or `HEAD` responses, this wrapper throws the same `SyntaxError` as `Response.json()`. This is intentional: returning `null` would widen every call site's return type to `T | null`, forcing unnecessary null-checks. If your endpoint can return empty responses, handle that before this wrapper in the pipeline.

@param fetchFunction - The fetch function to wrap (usually the global `fetch`).
@param options - Options object.
@param options.schema - A Standard Schema object to validate response JSON against.
@returns A wrapped fetch function that returns the validated data.
@throws {SyntaxError} When the response body is empty or is not valid JSON.
@throws {SchemaValidationError} When the response JSON does not match the schema.

@example
```
import {withJsonResponse} from 'fetch-extras';
import {z} from 'zod';

const userSchema = z.object({name: z.string(), age: z.number()});

const fetchUser = withJsonResponse(fetch, {schema: userSchema});
const user = await fetchUser('/api/user/1');

console.log(user.name);
```

@example
```
import {pipeline, withHttpError, withTimeout, withJsonResponse} from 'fetch-extras';
import {z} from 'zod';

const userSchema = z.object({name: z.string()});

const fetchUser = pipeline(
	fetch,
	f => withTimeout(f, 5000),
	withHttpError,
	f => withJsonResponse(f, {schema: userSchema}),
);

const user = await fetchUser('/api/user/1');
```
*/
export function withJsonResponse<
	FetchFunction extends typeof fetch,
	Schema extends StandardSchemaV1 | undefined = undefined,
>(
	fetchFunction: FetchFunction,
	options?: {schema?: Schema},
): (...arguments_: Parameters<FetchFunction>) => Promise<Schema extends StandardSchemaV1 ? StandardSchemaV1InferOutput<Schema> : unknown>;
