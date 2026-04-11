import {
	pipeline,
	withTimeout,
	withBaseUrl,
	withHeaders,
	withHttpError,
} from './source/index.js';

const apiFetch = pipeline(
	fetch,
	withTimeout(5000),
	withBaseUrl('https://httpbun.com'),
	withHeaders({Authorization: 'Bearer token'}),
	withHttpError(),
);

// GET request - returns the headers we sent
const response = await apiFetch('/headers');
const data = await response.json();
console.log('GET /headers:', JSON.stringify(data, undefined, 2));

// POST request - echoes back the JSON body
const response2 = await apiFetch('/post', {
	method: 'POST',
	body: JSON.stringify({name: 'Alice', age: 30}),
	headers: {'Content-Type': 'application/json'},
});
const data2 = await response2.json();
console.log('\nPOST /post body echoed back:', data2.json);
