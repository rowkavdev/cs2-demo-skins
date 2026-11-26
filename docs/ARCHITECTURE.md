# Architecture

`cs2-demo-skins` edits a CS2 `.dem` at the bitstream level. It loads the demo's own send tables, copies entity values as their original bits, and re-encodes only cosmetic weapon fields. Shared constants and types live in `src/contract.ts`. Module ownership is in `SPEC.md`.

The public functions are `rewriteDemo` and `inspectDemo`, re-exported from `src/index.ts`.

## PBDEMS2 framing

A file begins with 16 bytes:

| Offset | Contents |
| --- | --- |
| 0 | ASCII `PBDEMS2` and a trailing NUL (`DEMO_MAGIC`) |
| 8 | Little-endian uint32 file position of the first `DEM_FILE_INFO` command, or 0 if there is none |
| 12 | Little-endian uint32 file position of the first `DEM_SPAWN_GROUPS` command, or 0 if there is none |

Commands follow immediately, with no padding:

1. An unsigned varint command id. Bit `0x40` (`DEM_IS_COMPRESSED`) means the body is raw Snappy, not framed Snappy.
2. A zigzag varint tick, decoded to a signed int32 with `(n >>> 1) ^ -(n & 1)`.
3. An unsigned varint body size, then that many bytes.

`readDemo` returns decompressed bodies and command ids with the compression bit cleared. `writeDemo` writes the header and then the commands. A body is compressed only when Snappy makes it smaller than the raw body. Once the command bytes are known, the two header offsets are patched to the first matching command, or left at 0. Reading the written file preserves command ids, ticks, and bodies.

Signon packets (`DEM_SIGNON_PACKET`) and normal packets (`DEM_PACKET`) carry a `CDemoPacket`. `DEM_FULL_PACKET` is a message whose field 1 is `CDemoStringTables` and whose field 2 is `CDemoPacket`. Inside `CDemoPacket.data` (protobuf field 3), each network message is a ubitvar type, a ubitvar size, and that many payload bytes. The iterator stops when fewer than 8 bits remain.

Only `SVC_PACKET_ENTITIES` (55) is opened. Its `entity_data` is protobuf field 7, `updated_entries` is field 2, and the deprecated PVS-bit count is field 16. Every other network message is copied as raw payload bytes. `SVC_SERVER_INFO` (40) is read only for `tick_interval` (float field 13). If server info is missing, the interval is `1/64`.

## Why only cosmetic fields are re-encoded

Entity data is a bitstream. An index delta and a two-bit command select update, create, leave, or delete. Updates and creates then carry a Huffman field-path list (at most seven indices, weights in `FIELD_PATH_WEIGHTS`) and one value per path. The flattened serializer from `DEM_SEND_TABLES`, selected by class info, decides how each value is typed. Each decoded field keeps `rawBits` for that value alone, not for the path.

On write, paths are encoded again and each value is emitted from `rawBits`. `writeFieldValue` runs only when the editor set an override on that field. Overrides are legal only for:

| Script key | Network field |
| --- | --- |
| paint | `m_nFallbackPaintKit` |
| seed | `m_nFallbackSeed` |
| wear | `m_flFallbackWear` |
| stattrak | `m_nFallbackStatTrak` |

`assertCosmeticWrite` throws on any other name. Vanilla is paint 0, seed 0, wear 0, StatTrak -1.

If cosmetic fields have to be appended, the original path bits are copied up to the finish symbol, `stepFieldPath` walks each new path that sits after the last existing one, and the finish symbol follows. A new path that sits before an existing field is merged and re-encoded. If that encode fails, the original paths are kept and value overrides are still written. A step that cannot be expressed is left off and a warning is reported.

Positions, buttons, and the rest of the snapshot never pass through a decode/encode pair. Unknown protobuf fields stay in their original order. The only packet fields replaced are entity data and, if the record count changes, the updated-entry count.

## Why protected fields keep their original bits

These fields identify the item. Paint, strip, and sticker writes copy the bits unchanged (`PROTECTED_FIELD_NAMES`):

- `m_iItemDefinitionIndex` — which weapon or item it is
- `m_iItemID`
- `m_iItemIDHigh`
- `m_iItemIDLow`
- `m_iAccountID`

`isProtectedField` is true when the final path segment is one of those names, so `m_AttributeManager.m_Item.m_iItemDefinitionIndex` is protected. The stored `rawBits` are written back. The value is not decoded and re-encoded, so a varint cannot grow, shrink, or flip. `--weapon` on `set` and `stickers` selects by catalog name or definition index. That number is never written into the demo.

The knife operation is the exception. It may write `m_iItemDefinitionIndex` when both the current id and the target id are knives (42, 59, or 500–526). It may also set `m_iEntityQuality` to 3 for a custom knife and 0 for a stock knife. It does not write `m_iItemIDHigh`, and it does not change the entity class. A client that only shows a custom knife when `m_iItemIDHigh` is -1 may keep the old mesh. Playback is not claimed.

Ownership is resolved only to decide which entities match a player. A skinnable entity is one that has a definition index. The owner pawn comes from `m_hOwnerEntity`, or from the pawn whose active weapon or weapon list contains the entity. The player is that pawn's controller. Handle indexes use `0x7fff`. `0xffffffff` and index `0x7fff` mean no entity.

## Baselines

Items in the `instancebaseline` string table, named by decimal class id, are the same field-path blobs the game applies when an entity is created. Table messages use repeated field 1 for tables, name in field 1 and items in field 2, and each item has string field 1 and data field 2. When the editor asks for a baseline update, those bytes get the same cosmetic rewrite as a live entity update.

`strip` with no time bound includes instance baselines, so a newly spawned weapon does not inherit a skin from the class baseline. Protected fields on that baseline are still copied as original bits. Sticker clearing zeros `m_iRawValue32` when the attribute definition is 113, 117, 121, 125, or 129. `m_flInitialValue` is left alone. Stickers are not weapon identity. Knife and sticker operations do not rewrite baselines.

A timed `set` applies paint, and wear, seed, or StatTrak only when those keys are present, on weapons that player holds inside the tick window. At the first update after the end tick, the pre-window values are written back so a later delta does not keep the temporary skin. A missing cosmetic field on that update is appended when `stepFieldPath` can. A timed knife or sticker edit restores the same way. Restoring a sticker list whose saved length was 0 writes that length and does not also emit element updates in the same packet.

Sticker kit ids live on `m_AttributeList.m_Attributes` (or a flat `m_Attributes` in a test serializer). The path that ends on the vector is its length, an unsigned varint. The next component is the element index, then the element fields. Slot n uses attribute id `113 + 4n`. The raw value is a float whose IEEE bits are the kit id.

## Post-write definition-index check

`rewriteDemo` builds the new file, then parses that output and compares every entity's definition index at every tick with the index the edit meant to leave. Gun indexes must match the input. A planned knife-to-knife swap is expected. `weaponIdentityPreserved` stays true on a returned result. If any other index differs, the function throws and does not return the bytes.

`--dry-run` still fills `changes`, warnings, players, and the tick range, and returns `output: null`. No file is written.

A demo that cannot be decoded fails during the read. The error is reported. The input is not replaced with a partial or guessed rewrite.

`inspectDemo` records a weapon when its cosmetic state, sticker list, or owner changes, not on every tick. Reports name the weapon and the paint. A knife swap says the knife indexes changed and other weapons were left unchanged. Any other rewrite says the definition indexes were left unchanged.
