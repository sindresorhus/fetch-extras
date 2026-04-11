# Project instructions

- The `docs/*.md` files and the corresponding `source/*.d.ts` doc comments must stay in sync (same descriptions, notes, caveats, and examples).
- When reviewing code, only flag issues that actually affect supported/documented usage. Do not flag theoretical problems with unsupported composition orders or hypothetical edge cases that the documented API already prevents.
- Keep exported `with*` TypeScript wrapper declarations simple and typed against plain `typeof fetch`. Do not preserve custom fetch-like generics unless there is a concrete supported use-case that requires it.

# Review guidance

- Treat wrapper order as part of the public contract.
- Only the documented `pipeline()` order is supported.
- `pipeline()` applies functions left to right, and that left-to-right argument order is the canonical documented order.
- Runtime wrapper nesting is the inverse of that `pipeline()` order.
- Example: `pipeline(fetch, withTimeout(5000), withHeaders(headers))` means `withHeaders(headers)(withTimeout(5000)(fetch))`.
- Manual nesting that changes that order is unsupported, even if it could work.
- Do not suggest metadata forwarding or compatibility fixes solely to preserve unsupported wrapper orders.
- When reviewing composition bugs, only treat them as actionable if they break the documented order or explicitly documented combinations.
- Prefer `WeakMap`/`WeakSet` for file-local hidden state instead of adding one-off `Symbol` properties. Keep symbols for shared cross-wrapper metadata only.
