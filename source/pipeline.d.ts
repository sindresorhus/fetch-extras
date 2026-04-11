/**
Pipes a value through a series of functions, left to right.

This is a convenience for composing `with*` functions without deep nesting. Without `pipeline()`, the same composition would need nested `with*` calls.

For `with*` wrappers, that left-to-right `pipeline()` order is the canonical documented order throughout this package. The resulting runtime wrapper nesting is the inverse of that order.

You can write:

```
const apiFetch = pipeline(
	fetch,
	withTimeout(5000),
	withBaseUrl('https://api.example.com'),
	withHeaders({Authorization: 'Bearer token'}),
	withHttpError(),
);
```

Functions are applied left to right: the first function receives the initial value, the second receives the result of the first, and so on.

Equivalent nested form:

```
const apiFetch = withHttpError()(
	withHeaders({Authorization: 'Bearer token'})(
		withBaseUrl('https://api.example.com')(
			withTimeout(5000)(fetch),
		),
	),
);
```

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
	withTimeout(5000),
	withBaseUrl('https://api.example.com'),
	withHeaders({Authorization: 'Bearer token'}),
	withHttpError(),
);

const response = await apiFetch('/users');
const data = await response.json();
```
*/
// These overloads exist to preserve contextual typing for each stage.
// A shorter variadic generic signature would be nicer, but in practice it does not reliably
// infer callback parameter types for the documented pipeline(fetch, withTimeout(5000), withHttpError()) pattern.
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
export function pipeline<Value, Result1, Result2, Result3, Result4, Result5, Result6, Result7, Result8, Result9, Result10, Result11>(value: Value, function1: (value: Value) => Result1, function2: (value: Result1) => Result2, function3: (value: Result2) => Result3, function4: (value: Result3) => Result4, function5: (value: Result4) => Result5, function6: (value: Result5) => Result6, function7: (value: Result6) => Result7, function8: (value: Result7) => Result8, function9: (value: Result8) => Result9, function10: (value: Result9) => Result10, function11: (value: Result10) => Result11): Result11;
export function pipeline<Value, Result1, Result2, Result3, Result4, Result5, Result6, Result7, Result8, Result9, Result10, Result11, Result12>(value: Value, function1: (value: Value) => Result1, function2: (value: Result1) => Result2, function3: (value: Result2) => Result3, function4: (value: Result3) => Result4, function5: (value: Result4) => Result5, function6: (value: Result5) => Result6, function7: (value: Result6) => Result7, function8: (value: Result7) => Result8, function9: (value: Result8) => Result9, function10: (value: Result9) => Result10, function11: (value: Result10) => Result11, function12: (value: Result11) => Result12): Result12;
export function pipeline<Value, Result1, Result2, Result3, Result4, Result5, Result6, Result7, Result8, Result9, Result10, Result11, Result12, Result13>(value: Value, function1: (value: Value) => Result1, function2: (value: Result1) => Result2, function3: (value: Result2) => Result3, function4: (value: Result3) => Result4, function5: (value: Result4) => Result5, function6: (value: Result5) => Result6, function7: (value: Result6) => Result7, function8: (value: Result7) => Result8, function9: (value: Result8) => Result9, function10: (value: Result9) => Result10, function11: (value: Result10) => Result11, function12: (value: Result11) => Result12, function13: (value: Result12) => Result13): Result13;
export function pipeline<Value, Result1, Result2, Result3, Result4, Result5, Result6, Result7, Result8, Result9, Result10, Result11, Result12, Result13, Result14>(value: Value, function1: (value: Value) => Result1, function2: (value: Result1) => Result2, function3: (value: Result2) => Result3, function4: (value: Result3) => Result4, function5: (value: Result4) => Result5, function6: (value: Result5) => Result6, function7: (value: Result6) => Result7, function8: (value: Result7) => Result8, function9: (value: Result8) => Result9, function10: (value: Result9) => Result10, function11: (value: Result10) => Result11, function12: (value: Result11) => Result12, function13: (value: Result12) => Result13, function14: (value: Result13) => Result14): Result14;
export function pipeline<Value, Result1, Result2, Result3, Result4, Result5, Result6, Result7, Result8, Result9, Result10, Result11, Result12, Result13, Result14, Result15>(value: Value, function1: (value: Value) => Result1, function2: (value: Result1) => Result2, function3: (value: Result2) => Result3, function4: (value: Result3) => Result4, function5: (value: Result4) => Result5, function6: (value: Result5) => Result6, function7: (value: Result6) => Result7, function8: (value: Result7) => Result8, function9: (value: Result8) => Result9, function10: (value: Result9) => Result10, function11: (value: Result10) => Result11, function12: (value: Result11) => Result12, function13: (value: Result12) => Result13, function14: (value: Result13) => Result14, function15: (value: Result14) => Result15): Result15;
export function pipeline<Value, Result1, Result2, Result3, Result4, Result5, Result6, Result7, Result8, Result9, Result10, Result11, Result12, Result13, Result14, Result15, Result16>(value: Value, function1: (value: Value) => Result1, function2: (value: Result1) => Result2, function3: (value: Result2) => Result3, function4: (value: Result3) => Result4, function5: (value: Result4) => Result5, function6: (value: Result5) => Result6, function7: (value: Result6) => Result7, function8: (value: Result7) => Result8, function9: (value: Result8) => Result9, function10: (value: Result9) => Result10, function11: (value: Result10) => Result11, function12: (value: Result11) => Result12, function13: (value: Result12) => Result13, function14: (value: Result13) => Result14, function15: (value: Result14) => Result15, function16: (value: Result15) => Result16): Result16;
export function pipeline<Value, Result1, Result2, Result3, Result4, Result5, Result6, Result7, Result8, Result9, Result10, Result11, Result12, Result13, Result14, Result15, Result16, Result17>(value: Value, function1: (value: Value) => Result1, function2: (value: Result1) => Result2, function3: (value: Result2) => Result3, function4: (value: Result3) => Result4, function5: (value: Result4) => Result5, function6: (value: Result5) => Result6, function7: (value: Result6) => Result7, function8: (value: Result7) => Result8, function9: (value: Result8) => Result9, function10: (value: Result9) => Result10, function11: (value: Result10) => Result11, function12: (value: Result11) => Result12, function13: (value: Result12) => Result13, function14: (value: Result13) => Result14, function15: (value: Result14) => Result15, function16: (value: Result15) => Result16, function17: (value: Result16) => Result17): Result17;
export function pipeline<Value, Result1, Result2, Result3, Result4, Result5, Result6, Result7, Result8, Result9, Result10, Result11, Result12, Result13, Result14, Result15, Result16, Result17, Result18>(value: Value, function1: (value: Value) => Result1, function2: (value: Result1) => Result2, function3: (value: Result2) => Result3, function4: (value: Result3) => Result4, function5: (value: Result4) => Result5, function6: (value: Result5) => Result6, function7: (value: Result6) => Result7, function8: (value: Result7) => Result8, function9: (value: Result8) => Result9, function10: (value: Result9) => Result10, function11: (value: Result10) => Result11, function12: (value: Result11) => Result12, function13: (value: Result12) => Result13, function14: (value: Result13) => Result14, function15: (value: Result14) => Result15, function16: (value: Result15) => Result16, function17: (value: Result16) => Result17, function18: (value: Result17) => Result18): Result18;
export function pipeline<Value, Result1, Result2, Result3, Result4, Result5, Result6, Result7, Result8, Result9, Result10, Result11, Result12, Result13, Result14, Result15, Result16, Result17, Result18, Result19>(value: Value, function1: (value: Value) => Result1, function2: (value: Result1) => Result2, function3: (value: Result2) => Result3, function4: (value: Result3) => Result4, function5: (value: Result4) => Result5, function6: (value: Result5) => Result6, function7: (value: Result6) => Result7, function8: (value: Result7) => Result8, function9: (value: Result8) => Result9, function10: (value: Result9) => Result10, function11: (value: Result10) => Result11, function12: (value: Result11) => Result12, function13: (value: Result12) => Result13, function14: (value: Result13) => Result14, function15: (value: Result14) => Result15, function16: (value: Result15) => Result16, function17: (value: Result16) => Result17, function18: (value: Result17) => Result18, function19: (value: Result18) => Result19): Result19;
export function pipeline<Value, Result1, Result2, Result3, Result4, Result5, Result6, Result7, Result8, Result9, Result10, Result11, Result12, Result13, Result14, Result15, Result16, Result17, Result18, Result19, Result20>(value: Value, function1: (value: Value) => Result1, function2: (value: Result1) => Result2, function3: (value: Result2) => Result3, function4: (value: Result3) => Result4, function5: (value: Result4) => Result5, function6: (value: Result5) => Result6, function7: (value: Result6) => Result7, function8: (value: Result7) => Result8, function9: (value: Result8) => Result9, function10: (value: Result9) => Result10, function11: (value: Result10) => Result11, function12: (value: Result11) => Result12, function13: (value: Result12) => Result13, function14: (value: Result13) => Result14, function15: (value: Result14) => Result15, function16: (value: Result15) => Result16, function17: (value: Result16) => Result17, function18: (value: Result17) => Result18, function19: (value: Result18) => Result19, function20: (value: Result19) => Result20): Result20;
// Longer pipelines still work at runtime, so keep a permissive fallback instead of rejecting them.
// The tradeoff is that very long chains lose precise inference rather than failing to type-check.
export function pipeline(value: unknown, ...functions: Array<(value: any) => any>): any;
