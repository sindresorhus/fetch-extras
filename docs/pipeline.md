# pipeline

## pipeline(value, ...functions)

Pipes a value through a series of functions, left to right. This is a convenience for composing `with*` functions without deep nesting.

For `with*` wrappers, that left-to-right `pipeline()` order is the canonical documented order throughout this package. The resulting runtime wrapper nesting is the inverse of that order.

## Parameters

- `value` - The initial value to pipe through.
- `functions` - Functions to apply in order. Each function receives the previous function's return value and may return a different type.

## Returns

The result of applying all functions.

## Example

```js
import {pipeline, withBaseUrl, withHeaders, withHttpError, withTimeout} from 'fetch-extras';

const apiFetch = pipeline(
	fetch,
	f => withTimeout(f, 5000),
	f => withBaseUrl(f, 'https://api.example.com'),
	f => withHeaders(f, {Authorization: 'Bearer token'}),
	withHttpError,
);

const response = await apiFetch('/users');
const data = await response.json();
```

Equivalent nested form:

```js
const apiFetch = withHttpError(
	withHeaders(
		withBaseUrl(
			withTimeout(fetch, 5000),
			'https://api.example.com',
		),
		{Authorization: 'Bearer token'},
	),
);
```

Without `pipeline()`, the same composition would need nested `with*` calls.
