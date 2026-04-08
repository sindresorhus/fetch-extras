# SchemaValidationError

Custom error class thrown when [Standard Schema](https://standardschema.dev) validation fails in [`withJsonResponse`](with-json-response.md). It has an `issues` property with the validation issues from the schema and a `response` property with the original `Response` object.

This error represents a schema rejection, not an HTTP failure. The request succeeded, but the response data did not match the expected schema.

### Properties

- `name` (`'SchemaValidationError'`)
- `code` (`'ERR_SCHEMA_VALIDATION'`)
- `issues` (`StandardSchemaV1Issue[]`) - The validation issues from the schema.
- `response` (`Response`) - The original `Response` object. The body has already been consumed for JSON parsing.

### Example

```js
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
