import {copyFetchMetadata} from './utilities.js';

export class SchemaValidationError extends Error {
	constructor(issues, response) {
		super('Response JSON validation failed');
		Error.captureStackTrace?.(this, this.constructor);

		this.name = 'SchemaValidationError';
		this.code = 'ERR_SCHEMA_VALIDATION';
		this.issues = issues;
		this.response = response;
	}
}

export function withJsonResponse({schema} = {}) {
	if (schema !== undefined && typeof schema?.['~standard']?.validate !== 'function') {
		throw new TypeError('The `schema` option must be a Standard Schema object (https://standardschema.dev)');
	}

	return fetchFunction => {
		const fetchWithJsonResponse = async (urlOrRequest, options = {}) => {
			const response = await fetchFunction(urlOrRequest, options);

			// Keep the contract strict: this wrapper means "parse JSON".
			// Empty 200/204/205/HEAD responses are therefore treated as not JSON and throw,
			// instead of widening every successful call site with a special-case empty value.
			const jsonValue = await response.json();

			if (!schema) {
				return jsonValue;
			}

			const result = await schema['~standard'].validate(jsonValue);

			if (result.issues) {
				throw new SchemaValidationError(result.issues, response);
			}

			return result.value;
		};

		return copyFetchMetadata(fetchWithJsonResponse, fetchFunction);
	};
}
