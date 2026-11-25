# Examples

`cs2skin apply` reads a JSON script. The file is an object with an `operations` array. Each entry is a `strip` or a `set`. There are no demo binaries here. Times use the same forms as the CLI: `#tick` for an absolute tick, `m:ss` from the first demo tick, and `90s` for seconds from that tick.

```bash
npx cs2skin apply match.dem -o out.dem --script examples/strip-all.json
npx cs2skin apply match.dem -o out.dem --script examples/timed-reskin.json --dry-run
npx cs2skin apply match.dem -o out.dem --script examples/clear-one-player.json
```

`--dry-run` prints the report and writes nothing. Operations run in order. `player` is a case-insensitive name substring or an exact Steam64 id. If several names match, apply stops and lists them. `weapon` filters by catalog name or definition index and is never written. Paint `0` clears a skin. None of these scripts change `m_iItemDefinitionIndex`.

## Strip every skin

[`examples/strip-all.json`](../examples/strip-all.json) has no player, weapon, or time. An unbounded `strip` sets paint, seed, wear, and StatTrak to vanilla (0, 0, 0, -1) on every skinnable entity, including instance baselines. Protected item fields are copied as original bits.

```json
{
  "operations": [
    {
      "op": "strip"
    }
  ]
}
```

Add `"from"` and `"to"` to limit the window. Add `"stickers": true` for a best-effort sticker clear. If the sticker layout is not the usual slot ids, those values are skipped and a warning is printed.

## Timed reskin

[`examples/timed-reskin.json`](../examples/timed-reskin.json) paints s1mple's AWP with Asiimov from 5:00 through 8:30, at wear 0.01. `5:00` and `8:30` are offsets from the first demo tick. Seed and StatTrak are omitted, so those fields stay as they were. At the first update at or after 8:30, the pre-window cosmetics are restored. The AWP is still an AWP.

```json
{
  "operations": [
    {
      "op": "set",
      "player": "s1mple",
      "paint": "asiimov",
      "weapon": "awp",
      "from": "5:00",
      "to": "8:30",
      "wear": 0.01
    }
  ]
}
```

`paint` may be a catalog name or a number. A number that is not in the catalog is still written as that paint kit id.

## Clear one player

[`examples/clear-one-player.json`](../examples/clear-one-player.json) sets NiKo's paint to 0 from the start of the demo onward. `0:00` is the first demo tick. There is no `to`, so the clear is not restored later. Other players are unchanged. Weapons are not swapped for other weapons. Seed, wear, and StatTrak are left alone because those keys are absent. Use `strip` when those should go vanilla too.

```json
{
  "operations": [
    {
      "op": "set",
      "player": "NiKo",
      "paint": 0,
      "from": "0:00"
    }
  ]
}
```
