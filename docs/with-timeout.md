# withTimeout

## withTimeout(fetchFunction, timeout)

Returns a wrapped fetch function with timeout functionality.

```js
import {withTimeout} from 'fetch-extras';

const fetchWithTimeout = withTimeout(fetch, 5000);
const response = await fetchWithTimeout('/api');
```
