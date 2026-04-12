import {copyFetchMetadata, resolveRequestUrlSymbol} from './utilities.js';

const schemePattern = /^(?<scheme>[a-z][a-z\d+\-.]*:)/i;
const blockedSpecialSchemeShorthandSchemes = new Set(['http', 'https']);

export function withBaseUrl(baseUrl) {
	const baseUrlString = baseUrl instanceof URL ? baseUrl.href : baseUrl;

	return fetchFunction => {
		let baseUrlObject;

		const getBaseUrlObject = () => {
			if (!baseUrlObject) {
				try {
					baseUrlObject = new URL(baseUrlString);
				} catch (error) {
					throw new TypeError(`Invalid base URL: ${error.message}`);
				}
			}

			return baseUrlObject;
		};

		const shouldBypassBaseUrl = input => {
			const match = schemePattern.exec(input);
			if (!match) {
				return false;
			}

			return true;
		};

		const isUnsupportedSpecialSchemeShorthand = input => {
			const match = schemePattern.exec(input);
			if (!match) {
				return false;
			}

			const scheme = match.groups.scheme.slice(0, -1).toLowerCase();
			return blockedSpecialSchemeShorthandSchemes.has(scheme) && !input.startsWith(`${match[0]}//`);
		};

		const resolveRequestUrl = urlOrRequest => {
			if (urlOrRequest instanceof Request) {
				return urlOrRequest.url;
			}

			if (urlOrRequest instanceof URL) {
				return urlOrRequest.href;
			}

			if (typeof urlOrRequest !== 'string') {
				urlOrRequest = String(urlOrRequest);
			}

			if (isUnsupportedSpecialSchemeShorthand(urlOrRequest)) {
				/*
				Boundary: although fetch accepts `http:foo` / `https:foo` and normalizes them as absolute URLs, this wrapper intentionally does not support those shorthand forms.
				In a base-URL helper they are too easy to misread as ordinary explicit web URLs, so we keep the contract smaller and require `http://` / `https://` for pass-through absolute web inputs.
				*/
				throw new TypeError('Special-scheme URLs without `//` are unsupported.');
			}

			if (shouldBypassBaseUrl(urlOrRequest)) {
				/*
				Explicit absolute string inputs intentionally bypass base-URL joining.
				Do not "fix" this by rejecting cross-origin absolute URLs.
				*/
				return urlOrRequest;
			}

			if (urlOrRequest === '') {
				return new URL(urlOrRequest, getBaseUrlObject()).href;
			}

			if (/^\/\/[^/]/.test(urlOrRequest)) {
				throw new TypeError('Protocol-relative URLs are unsupported.');
			}

			if (/^[?#]/.test(urlOrRequest)) {
				return new URL(urlOrRequest, getBaseUrlObject()).href;
			}

			const baseUrlForPath = new URL(getBaseUrlObject());
			baseUrlForPath.search = '';
			baseUrlForPath.hash = '';

			if (!baseUrlForPath.pathname.endsWith('/')) {
				baseUrlForPath.pathname = `${baseUrlForPath.pathname}/`;
			}

			return new URL(urlOrRequest.replace(/^\/+/, ''), baseUrlForPath).href;
		};

		const fetchWithBaseUrl = async (urlOrRequest, options = {}) => {
			const resolvedRequestUrl = resolveRequestUrl(urlOrRequest);

			return fetchFunction(
				urlOrRequest instanceof Request || urlOrRequest instanceof URL
					? urlOrRequest
					: resolvedRequestUrl,
				options,
			);
		};

		fetchWithBaseUrl[resolveRequestUrlSymbol] = resolveRequestUrl;

		return copyFetchMetadata(fetchWithBaseUrl, fetchFunction);
	};
}
