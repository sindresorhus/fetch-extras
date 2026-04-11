# withRateLimit

## withRateLimit(options)

Wraps a fetch function with client-side rate limiting. Requests that would exceed the limit are queued and delayed until a slot becomes available in the sliding window.

## Parameters

- `options` (`object`)
  - `requestsPerInterval` (`number`) - Maximum number of requests allowed within the interval.
  - `interval` (`number`) - The sliding window duration in milliseconds.

## Returns

A function that takes a fetch function and returns a wrapped fetch function that enforces the rate limit.

> [!NOTE]
> The rate limit state is shared across all calls to the returned function. To rate-limit different hosts independently, create separate `withRateLimit` wrappers.

> [!NOTE]
> Abort signals are respected while waiting: if the signal fires before a slot opens, the call rejects with the signal's abort reason and does not consume a rate limit slot.

## Example

```js
import {withRateLimit} from 'fetch-extras';

// Allow at most 10 requests per second
const rateLimitedFetch = withRateLimit({
	requestsPerInterval: 10,
	interval: 1000,
})(fetch);

const response = await rateLimitedFetch('/api/data');
const data = await response.json();
```

Can be combined with other `with*` functions:

```js
import {pipeline, withHttpError, withRateLimit, withBaseUrl} from 'fetch-extras';

const apiFetch = pipeline(
	fetch,
	withBaseUrl('https://api.example.com'),
	withRateLimit({requestsPerInterval: 10, interval: 1000}),
	withHttpError(),
);

const response = await apiFetch('/users');
```
