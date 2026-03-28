# `withDownloadProgress(fetchFunction, options?)`

Wraps a fetch function with download progress tracking.

The original response metadata such as `url`, `type`, and `redirected` is preserved.

## Parameters

- `fetchFunction` (`typeof fetch`) - The fetch function to wrap (usually the global `fetch`).
- `options` (optional)
	- `onProgress` (`(progress: Progress) => void`) - Called as response data is received.

## Returns

A wrapped fetch function that reports download progress.

## Progress

The `Progress` object has the following properties:

- `percent` (`number`) - A number between 0 and 1 representing the transfer completion.
- `transferredBytes` (`number`) - The number of bytes transferred so far.
- `totalBytes` (`number`) - The total number of bytes expected. When the size is known upfront (e.g. a `content-length` header is present), this reflects the full expected size. When the size is unknown, this adapts to reflect the running total of bytes seen so far, reaching the true total at completion.

## Example

```js
import {withDownloadProgress} from 'fetch-extras';

const fetchWithDownloadProgress = withDownloadProgress(fetch, {
	onProgress(progress) {
		console.log(`Download: ${Math.round(progress.percent * 100)}%`);
	},
});

const response = await fetchWithDownloadProgress('https://example.com/large-file');
const data = await response.arrayBuffer();
```
