/**
Pipes a value through a series of functions, left to right.

@param {unknown} value - The initial value.
@param {...Function} functions - Functions to apply in order.
@returns {unknown} The result of applying all functions.
*/
export function pipeline(value, ...functions) {
	for (const function_ of functions) {
		value = function_(value);
	}

	return value;
}
