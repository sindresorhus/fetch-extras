import type {Progress} from './with-download-progress.js';

/**
Wraps a fetch function with upload progress tracking.

Upload progress is best-effort and only supported when the effective request body is an explicit `ReadableStream` provided in `init.body`. Other body types are passed through unchanged so `fetch` keeps its native body handling and content-type inference. Streaming request bodies still require support for `duplex: 'half'` in the runtime.

@param fetchFunction - The fetch function to wrap (usually the global `fetch`).
@param options - Upload progress callback options.
@returns A wrapped fetch function that reports upload progress for explicit streamed bodies.

@example
```
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
*/
export function withUploadProgress(
	fetchFunction: typeof fetch,
	options?: {
		onProgress?: (progress: Progress) => void;
	}
): typeof fetch;
