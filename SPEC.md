# cs2-demo-skins implementation spec

This file is the contract for parallel work. Read it before editing. Import shared names from `src/contract.ts`. Use ESM with `.js` specifiers in TypeScript imports (`./foo.js` points at `./foo.ts`). NodeNext resolution. Vitest tests live in `test/`. Do not add a web app. Do not commit demo files.

The product rewrites cosmetic fields on CS2 `.dem` files. It must never write `m_iItemDefinitionIndex` or the other names in `PROTECTED_FIELD_NAMES`. A paint kit, seed, wear, or StatTrak value may change. The weapon the player is holding may not.

## Module map

| Owner | Files |
| --- | --- |
| bits | `src/bits/bit-reader.ts`, `src/bits/bit-writer.ts`, `src/bits/ubit.ts`, `test/bits.test.ts` |
| proto | `src/proto/codec.ts`, `test/proto.test.ts` |
| demo | `src/demo/frame.ts`, `test/demo-frame.test.ts` |
| field path | `src/entity/field-path.ts`, `test/field-path.test.ts` |
| values | `src/entity/values.ts`, `test/values.test.ts` |
| entity | `src/entity/serializer.ts`, `src/entity/delta.ts`, `test/delta.test.ts` |
| editor | `src/edit/policy.ts`, `src/edit/plan.ts`, `src/edit/apply.ts`, `src/edit/session.ts`, `src/index.ts`, `test/edit.test.ts` |
| catalog | `src/catalog/weapons.ts`, `src/catalog/paints.ts`, `src/catalog/index.ts`, `test/catalog.test.ts` |
| cli | `src/cli.ts`, `src/time/parse.ts`, `src/edit/inspect.ts`, `src/edit/report.ts`, `test/time.test.ts`, `test/cli.test.ts` |
| docs | `README.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, `docs/EXAMPLES.md`, `.github/workflows/test.yml`, `examples/*.json` |

Do not edit files owned by another module. If you need a helper, keep it inside your files.

## Bits

Source 2 entity and packet bitstreams are little-endian at the bit level: bit 0 of a byte is the least significant bit, and it is read first.

`BitReader` in `src/bits/bit-reader.ts`:

- `constructor(data: Uint8Array)`
- `bitPos`, `byteLength`, `remainingBits()`
- `readBit()`, `readBits(n)` for n in 1..32, returns an unsigned number
- `readBits64(n)` returns bigint
- `readBoolean()`
- `readBytes(n)` reads n*8 bits, which may start mid-byte
- `peekBits(n)` does not advance
- `skipBits(n)`
- `sliceBits(start, end)` returns a `BitSlice` of bits in `[start, end)`

`BitWriter` in `src/bits/bit-writer.ts` mirrors those writes, plus `writeSlice(slice)`, `toUint8Array()` (zero-pad to a byte), and `bitLength`.

`src/bits/ubit.ts`:

- `readUBitVar` / `writeUBitVar`: read 6 bits into `ret`. Switch on `ret & 48`: 16 means `(ret & 15) | (readBits(4) << 4)`; 32 means 8 extra bits; 48 means 28 extra bits. Other values stay as the 6-bit number.
- `readUBitVarFieldPath` / `writeUBitVarFieldPath`: if the next bit is 1, the value is `readBits(2)`. Else if the next bit is 1, `readBits(4)`. Else if 1, `readBits(10)`. Else if 1, `readBits(17)`. Else `readBits(31)`.
- `readBitVarU32` / `writeBitVarU32`: protobuf-style unsigned varint, but each group is `readBits(8)` from the bitstream. Stop when the high bit is clear, or after 5 bytes.
- `readBitVarS32` / `writeBitVarS32`: the same bits interpreted as an int32. Negative numbers use the full 32-bit pattern (a 5-byte varint), not zigzag.
- `readBitVarU64` / `writeBitVarU64`: up to 10 groups, bigint.

Round-trip every encoder in tests, including values 0, 1, 15, 16, 63, 64, 309, 0xffffffff, and a mid-byte alignment.

## Protobuf

`src/proto/codec.ts` is a small proto2/3 codec. Preserve field order. Unknown fields stay in the list.

Exports:

- `decodeProto(buf: Uint8Array): ProtoField[]`
- `encodeProto(fields: ProtoField[]): Uint8Array`
- `getBytes(fields, field): Uint8Array | undefined` (last occurrence)
- `getString(fields, field): string | undefined`
- `getVarint(fields, field): bigint | undefined`
- `getFloat(fields, field): number | undefined` (wire type 5, little-endian float32)
- `getBool(fields, field): boolean | undefined`
- `getMessages(fields, field): ProtoField[][]` for every length-delimited submessage
- `replaceBytes(fields, field, bytes): ProtoField[]` replaces the first match or appends wire type 2
- `replaceVarint(fields, field, value: bigint): ProtoField[]`

Varint tags are `(field << 3) | wire`. Wire 0 varint, 1 fixed64, 2 length-delimited, 5 fixed32. Zigzag is not used here. Packed repeated fields can be left as raw length-delimited bytes; callers that need them decode the payload themselves.

## Demo container

`src/demo/frame.ts`:

A CS2 demo starts with 16 bytes: ASCII `PBDEMS2` plus a NUL, then a little-endian uint32 file-info command offset, then a little-endian uint32 spawn-groups command offset. Offsets are absolute file positions. Zero means absent.

Commands follow with no padding:

- unsigned varint command id. Bit 0x40 means the body is raw Snappy, not framed Snappy. `snappyjs` compress/uncompress.
- zigzag varint tick, decoded to a signed int32. Zigzag: `(n >>> 1) ^ -(n & 1)`.
- unsigned varint body size
- that many bytes

`readDemo(buf: Uint8Array): DemoFile` returns decompressed bodies and the command id with the compression bit cleared.

`writeDemo(file: DemoFile): Uint8Array` writes the header, then commands. Compress a body with Snappy only when the compressed form is smaller than the raw body. After the bytes are known, patch the two header offsets so they point at the first `DEM_FILE_INFO` command and the first `DEM_SPAWN_GROUPS` command. Leave the offset at 0 when that command is absent.

`readDemo(writeDemo(file))` must preserve command ids, ticks, and bodies.

## Field paths

`src/entity/field-path.ts`.

A path is a stack of at most 7 indices. The cursor starts as `[-1]` (last = 0, path[0] = -1, deeper slots 0). Each operation except Finish mutates the cursor and emits the new path. Finish ends the list and emits nothing.

Build the Huffman tree the way Go's `container/heap` does:

- One leaf per symbol. Weight 0 becomes weight 1. Leaf value is the symbol id.
- Min-heap. `Less(i, j)` is true when weight i < weight j. On equal weight, `Less` is true when value i >= value j.
- Pop `a`, pop `b`, push a node whose value starts at 40 and increments, left = a, right = b, weight = sum.
- Decode bit 0 walks left and bit 1 walks right.

Operations, in symbol order, match `FIELD_PATH_OP`. Read extras with the bit helpers. `pop(n)` zeros the popped slots and decreases `last`.

- PlusOne/Two/Three/Four add that much to `path[last]`.
- PlusN adds `readUBitVarFieldPath() + 5`.
- PushOneLeftDeltaZeroRightZero: last++, new slot = 0.
- PushOneLeftDeltaZeroRightNonZero: last++, new slot = field-path ubitvar.
- PushOneLeftDeltaOneRightZero: path[last] += 1, last++, new = 0.
- PushOneLeftDeltaOneRightNonZero: path[last] += 1, last++, new = field-path ubitvar.
- PushOneLeftDeltaNRightZero: path[last] += field-path ubitvar, last++, new = 0.
- PushOneLeftDeltaNRightNonZero: path[last] += field-path ubitvar + 2, last++, new = field-path ubitvar + 1.
- Pack6: path[last] += readBits(3) + 2, last++, new = readBits(3) + 1.
- Pack8: path[last] += readBits(4) + 2, last++, new = readBits(4) + 1.
- PushTwo/Three variants push 2 or 3 slots. "Pack5" reads 5 bits per new slot. "DeltaZero" adds a field-path ubitvar to each new slot (slots start at 0). "DeltaOne" first adds 1 to the current slot. "DeltaN" first adds `readUBitVar() + 2` to the current slot (`readUBitVar`, not the field-path variant).
- PushN: `n = readUBitVar()`, add `readUBitVar()` to the current slot, then push n slots of field-path ubitvars.
- PushNAndNonTopological: for each current slot, a bit chooses whether to add `readBitVarS32() + 1`. Then push `readUBitVar()` slots of field-path ubitvars.
- PopOnePlusOne: pop 1, then +1.
- PopOnePlusN: pop 1, then add field-path ubitvar + 1.
- PopAllButOnePlusOne: pop until last is 0, then path[0] += 1.
- PopAllButOnePlusN: pop until last is 0, then path[0] += field-path ubitvar + 1.
- Pack3/Pack6 variants of that add `readBits(3)+1` or `readBits(6)+1`.
- PopNPlusOne: pop `readUBitVarFieldPath()`, then +1.
- PopNPlusN: pop field-path ubitvar, then add `readBitVarS32()`.
- PopNAndNonTopographical: pop field-path ubitvar, then for each remaining slot a bit chooses `readBitVarS32()` added as-is.
- NonTopoComplex: same depth, a bit per slot chooses `readBitVarS32()` added as-is.
- NonTopoPenultimatePlusOne: path[last-1] += 1.
- NonTopoComplexPack4Bits: a bit per slot chooses `readBits(4) - 7`.
- Finish: stop.

Exports:

- `decodeFieldPaths(reader): { paths: FieldPath[]; pathBitEnd: number }` where `pathBitEnd` is the bit position just before the finish symbol's bits were consumed? No: return `finishBitStart`, the bit position where the finish symbol begins, and `endBit`, the position after it. Paths are the emitted paths only.
- `encodeFieldPaths(paths: FieldPath[]): BitSlice` such that decoding that slice yields the same paths.
- `stepFieldPath(from: FieldPath, to: FieldPath): BitSlice | null` writes exactly one operation that turns `from` into `to`, or returns null. Prefer NonTopoComplex when the depth matches (false bit keeps a component, true bit plus a signed varint sets any delta). Prefer PopNAndNonTopographical when `to` is shallower. Use a push operation when `to` is deeper and no existing component needs to decrease.

Tests must round-trip at least: `[[0]]`, `[[0],[1],[2]]`, `[[3,0],[3,1],[4]]`, and a path that uses PlusN (index jump greater than 4).

## Values

`src/entity/values.ts` exports `readFieldValue(reader, spec)` and `writeFieldValue(writer, spec, value)`.

Choose the decoder in this order:

1. Encoder `fixed8`, `fixed16`, or `fixed32`: read that many raw bits. Sign-extend when the type name starts with `int` and is not `uint`.
2. Encoder `fixed64`: `readBitVarU64`.
3. Type `bool` or `CNetworkedQuantizedFloat` is handled below. `bool` is one bit.
4. Types whose base name is `int8`, `int16`, `int32`, `int64`, or an enum with `signedEnum`: `readBitVarS32` (int64 still fits the signed varint; store as `int` when it fits in 32 bits, otherwise `uint64`).
5. Unsigned integers, `CHandle`, `CEntityHandle`, `CUtlStringToken`, `color32` as uint32 varint: `readBitVarU32` or `readBitVarU64` for 64-bit names (`uint64`, `CUtlSymbolLarge` is a string, not an int).
6. `float32` with no bit count, or bit count 0 or >= 32: 32 raw bits, IEEE-754 via `DataView`.
7. Quantized float (`CNetworkedQuantizedFloat`, or float with bit count in 1..31): if bit count is missing, read a float32. Otherwise, flags are bit 0 round-down, bit 1 round-up, bit 2 encode-zero, bit 3 encode-integers. If round-down is set and the next bit is 1, the value is `low`. Else if round-up is set and the next bit is 1, the value is `high`. Else if encode-zero is set and the next bit is 1, the value is 0. Else read `bitCount` bits `u` and return `low + (high-low) * u / ((1<<bitCount) - 1)`. A null low/high means 0 and 1.
8. `string`, `CUtlString`, `CUtlSymbolLarge`, `char` when the type contains `*`: bytes of 8 bits until a 0 byte. Store as a string using latin1 so every byte round-trips.
9. `Vector`, `QAngle`, and other fixed-size float aggregates: three float32s, unless the encoder is `qangle_pitch_yaw` (two floats) or `normal` (three components where the third is reconstructed from a unit vector: read two floats and a sign bit). If you are not sure of a vector layout, read three float32s for names containing `Vector` or `QAngle`.
10. Anything else: throw `UnknownFieldEncoding` with the type and encoder names. Do not guess a length.

`writeFieldValue` must be the inverse for bool, signed varint, unsigned varint, float32, string, and fixed8/16/32. Tests cover paint-kit sized ints (0, 38, 309, 1024), wear floats (0, 0.07, 1), and strings with a NUL.

## Serializers and entity deltas

`parseFlattenedSerializers(body: Uint8Array)` reads a `CDemoSendTables` message (field 1 is bytes) or a raw `CSVCMsg_FlattenedSerializer`. Field numbers:

- serializer: name symbol 1, version 2, repeated field index 3 (packed or repeated varints; accept both)
- symbol table: field 2 of the outer message, repeated strings
- field pool: field 3, each a submessage with var_type_sym 1, var_name_sym 2, bit_count 3, low_value 4 (float), high_value 5 (float), encode_flags 6, field_serializer_name_sym 7, send_node_sym 9, var_encoder_sym 10, var_enum_info 13 containing is_signed_enum 1

Resolve symbols. A field with a serializer name is a nested message; children are that serializer's fields. Build `Map<string, Serializer>`.

`parseClassInfo(body)` reads `CDemoClassInfo`. Field 1 is repeated class messages: class_id 1, network_name 2, table_name 3. `classIdBits(classes)` is `classes.length === 0 ? 1 : 32 - Math.clz32(maxClassId)`.

`readEntityData(bytes, updatedEntries, classBits, hasPvsBits, resolve)` walks a bitstream:

```
index = -1
for each of updatedEntries:
  index += readUBitVar() + 1
  cmd = readBits(2)
  0b00 update: if hasPvsBits > 0, skip that many bits; then field paths and values
  0b10 create: classId = readBits(classBits); serial = readBits(17); extra = readBitVarU32(); then field paths and values
  0b01 leave
  0b11 delete
```

Resolve each path against the class serializer. The network name's serializer is `serializers.get(tableName) ?? serializers.get(networkName)`. Walk numeric indices. The leaf spec decodes the value. Record `rawBits` for that value only (not the path bits). `namePath` is the chain of `var_name`s.

`writeEntityData(records, classBits, hasPvsBits)` is the inverse. For an update or create, write paths with `encodeFieldPaths`, then each field's `rawBits`, unless `override` replaced the value, in which case `writeFieldValue`. A record may include `valueOverride: FieldValue | null` on a decoded field; the editor adds that optional property locally without changing the contract type if it copies into a wider type.

If a new cosmetic field must be appended, copy the original path bits up to `finishBitStart`, write `stepFieldPath` from the last path, write the finish symbol, write the original value bits, then the new value. If `stepFieldPath` returns null, leave the record unchanged and surface a warning.

Stop the packet-message iterator when fewer than 8 bits remain.

Packet messages inside `CDemoPacket.data` (protobuf field 3):

```
while remaining bits > 8:
  type = readUBitVar()
  size = readBitVarU32()
  payload = readBytes(size)
```

Rebuild by writing the same framing. Only message type `SVC_PACKET_ENTITIES` (55) is decoded. Its protobuf field 7 is `entity_data`. Field 2 is `updated_entries`. Field 16 is `has_pvs_vis_bits_deprecated`. Replace field 7 with the rewritten bytes and field 2 if the record count changes. Copy every other packet message's payload bytes unchanged.

`DEM_FULL_PACKET` is a message with field 1 `CDemoStringTables` and field 2 `CDemoPacket`. Rewrite the nested packet the same way. String table items named by the decimal class id in the table `instancebaseline` are field-path blobs. Run the same field rewrite on those bytes when the editor asks for a baseline update. Table field numbers: tables repeated field 1; each table has name 1 and items 2; each item has string 1 and bytes 2.

## Editor rules

`src/edit/policy.ts`:

- `isProtectedField(name: string): boolean` true when the final segment is in `PROTECTED_FIELD_NAMES`.
- `assertCosmeticWrite(name: string): void` throws if protected.
- `vanillaCosmetic()` returns paint 0, seed 0, wear 0, stattrak -1.

`src/edit/plan.ts` and `session.ts`:

Pass 1 parses the demo, installs serializers from `DEM_SEND_TABLES`, class info from `DEM_CLASS_INFO`, and tracks entities across packet and signon messages.

Interested field suffixes:

- player controller (`networkName` includes `PlayerController`): `m_sSanitizedPlayerName`, `m_iszPlayerName`, `m_steamID`, `m_hPlayerPawn`, `m_iTeamNum`
- pawn (`networkName` includes `PlayerPawn` or `CSObserverPawn`): `m_hController`, `m_hActiveWeapon`, `m_hMyWeapons`
- anything with `m_iItemDefinitionIndex`: that index, `m_nFallbackPaintKit`, `m_nFallbackSeed`, `m_flFallbackWear`, `m_nFallbackStatTrak`, `m_hOwnerEntity`, `m_OriginalOwnerXuidLow`, `m_OriginalOwnerXuidHigh`

Handle index is `Number(handle) & 0x7fff`. Treat `0xffffffff` and index `0x7fff` as no entity.

A skinnable entity has a definition index. Ownership at a tick is the pawn from `m_hOwnerEntity`, else the pawn whose active weapon or `m_hMyWeapons` contains the entity. The player is that pawn's controller.

`strip` sets paint, seed, wear, and stattrak to the vanilla tuple on every skinnable entity inside the time range, including instance baselines when the range is unbounded. It does not touch protected fields. Sticker stripping is best-effort: if a sibling attribute-definition field equals 113, 117, 121, 125, or 129 (sticker slot ids), zero the adjacent value field. If the layout is not that obvious, skip stickers and warn.

`set` selects one player by case-insensitive substring of the name, or by exact steam64. If several names match, refuse with an error that lists them. Optional `weapon` filters by catalog name or definition index and is never written. Apply paint, and wear/seed/stattrak when those keys are present, on weapons that player holds in the tick window. At the first update at or after `toTick`, write the pre-window values back so a later delta does not keep the temporary skin. If the cosmetic field is absent from that update, append it when `stepFieldPath` can.

`rewriteDemo(input: Uint8Array, script: EditScript, options?: { dryRun?: boolean }): RewriteResult` is the public function, re-exported from `src/index.ts` together with `inspectDemo`.

After writing, parse the output and compare every entity's definition index at every tick with the input. `weaponIdentityPreserved` is true only when they match. If they do not, throw and do not return the bytes.

Dry run returns `output: null` and still fills `changes`.

`src/edit/inspect.ts` exports `inspectDemo(input: Uint8Array): InspectReport`. Sample a weapon when its cosmetic state or owner changes, not on every tick.

`src/edit/report.ts` exports `formatInspect(report)` and `formatRewrite(result)` as readable plain text. Include the weapon name, paint name, tick, and a line that states the definition index was left unchanged.

## Time

`src/time/parse.ts` exports `parseDemoTime(text: string, ctx: { startTick: number; tickInterval: number }): number`.

- `#12345` and `tick:12345` are absolute ticks.
- `m:ss` and `m:ss.s` are offsets from `startTick`. Seconds divided by `tickInterval`, rounded to the nearest tick.
- `90` and `90s` are seconds from the start.
- Reject negative results and empty strings.

Default tick interval is `1/64` when server info is missing. Server info is `SVC_SERVER_INFO` (40) inside a signon or normal packet. `tick_interval` is float field 13.

## Catalog

`resolveWeapon(query: string): WeaponDef | undefined` accepts the id, the display name, or an alias (`ak`, `ak47`, `ak-47`). `resolvePaint` does the same. Numeric strings are valid paint ids even when they are not in the catalog; `resolvePaint("309")` returns `{ id: 309, name: "309", aliases: [], weapons: [] }` if 309 is unknown, and the real record if it is known. `paintName(id)` returns the catalog name or null.

Include the current CS2 item definition ids for pistols, SMGs, rifles, heavies, snipers, grenades, the Zeus, the C4, and the knives from Bayonet (500) through Kukri (526), skipping unused ids. Include a curated paint list of well-known finishes with correct ids (Howl 309, Dragon Lore 344, Asiimov 279, Redline 282, Vulcan 302, Fire Serpent 180, Fade 38, Case Hardened 44, Printstream 984 where that id is right — omit a skin if you are not sure of the id). Wrong paint ids are worse than a short list.

## CLI

`src/cli.ts` is the bin. Shebang `#!/usr/bin/env node`. Commands:

- `cs2skin inspect <demo> [--json]`
- `cs2skin paints [--search text] [--weapon ak47]`
- `cs2skin weapons`
- `cs2skin strip <demo> -o <out> [--from time] [--to time] [--dry-run] [--stickers]`
- `cs2skin set <demo> -o <out> --player name --paint nameOrId [--weapon name] [--wear n] [--seed n] [--stattrak n] [--from time] [--to time] [--dry-run]`
- `cs2skin apply <demo> -o <out> --script file.json [--dry-run]`

`--dry-run` prints the report and does not write. Refusing to overwrite the input path when `-o` is omitted: require `-o` for writes. Exit 1 on a missing player, an ambiguous player, or `weaponIdentityPreserved === false`. Exit 0 on success, including a dry run with zero changes. Print warnings to stderr.

`test/cli.test.ts` can spawn `node --experimental-strip-types src/cli.ts weapons` and assert the output contains `AK-47`. `test/edit.test.ts` builds a tiny synthetic demo through the demo and entity writers: one controller, one weapon entity with definition index 7 and paint 282, then `set` paint 309, and asserts the definition index is still 7 and the paint is 309. A second case asserts `strip` yields paint 0. A third case asserts a plan that would change the definition index throws before any write.

## Docs and CI

README explains the invariant in the first screen: skins change, weapons do not. Show the install, the three main commands, and a JSON script. Say that playback still depends on the demo's own serializers, and that a demo the tool cannot decode is left untouched and reported. Do not claim Valve endorsement.

GitHub Actions on push and pull request: `npm ci`, `npm test`, `npm run build`, on `ubuntu-latest` with Node 22.

Examples in `examples/` are JSON scripts only, no demo binaries.
