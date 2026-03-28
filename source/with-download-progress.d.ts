/**
Progress information for a request or response.
*/
export type Progress = {
	/**
	A number between 0 and 1 representing the transfer completion.
	*/
	percent: number;

	/**
	The number of bytes transferred so far.
	*/
	transferredBytes: number;

	/**
	The total number of bytes expected. When the size is known upfront (e.g. a `content-length` header is present), this reflects the full expected size. When the size is unknown, this adapts to reflect the running total of bytes seen so far, reaching the true total at completion.
	*/
	totalBytes: number;
};

/**
Wraps a fetch function with download progress tracking.

The original response metadata such as `url`, `type`, and `redirected` is preserved.

@param fetchFunction - The fetch function to wrap (usually the global `fetch`).
@param options - Download progress callback options.
@returns A wrapped fetch function that reports download progress.

@example
```
import {withDownloadProgress} from 'fetch-extras';

const fetchWithDownloadProgress = withDownloadProgress(fetch, {
	onProgress(progress) {
		console.log(`Download: ${Math.round(progress.percent * 100)}%`);
	},
});

const response = await fetchWithDownloadProgress('https://example.com/large-file');
const data = await response.arrayBuffer();
```
*/
export function withDownloadProgress(
	fetchFunction: typeof fetch,
	options?: {
		onProgress?: (progress: Progress) => void;
	}
): typeof fetch;
