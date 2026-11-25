# cs2-demo-skins

This tool changes paint kit, seed, wear, and StatTrak on weapons inside a CS2 `.dem` file. It does not change `m_iItemDefinitionIndex`, so the weapon stays the weapon.

`cs2-demo-skins` is a command-line tool and a small library. The binary is `cs2skin`. It is not a web app. Playback still depends on the demo's own serializers. Counter-Strike and the demo format belong to Valve. This project is not endorsed by Valve.

## Install

```bash
npm install cs2-demo-skins
```

## Commands

```bash
npx cs2skin inspect match.dem
npx cs2skin strip match.dem -o vanilla.dem
npx cs2skin set match.dem -o out.dem --player "player" --paint howl --weapon ak-47 --from 1:23 --to 2:10
npx cs2skin apply match.dem -o out.dem --script changes.json
```

`inspect` prints the map, players, and sampled weapon skins (`--json` for JSON). `strip` sets paint, seed, wear, and StatTrak to vanilla: paint `0`, seed `0`, wear `0`, StatTrak `-1`. `set` applies one paint to one player. `apply` runs a JSON script of those operations. See [examples](docs/EXAMPLES.md).

Writes require `-o`. The input path is never overwritten. `--player` is a case-insensitive name substring or an exact Steam64 id. Several matching names is an error. `--weapon` only filters which weapon is edited. It is never written. Paint `0` clears a skin. `--stattrak -1` clears StatTrak. `--stickers` on `strip` tries to zero sticker values and warns if the layout is not obvious.

`cs2skin weapons` and `cs2skin paints [--search text] [--weapon ak47]` list the catalog. A numeric paint id is accepted even when the catalog has no name for it.

## Time

Times are measured on the demo clock:

- `#12345` or `tick:12345` is an absolute demo tick.
- `1:23` or `1:23.5` is minutes and seconds from the first demo tick.
- `90` or `90s` is seconds from the first demo tick.

Seconds are converted with the demo's tick interval (server info, or `1/64` if that message is missing) and rounded to the nearest tick. Omit `--from` or `--to` to leave that side open. A timed `set` writes the previous cosmetics back at the first update at or after the end, so the skin does not remain for the rest of the file.

## Dry run

`--dry-run` prints the report and does not write a file. Changes are still listed. A dry run with zero changes exits 0. Warnings go to stderr. The process exits 1 if the player is missing, the player name is ambiguous, or a write would change a weapon definition index.

## Decode failures

A demo this tool cannot decode is reported and left untouched. It is not silently rewritten or corrupted. After a successful encode, every weapon definition index in the output is compared with the input. If any index differs, the bytes are discarded.

Protected item fields keep their original bits: `m_iItemDefinitionIndex`, `m_iItemID`, `m_iItemIDHigh`, `m_iItemIDLow`, and `m_iAccountID`. Only `m_nFallbackPaintKit`, `m_nFallbackSeed`, `m_flFallbackWear`, and `m_nFallbackStatTrak` may change.

## More

- [Architecture](docs/ARCHITECTURE.md) covers PBDEMS2 framing, cosmetic re-encoding, baselines, and the definition-index check.
- [Examples](docs/EXAMPLES.md) walks through the JSON scripts in `examples/`.

## License

[MIT](LICENSE).
