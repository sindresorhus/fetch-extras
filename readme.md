# fetch-extras

> Useful utilities for working with [Fetch](https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API)

> [!WARNING]
> This package is still a work in progress.

For more features and conveniences on top of Fetch, check out my [`ky`](https://github.com/sindresorhus/ky) package.

## Install

```sh
npm install fetch-extras
```

## Usage

```js
import {throwIfHttpError} from 'fetch-extras';

const response = await throwIfHttpError(fetch('/api'));
```

## API

See the [types](index.d.ts) for now.

## Related

- [is-network-error](https://github.com/sindresorhus/is-network-error) - Check if a value is a Fetch network error
