export type ResponseTransform<Value> = (response: Response) => Value | Promise<Value>;

/**
Wraps a fetch function and transforms the final `Response` into any value.

This wrapper does not choose a parser or special-case empty responses. The transform receives the raw `Response`, so callers can decide how to handle JSON, text, bytes, `204`/`205`, or any custom response shape.

Unlike most wrappers, this can return something other than a `Response`, so it should be placed last in a [`pipeline`](pipeline.md). Use this instead of `withHooks({afterResponse})` when the wrapped fetch function should resolve to parsed or transformed data.

@param transform - Function that receives the final `Response` and returns the desired value.
@returns A wrapper that takes a fetch function and returns a wrapped fetch function that resolves with the transform result.

@example
```
import {withResponse} from 'fetch-extras';

const fetchJsonOrUndefined = withResponse(response => {
	if (response.status === 204 || response.status === 205) {
		return undefined;
	}

	return response.json();
})(fetch);

const data = await fetchJsonOrUndefined('/api/user');
```

@example
```
import {pipeline, withHttpError, withResponse} from 'fetch-extras';

const fetchText = pipeline(
	fetch,
	withHttpError(),
	withResponse(response => response.text()),
);

const text = await fetchText('/api/message');
```
*/
export function withResponse<Value>(
	transform: ResponseTransform<Value>,
): <FetchFunction extends typeof fetch>(
	fetchFunction: FetchFunction
) => (...arguments_: Parameters<FetchFunction>) => Promise<Awaited<Value>>;
