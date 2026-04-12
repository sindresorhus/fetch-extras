export function pipeline(value, ...functions) {
	for (const function_ of functions) {
		value = function_(value);
	}

	return value;
}
