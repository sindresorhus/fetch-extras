import test from 'ava';
import {pipeline} from '../source/index.js';

test('pipeline - returns value unchanged with no functions', t => {
	const value = {type: 'fetch'};
	t.is(pipeline(value), value);
});

test('pipeline - applies a single function', t => {
	const result = pipeline(1, x => x + 10);
	t.is(result, 11);
});

test('pipeline - applies multiple functions left to right', t => {
	const result = pipeline(
		'hello',
		s => s.toUpperCase(),
		s => `${s}!`,
	);
	t.is(result, 'HELLO!');
});

test('pipeline - applies functions in correct order', t => {
	const order = [];
	pipeline(
		0,
		x => {
			order.push('first');
			return x + 1;
		},
		x => {
			order.push('second');
			return x + 1;
		},
		x => {
			order.push('third');
			return x + 1;
		},
	);
	t.deepEqual(order, ['first', 'second', 'third']);
});

test('pipeline - works with fetch-like wrapper functions', t => {
	const mockFetch = url => ({url});

	const withPrefix = (fetchFunction, prefix) => url => fetchFunction(`${prefix}${url}`);
	const withSuffix = (fetchFunction, suffix) => url => fetchFunction(`${url}${suffix}`);

	const wrappedFetch = pipeline(
		mockFetch,
		f => withPrefix(f, 'https://api.example.com'),
		f => withSuffix(f, '?key=123'),
	);

	t.deepEqual(wrappedFetch('/users'), {url: 'https://api.example.com/users?key=123'});
});

test('pipeline - propagates falsy return values', t => {
	const result = pipeline('initial', () => undefined, x => x ?? 'fallback');
	t.is(result, 'fallback');
});
