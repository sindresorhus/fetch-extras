# `withUploadProgress(fetchFunction, options?)`

Wraps a fetch function with upload progress tracking.

Upload progress is best-effort and only supported when the effective request body is an explicit `ReadableStream` provided in `init.body`. Other body types are passed through unchanged so `fetch` keeps its native body handling and content-type inference. Streaming request bodies still require support for `duplex: 'half'` in the runtime.

## Parameters

- `fetchFunction` (`typeof fetch`) - The fetch function to wrap (usually the global `fetch`).
- `options` (optional)
	- `onProgress` (`(progress: Progress) => void`) - Called as streamed request data is sent.

## Returns

A wrapped fetch function that reports upload progress for explicit streamed bodies.

## Progress

The `Progress` object has the following properties:

- `percent` (`number`) - A number between 0 and 1 representing the transfer completion.
- `transferredBytes` (`number`) - The number of bytes transferred so far.
- `totalBytes` (`number`) - The total number of bytes expected. For streamed uploads this starts unknown and adapts to the running total, reaching the true total at completion.

## Example

```js
import {withUploadProgress} from 'fetch-extras';

const fetchWithUploadProgress = withUploadProgress(fetch, {
	onProgress(progress) {
		console.log(`Upload: ${Math.round(progress.percent * 100)}%`);
	},
});

await fetchWithUploadProgress('https://example.com/upload', {
	method: 'POST',
	body: largeBlob.stream(),
	duplex: 'half',
});
```
