/**
Pagination options for customizing how pagination works.
*/
export type PaginationOptions<ItemType = unknown> = {
	/**
	Transform the response into an array of items.

	By default, it calls `response.json()` and expects an array.

	@param response - The Response object from the fetch request.
	@returns An array of items to yield, or a Promise that resolves to an array.

	@example
	```
	import {paginate} from 'fetch-extras';

	const items = await paginate.all('https://api.example.com/users', {
		pagination: {
			transform: async response => {
				const data = await response.json();
				return data.users; // Extract items from nested property
			}
		}
	});
	```
	*/
	transform?: (response: Response) => ItemType[] | Promise<ItemType[]>;

	/**
	Determine the next page to fetch.

	Return an object with fetch options for the next request, or `false` to stop pagination.

	By default, it parses the `Link` header and follows the `rel="next"` link.

	**Important**: The response body has already been consumed by the `transform` function. Do NOT call `response.json()` or other body methods here. Instead, extract pagination info from headers, the URL, or share data from the transform function through closure.

	**Note**: Returning `headers` replaces all inherited headers, consistent with standard Fetch API behavior. When the next page crosses to a different origin, inherited request headers are already cleared before your returned headers are applied. Setting `body` to `undefined` will strip body-related headers (`Content-Type`, `Content-Length`, etc.) from the request.

	@param data - Context object with response, current URL, and items.
	@returns Options for the next fetch request, or `false` to stop pagination.

	@example
	```
	import {paginate} from 'fetch-extras';

	// Cursor-based pagination using headers (recommended)
	for await (const item of paginate('https://api.example.com/items', {
		pagination: {
			paginate: ({response}) => {
				const nextCursor = response.headers.get('X-Next-Cursor');
				if (!nextCursor) return false;

				return {
					url: new URL(`https://api.example.com/items?cursor=${nextCursor}`)
				};
			}
		}
	})) {
		console.log(item);
	}
	```

	@example
	```
	import {paginate} from 'fetch-extras';

	// Sharing data between transform and paginate via closure
	let nextCursor;
	for await (const item of paginate('https://api.example.com/items', {
		pagination: {
			transform: async (response) => {
				const data = await response.json();
				// Store pagination info in closure
				nextCursor = data.nextCursor;
				return data.items;
			},
			paginate: () => {
				if (!nextCursor) return false;
				return {
					url: new URL(`https://api.example.com/items?cursor=${nextCursor}`)
				};
			}
		}
	})) {
		console.log(item);
	}
	```
	*/
	paginate?: (data: {
		response: Response;
		currentUrl: URL | string;
		currentItems: ItemType[];
		allItems: ItemType[];
	}) => PaginationNextPage | false | Promise<PaginationNextPage | false>;

	/**
	Filter items before yielding them.

	@param data - Context object with the current item and item arrays.
	@returns `true` to yield the item, `false` to skip it.

	@example
	```
	import {paginate} from 'fetch-extras';

	// Only get active users
	for await (const user of paginate('https://api.example.com/users', {
		pagination: {
			filter: ({item}) => item.status === 'active'
		}
	})) {
		console.log(user);
	}
	```
	*/
	filter?: (data: {
		item: ItemType;
		currentItems: ItemType[];
		allItems: ItemType[];
	}) => boolean;

	/**
	Check if pagination should continue after yielding an item.

	This is called after `filter` returns `true`. Useful for stopping pagination based on item values.

	@param data - Context object with the current item and item arrays.
	@returns `true` to continue pagination, `false` to stop.

	@example
	```
	import {paginate} from 'fetch-extras';

	// Stop when we reach items older than one week
	const oneWeekAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
	for await (const commit of paginate('https://api.github.com/repos/user/repo/commits', {
		pagination: {
			shouldContinue: ({item}) => new Date(item.date).getTime() >= oneWeekAgo
		}
	})) {
		console.log(commit);
	}
	```
	*/
	shouldContinue?: (data: {
		item: ItemType;
		currentItems: ItemType[];
		allItems: ItemType[];
	}) => boolean;

	/**
	Maximum number of items to yield.

	@default Infinity
	*/
	countLimit?: number;

	/**
	Delay in milliseconds between requests.

	Useful for rate limiting.

	@default 0
	*/
	backoff?: number;

	/**
	Maximum number of requests to make.

	This prevents infinite loops if your `paginate` function has bugs. Ensure your `paginate` function eventually returns `false` or the iteration will continue until this limit is reached.

	@default 10000
	*/
	requestLimit?: number;

	/**
	Whether to keep all yielded items in memory.

	When `true`, the `allItems` array passed to callbacks will contain all previously yielded items. When `false` (default), `allItems` will always be empty to save memory.

	@default false
	*/
	stackAllItems?: boolean;
};

/**
Options for the next page request.
*/
export type PaginationNextPage = {
	/**
	URL for the next page.

	Must be a URL instance, not a string.
	*/
	url?: URL;
} & RequestInit;

/**
A function with the same signature as the global `fetch`.

This allows you to use a custom fetch implementation, such as [`ky`](https://github.com/sindresorhus/ky).
*/
export type FetchFunction = (input: RequestInfo | URL, init?: any) => Promise<Response>;

/**
Options for the `paginate` function.
*/
export type PaginateOptions<ItemType = unknown> = RequestInit & {
	/**
	Pagination-specific options.
	*/
	pagination?: PaginationOptions<ItemType>;

	/**
	Custom fetch function to use for requests.

	This allows you to use a custom fetch implementation, such as [`ky`](https://github.com/sindresorhus/ky), or a fetch function wrapped with `withHttpError` or `withTimeout`.

	@default globalThis.fetch

	@example
	```
	import {paginate} from 'fetch-extras';
	import ky from 'ky';

	const url = 'https://api.github.com/repos/sindresorhus/ky/commits';

	for await (const commit of paginate(url, {fetchFunction: ky})) {
		console.log(commit.sha);
	}
	```
	*/
	fetchFunction?: FetchFunction;
};

/**
Paginate through API responses using async iteration.

By default, it automatically follows RFC 5988 `Link` headers with `rel="next"`.

**Note**: This function does not check response status codes. If you need error handling for non-2xx responses, wrap fetch with `withHttpError()` or handle errors in your `transform` function.

**Important**: When pagination crosses to a different origin, inherited request headers are cleared before the next request is built. If you intentionally need headers on the new origin, return them explicitly from `pagination.paginate`.

@param input - The URL to fetch. Can be a string or URL instance.
@param options - Fetch options plus pagination options.
@returns An async iterator that yields items from each page.

@example
```
import {paginate} from 'fetch-extras';

// Basic usage with Link headers (GitHub API)
for await (const commit of paginate('https://api.github.com/repos/sindresorhus/ky/commits')) {
	console.log(commit.sha);
}
```

@example
```
import {paginate} from 'fetch-extras';

// With error handling for non-2xx responses
for await (const item of paginate('https://api.example.com/items', {
	pagination: {
		transform: async (response) => {
			if (!response.ok) {
				throw new Error(`HTTP ${response.status}`);
			}
			return response.json();
		},
		countLimit: 100,
		backoff: 1000
	}
})) {
	console.log(item);
}
```

@example
```
import {paginate} from 'fetch-extras';

// Cursor-based pagination using headers
for await (const item of paginate('https://api.example.com/items', {
	pagination: {
		transform: async response => {
			const data = await response.json();
			return data.items;
		},
		paginate: ({response}) => {
			const cursor = response.headers.get('X-Next-Cursor');
			return cursor
				? {url: new URL(`https://api.example.com/items?cursor=${cursor}`)}
				: false;
		}
	}
})) {
	console.log(item);
}
```
*/
export function paginate<ItemType = unknown>(
	input: RequestInfo | URL,
	options?: PaginateOptions<ItemType>
): AsyncIterableIterator<ItemType>;

export namespace paginate {
	/**
	Get all paginated items as an array.

	This is a convenience method that collects all items into memory. For large datasets, prefer using the async iterator directly.

	@param input - The URL to fetch. Can be a string or URL instance.
	@param options - Fetch options plus pagination options.
	@returns A promise that resolves to an array of all items.

	@example
	```
	import {paginate} from 'fetch-extras';

	const commits = await paginate.all('https://api.github.com/repos/sindresorhus/ky/commits', {
		pagination: {
			countLimit: 50
		}
	});
	console.log(`Fetched ${commits.length} commits`);
	```
	*/
	export function all<ItemType = unknown>(
		input: RequestInfo | URL,
		options?: PaginateOptions<ItemType>
	): Promise<ItemType[]>;
}
