# cs2-demo-skins

This tool changes paint kit, seed, wear, and StatTrak on weapons inside a CS2 `.dem` file. It can also swap one knife for another knife, and write sticker kit ids into the gun's default sticker slots. It does not change a gun's `m_iItemDefinitionIndex`.

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
npx cs2skin knife match.dem -o out.dem --player "player" --knife karambit
npx cs2skin stickers match.dem -o out.dem --player "player" --weapon ak --sticker "titan holo" --count 4
npx cs2skin apply match.dem -o out.dem --script changes.json
```

`inspect` prints the map, players, and sampled weapon skins (`--json` for JSON). `strip` sets paint, seed, wear, and StatTrak to vanilla: paint `0`, seed `0`, wear `0`, StatTrak `-1`. `set` applies one paint to one player. `knife` changes that player's knife model to another knife. `stickers` writes kit ids into the default slots (an AK has four). `apply` runs a JSON script of those operations. See [examples](docs/EXAMPLES.md).

Writes require `-o`. The input path is never overwritten. `--player` is a case-insensitive name substring or an exact Steam64 id. Several matching names is an error. `--weapon` only filters which weapon is edited. It is never written for a gun. Paint `0` clears a skin. `--stattrak -1` clears StatTrak. `--stickers` on `strip` zeros sticker slot values when the slot id is 113, 117, 121, 125, or 129. `cs2skin stickers` with no demo lists the sticker catalog. `--sticker` with `--count 4` repeats one kit across the first four default slots. `--stickers 76,76,76,76` is the same craft. Wear, scale, rotation, and offset are not written, so each gun keeps its own slot positions. A sixth slot is an error.

`knife` only rewrites a knife entity (definition index 42, 59, or 500–526) to another knife. The entity class stays as it is. Custom knives get `m_iEntityQuality` 3 when that field exists. Stock knives get quality 0. `m_iItemIDHigh` is left alone, so a client that only shows a custom knife when that field is -1 may keep the old mesh. This tool does not claim playback. A player with no knife is a warning, and their guns are left alone.

`cs2skin weapons`, `cs2skin paints [--search text] [--weapon ak47]`, and `cs2skin stickers [--search text]` list the catalog. A numeric paint or sticker id is accepted even when the catalog has no name for it. `titan holo` is Titan (Holo) | Katowice 2014, kit 76. Bare `titan` is not an alias.

## Time

Times are measured on the demo clock:

- `#12345` or `tick:12345` is an absolute demo tick.
- `1:23` or `1:23.5` is minutes and seconds from the first demo tick.
- `90` or `90s` is seconds from the first demo tick.

Seconds are converted with the demo's tick interval (server info, or `1/64` if that message is missing) and rounded to the nearest tick. Omit `--from` or `--to` to leave that side open. A timed edit writes the previous value back at the first update after the end, so the change does not remain for the rest of the file. For stickers, a window that started with no stickers writes the attribute list length back to 0.

## Dry run

`--dry-run` prints the report and does not write a file. Changes are still listed. A dry run with zero changes exits 0. Warnings go to stderr. The process exits 1 if the player is missing, the player name is ambiguous, the knife or sticker name is unknown, or a write would change a gun's definition index. A successful write exits 0.

## Decode failures

A demo this tool cannot decode is reported and left untouched. It is not silently rewritten or corrupted. After a successful encode, every weapon definition index in the output is compared with the index the edit was supposed to leave. A planned knife swap is expected. Any other difference discards the bytes.

Paint, strip, and sticker edits copy these fields as original bits: `m_iItemDefinitionIndex`, `m_iItemID`, `m_iItemIDHigh`, `m_iItemIDLow`, and `m_iAccountID`. The knife operation is the only writer of `m_iItemDefinitionIndex`, and only from one knife to another. Guns stay on their original index.

## More

- [Architecture](docs/ARCHITECTURE.md) covers PBDEMS2 framing, cosmetic re-encoding, baselines, and the definition-index check.
- [Examples](docs/EXAMPLES.md) walks through the JSON scripts in `examples/`.

## License

[MIT](LICENSE).
