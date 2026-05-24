import {copyFetchMetadata} from './utilities.js';

export function withResponse(transform) {
	if (typeof transform !== 'function') {
		throw new TypeError('Expected a response transform function');
	}

	return fetchFunction => {
		const fetchWithResponse = async (urlOrRequest, options = {}) => {
			const response = await fetchFunction(urlOrRequest, options);
			return transform(response);
		};

		return copyFetchMetadata(fetchWithResponse, fetchFunction);
	};
}
