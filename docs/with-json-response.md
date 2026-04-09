# withJsonResponse

## withJsonResponse(fetchFunction, options?)

Wraps a fetch function to automatically parse response bodies as JSON. Optionally validates the parsed JSON against a [Standard Schema](https://standardschema.dev).

Use a Standard Schema compatible validator such as [Zod](https://zod.dev) (v3.24+), [Valibot](https://valibot.dev), or [ArkType](https://arktype.io).

Unlike other wrappers, this one returns parsed data instead of a `Response`, so it should be placed last in a [`pipeline`](pipeline.md).

Empty responses are not special-cased. If the response body is empty, including `204`, `205`, or `HEAD` responses, this wrapper throws the same `SyntaxError` as `Response.json()`. This is intentional: returning `null` would widen every call site's return type to `T | null`, forcing unnecessary null-checks. If your endpoint can return empty responses, handle that before this wrapper in the pipeline.

## Parameters

- `fetchFunction` (`typeof fetch`) - The fetch function to wrap (usually the global `fetch`).
- `options` (optional)
  - `schema` (`StandardSchemaV1`) - A Standard Schema object to validate response JSON against.

## Returns

A wrapped fetch function that returns the parsed JSON data (or validated data if a schema is provided) instead of a `Response`.

## Errors

Throws a [`SchemaValidationError`](schema-validation-error.md) if the response JSON does not match the provided schema.
Throws a `SyntaxError` if the response body is empty or is not valid JSON.

## Example

```js
import {withJsonResponse} from 'fetch-extras';

const fetchJson = withJsonResponse(fetch);
const data = await fetchJson('/api/user/1');

console.log(data.name);
```

With schema validation:

```js
import {withJsonResponse} from 'fetch-extras';
import {z} from 'zod';

const userSchema = z.object({name: z.string(), age: z.number()});

const fetchUser = withJsonResponse(fetch, {schema: userSchema});
const user = await fetchUser('/api/user/1');

console.log(user.name);
```

Can be combined with other `with*` functions (place last in the pipeline):

```js
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
