# pipeline

## pipeline(value, ...functions)

Pipes a value through a series of functions, left to right. This is a convenience for composing `with*` functions without deep nesting.

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

Without `pipeline()`, the same composition would need nested `with*` calls.
