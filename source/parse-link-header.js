const tokenPattern = /^[!#$%&'*+.^`|~\w-]+$/;

function splitHeaderValue(value, separator) {
	const parts = [];
	let startIndex = 0;
	let insideQuotes;
	let isEscaped = false;
	let insideUrl = false;

	for (let index = 0; index < value.length; index++) {
		const character = value[index];

		// RFC 8288 treats the URI reference inside `<...>` as opaque for parameter parsing.
		if (insideUrl) {
			if (character === '>') {
				insideUrl = false;
			}

			continue;
		}

		if (insideQuotes) {
			if (isEscaped) {
				isEscaped = false;
				continue;
			}

			if (character === '\\') {
				isEscaped = true;
				continue;
			}

			if (character === insideQuotes) {
				insideQuotes = undefined;
			}

			continue;
		}

		if (character === '"') {
			insideQuotes = character;
			continue;
		}

		if (character === '<') {
			insideUrl = true;
			continue;
		}

		if (character === separator) {
			parts.push(value.slice(startIndex, index));
			startIndex = index + 1;
		}
	}

	if (insideUrl || insideQuotes || isEscaped) {
		throw new Error('Invalid Link header format');
	}

	parts.push(value.slice(startIndex));

	return parts;
}

/**
Parses an RFC 5988 Link header into an array of link objects.

@param {string} linkHeader - The Link header value.
@returns {Array<{url: string, parameters: Object}>} Parsed links with normalized parameter values.
@throws {Error} If the Link header format is invalid.
*/
export default function parseLinkHeader(linkHeader) {
	const links = [];
	const parts = splitHeaderValue(linkHeader, ',');

	for (const part of parts) {
		const [rawUrlReference, ...rawLinkParameters] = splitHeaderValue(part, ';');
		const trimmedUrlReference = rawUrlReference.trim();

		if (trimmedUrlReference[0] !== '<' || !trimmedUrlReference.endsWith('>')) {
			throw new Error(`Invalid Link header format: ${trimmedUrlReference}`);
		}

		const url = trimmedUrlReference.slice(1, -1);
		const parameters = {};

		for (const parameter of rawLinkParameters) {
			const trimmedParameter = parameter.trim();

			if (!trimmedParameter) {
				continue;
			}

			const equalIndex = trimmedParameter.indexOf('=');
			let name;
			let value;

			if (equalIndex === -1) {
				name = trimmedParameter.toLowerCase();
				value = '';
			} else {
				name = trimmedParameter.slice(0, equalIndex).trim().toLowerCase();
				value = trimmedParameter.slice(equalIndex + 1).trim();
			}

			if (!tokenPattern.test(name)) {
				throw new Error(`Invalid Link header format: ${trimmedParameter}`);
			}

			if (value.startsWith('"') && value.endsWith('"')) {
				value = value.slice(1, -1).replaceAll(/\\(.)/g, '$1');
			} else if (value !== '' && !tokenPattern.test(value)) {
				throw new Error(`Invalid Link header format: ${trimmedParameter}`);
			}

			if (name in parameters) {
				continue;
			}

			parameters[name] = value;
		}

		links.push({url, parameters});
	}

	return links;
}
