# Performance notes

## NFR-12 targets (T2.3, [Assumption])

| Operation | Target | Measured |
|---|---|---|
| Load a 500-line requirement | ≤ 4 s | Not yet measured on the demo |
| Save 500 changed lines (batch RPC) | ≤ 5 s | Not yet measured on the demo |

The grid keeps edits in a client-side dirty set and saves them through a single
call to `app.upsert_requirement_lines(requirement_id, jsonb)`, which runs in one
transaction and returns row-level errors. The desktop table body is windowed
(only the visible rows plus a small overscan are rendered), so row count does
not determine DOM size.

## How to measure

1. Apply the Phase 2 migrations and seed the masters.
2. Create a requirement and paste `tests/fixtures/lines-500.tsv` (synthetic).
3. Use the browser performance panel or:

   ```bash
   npx playwright test --grep "500"
   ```

Record the two numbers above on the deployed demo before claiming the target is
met. Until then the table above stays "not yet measured" rather than showing a
guessed figure.
