<h1 align="center" title="fetch-extras">
	<img src="media/logo.jpg" alt="fetch-extras logo">
</h1>

> Useful utilities for working with [Fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)

*For more features and conveniences on top of Fetch, check out my [`ky`](https://github.com/sindresorhus/ky) package.*

## Install

```sh
npm install fetch-extras
```

## Usage

```js
import {withHttpError, withTimeout} from 'fetch-extras';

// Create an enhanced reusable fetch function that:
// - Throws errors for non-200 responses
// - Times out after 5 seconds
const enhancedFetch = withHttpError(withTimeout(fetch, 5000));

const response = await enhancedFetch('/api');
const data = await response.json();
```

## API

See the [types](index.d.ts) for now.

## Related

- [is-network-error](https://github.com/sindresorhus/is-network-error) - Check if a value is a Fetch network error
- [ky](https://github.com/sindresorhus/ky) - HTTP client based on Fetch
