// snappyjs ships without type declarations.
// @ts-expect-error TS7016
import snappy from "snappyjs";
import {
  DEM_FILE_INFO,
  DEM_IS_COMPRESSED,
  DEM_SPAWN_GROUPS,
  DEMO_MAGIC,
  type DemoCommand,
  type DemoFile,
} from "../contract.js";

const MAGIC = new TextEncoder().encode(DEMO_MAGIC);
const HEADER_SIZE = 16;
const MAX_VARINT_BYTES = 10;

/**
 * PBDEMS2 framing. Bit 0x40 marks a raw Snappy block, not framed Snappy.
 * A body is compressed only when that block is shorter than the raw bytes.
 */
export function readDemo(buf: Uint8Array): DemoFile {
  if (buf.length < HEADER_SIZE) throw new Error("truncated demo header");
  if (MAGIC.length !== 8) throw new Error("DEMO_MAGIC must be 8 bytes");
  for (let index = 0; index < MAGIC.length; index++) {
    if (buf[index] !== MAGIC[index]) throw new Error("invalid demo magic");
  }

  const commands: DemoCommand[] = [];
  let offset = HEADER_SIZE;
  while (offset < buf.length) {
    const id = readVarint(buf, offset);
    const tick = readVarint(buf, id.next);
    const size = readVarint(buf, tick.next);
    if (tick.value > 0xffffffff) {
      throw new Error(`tick varint does not fit in uint32 at offset ${tick.start}`);
    }
    const payload = readExact(buf, size.next, size.value);
    const compressed = isCompressed(id.value);
    commands.push({
      command: withoutCompression(id.value),
      compressed,
      tick: zigzagDecode(tick.value),
      body: compressed ? snappyUncompress(payload) : payload,
    });
    offset = size.next + size.value;
  }
  return { commands };
}

export function writeDemo(file: DemoFile): Uint8Array {
  if (MAGIC.length !== 8) throw new Error("DEMO_MAGIC must be 8 bytes");
  const parts: Uint8Array[] = [];
  let position = HEADER_SIZE;
  let fileInfoOffset = 0;
  let spawnGroupsOffset = 0;

  for (const command of file.commands) {
    const id = withoutCompression(command.command);
    if (id === DEM_FILE_INFO && fileInfoOffset === 0) fileInfoOffset = position;
    if (id === DEM_SPAWN_GROUPS && spawnGroupsOffset === 0) spawnGroupsOffset = position;
    const encoded = encodeCommand(id, command.tick, command.body);
    parts.push(encoded);
    position += encoded.length;
  }

  const out = new Uint8Array(position);
  out.set(MAGIC, 0);
  let cursor = HEADER_SIZE;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
  writeOffset(view, 8, fileInfoOffset);
  writeOffset(view, 12, spawnGroupsOffset);
  return out;
}

function encodeCommand(command: number, tick: number, body: Uint8Array): Uint8Array {
  const compressed = snappyCompress(body);
  const useCompressed = compressed.length < body.length;
  const payload = useCompressed ? compressed : body;
  const id = useCompressed ? command + DEM_IS_COMPRESSED : command;
  return concat(writeVarint(id), writeVarint(zigzagEncode(tick)), writeVarint(payload.length), payload);
}

/** Protobuf int32 zigzag. `>>> 0` keeps the sign bit in the unsigned varint. */
function zigzagEncode(tick: number): number {
  const n = tick | 0;
  return ((n << 1) ^ (n >> 31)) >>> 0;
}

function zigzagDecode(unsigned: number): number {
  const n = unsigned >>> 0;
  return (n >>> 1) ^ -(n & 1);
}

function isCompressed(command: number): boolean {
  return (command & DEM_IS_COMPRESSED) !== 0;
}

function withoutCompression(command: number): number {
  return command - (command & DEM_IS_COMPRESSED);
}

function snappyCompress(body: Uint8Array): Uint8Array {
  const compressed = snappy.compress(Buffer.from(body)) as Uint8Array;
  return new Uint8Array(compressed);
}

function snappyUncompress(body: Uint8Array): Uint8Array {
  const raw = snappy.uncompress(Buffer.from(body)) as Uint8Array;
  return new Uint8Array(raw);
}

function readVarint(buf: Uint8Array, offset: number): { value: number; next: number; start: number } {
  let value = 0n;
  let shift = 0n;
  const start = offset;
  for (let count = 0; count < MAX_VARINT_BYTES; count++) {
    if (offset >= buf.length) throw new Error(`truncated varint at offset ${start}`);
    const byte = buf[offset];
    if (byte === undefined) throw new Error(`truncated varint at offset ${start}`);
    offset++;
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) {
      if (value > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error(`varint is too large at offset ${start}`);
      }
      return { value: Number(value), next: offset, start };
    }
    shift += 7n;
  }
  throw new Error(`varint is too long at offset ${start}`);
}

function writeVarint(value: number): Uint8Array {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error("invalid varint");
  const bytes: number[] = [];
  let rest = BigInt(value);
  do {
    let byte = Number(rest & 0x7fn);
    rest >>= 7n;
    if (rest !== 0n) byte |= 0x80;
    bytes.push(byte);
  } while (rest !== 0n);
  return Uint8Array.from(bytes);
}

function readExact(buf: Uint8Array, offset: number, size: number): Uint8Array {
  if (!Number.isInteger(size) || size < 0 || offset + size > buf.length) {
    throw new Error(`truncated command body at offset ${offset}`);
  }
  return buf.slice(offset, offset + size);
}

function writeOffset(view: DataView, offset: number, value: number): void {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
    throw new Error(`demo offset ${value} does not fit in uint32`);
  }
  view.setUint32(offset, value, true);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  let size = 0;
  for (const part of parts) size += part.length;
  const out = new Uint8Array(size);
  let cursor = 0;
  for (const part of parts) {
    out.set(part, cursor);
    cursor += part.length;
  }
  return out;
}
