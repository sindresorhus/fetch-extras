# Review guidance

- Treat wrapper order as part of the public contract.
- Only the documented `pipeline` order is supported.
- Manual nesting that changes that order is unsupported, even if it could work.
- Do not suggest metadata forwarding or compatibility fixes solely to preserve unsupported wrapper orders.
- When reviewing composition bugs, only treat them as actionable if they break the documented order or explicitly documented combinations.
- Prefer `WeakMap`/`WeakSet` for file-local hidden state instead of adding one-off `Symbol` properties. Keep symbols for shared cross-wrapper metadata only.
