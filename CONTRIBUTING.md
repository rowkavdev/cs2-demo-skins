# Contributing

Make small local commits. Do not commit `.dem` files. Demos do not belong in this repo, including as test fixtures. Scripts under `examples/` are JSON only.

Do not push if the GitHub account is unavailable. Leave the work in local commits.

Run the tests before you stop. Vitest is limited to one worker so a full run does not stack Node processes:

```bash
npm test
npm run cs2skin -- weapons
```

`npm test` runs Vitest over `test/**/*.test.ts`. `npm run build` is `tsc`. CI runs `npm ci`, `npm test`, and `npm run build` on Ubuntu with Node 22. Local Node is `>=20`.

## Weapon identity

The weapon-identity invariant is tested. A synthetic demo whose weapon has definition index 7 and paint 282 must still have index 7 after a `set` to paint 309, and the paint must be 309. `strip` must yield paint 0. A plan that would change the definition index must throw before any write. Do not write `m_iItemDefinitionIndex` or the other names in `PROTECTED_FIELD_NAMES` (`m_iItemID`, `m_iItemIDHigh`, `m_iItemIDLow`, `m_iAccountID`). Cosmetic edits are limited to paint kit, seed, wear, and StatTrak.

## Modules

Modules are split in [SPEC.md](SPEC.md): bits, protobuf, demo frames, field paths, values, entity deltas, the editor, the catalog, the CLI, and docs. Import shared names from `src/contract.ts`. Do not edit a file owned by another module. Keep a new helper inside your own files. Use ESM `.js` specifiers in TypeScript imports. Do not add a web app.
