/**
Pipes a value through a series of functions, left to right.

This is a convenience for composing `with*` functions without deep nesting. Without `pipeline()`, the same composition would need nested `with*` calls.

You can write:

```
const apiFetch = pipeline(
	fetch,
	f => withTimeout(f, 5000),
	f => withBaseUrl(f, 'https://api.example.com'),
	f => withHeaders(f, {Authorization: 'Bearer token'}),
	withHttpError,
);
```

Functions are applied left to right: the first function receives the initial value, the second receives the result of the first, and so on.

@param value - The initial value to pipe through.
@param functions - Functions to apply in order. Each function receives the previous function's return value and may return a different type.
@returns The result of applying all functions.

@example
```
import {pipeline, withHttpError, withTimeout, withBaseUrl, withHeaders} from 'fetch-extras';

// Create a tiny reusable API client that:
// - Sends auth headers on every request
// - Uses a base URL so you only write paths
// - Throws errors for non-2xx responses
// - Times out after 5 seconds
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
*/
// These overloads exist to preserve contextual typing for each stage.
// A shorter variadic generic signature would be nicer, but in practice it does not reliably
// infer callback parameter types for the documented pipeline(fetch, f => ..., withHttpError) pattern.
export function pipeline<Value>(value: Value): Value;
export function pipeline<Value, Result1>(value: Value, function1: (value: Value) => Result1): Result1;
export function pipeline<Value, Result1, Result2>(value: Value, function1: (value: Value) => Result1, function2: (value: Result1) => Result2): Result2;
export function pipeline<Value, Result1, Result2, Result3>(value: Value, function1: (value: Value) => Result1, function2: (value: Result1) => Result2, function3: (value: Result2) => Result3): Result3;
export function pipeline<Value, Result1, Result2, Result3, Result4>(value: Value, function1: (value: Value) => Result1, function2: (value: Result1) => Result2, function3: (value: Result2) => Result3, function4: (value: Result3) => Result4): Result4;
export function pipeline<Value, Result1, Result2, Result3, Result4, Result5>(value: Value, function1: (value: Value) => Result1, function2: (value: Result1) => Result2, function3: (value: Result2) => Result3, function4: (value: Result3) => Result4, function5: (value: Result4) => Result5): Result5;
export function pipeline<Value, Result1, Result2, Result3, Result4, Result5, Result6>(value: Value, function1: (value: Value) => Result1, function2: (value: Result1) => Result2, function3: (value: Result2) => Result3, function4: (value: Result3) => Result4, function5: (value: Result4) => Result5, function6: (value: Result5) => Result6): Result6;
export function pipeline<Value, Result1, Result2, Result3, Result4, Result5, Result6, Result7>(value: Value, function1: (value: Value) => Result1, function2: (value: Result1) => Result2, function3: (value: Result2) => Result3, function4: (value: Result3) => Result4, function5: (value: Result4) => Result5, function6: (value: Result5) => Result6, function7: (value: Result6) => Result7): Result7;
export function pipeline<Value, Result1, Result2, Result3, Result4, Result5, Result6, Result7, Result8>(value: Value, function1: (value: Value) => Result1, function2: (value: Result1) => Result2, function3: (value: Result2) => Result3, function4: (value: Result3) => Result4, function5: (value: Result4) => Result5, function6: (value: Result5) => Result6, function7: (value: Result6) => Result7, function8: (value: Result7) => Result8): Result8;
export function pipeline<Value, Result1, Result2, Result3, Result4, Result5, Result6, Result7, Result8, Result9>(value: Value, function1: (value: Value) => Result1, function2: (value: Result1) => Result2, function3: (value: Result2) => Result3, function4: (value: Result3) => Result4, function5: (value: Result4) => Result5, function6: (value: Result5) => Result6, function7: (value: Result6) => Result7, function8: (value: Result7) => Result8, function9: (value: Result8) => Result9): Result9;
export function pipeline<Value, Result1, Result2, Result3, Result4, Result5, Result6, Result7, Result8, Result9, Result10>(value: Value, function1: (value: Value) => Result1, function2: (value: Result1) => Result2, function3: (value: Result2) => Result3, function4: (value: Result3) => Result4, function5: (value: Result4) => Result5, function6: (value: Result5) => Result6, function7: (value: Result6) => Result7, function8: (value: Result7) => Result8, function9: (value: Result8) => Result9, function10: (value: Result9) => Result10): Result10;
// Longer pipelines still work at runtime, so keep a permissive fallback instead of rejecting them.
// The tradeoff is that very long chains lose precise inference rather than failing to type-check.
export function pipeline(value: unknown, ...functions: Array<(value: any) => any>): any;
