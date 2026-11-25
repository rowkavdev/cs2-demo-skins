import type { ProtoField } from "../contract.js";

const MAX_VARINT_BYTES = 10;

/**
 * Schema-less proto2/3 wire codec.
 * Field order is preserved. Wire 1 and 5 store the little-endian unsigned
 * bit pattern in `number` (float32 is wire 5). Zigzag is not applied.
 */
export function decodeProto(buf: Uint8Array): ProtoField[] {
  const fields: ProtoField[] = [];
  let offset = 0;
  while (offset < buf.length) {
    const start = offset;
    const tag = readVarint(buf, offset);
    const wire = Number(tag.value & 7n);
    const fieldNumber = tag.value >> 3n;
    if (fieldNumber > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error(`field number is too large at offset ${start}`);
    }
    const field = Number(fieldNumber);
    offset = tag.next;
    switch (wire) {
      case 0: {
        const value = readVarint(buf, offset);
        offset = value.next;
        fields.push({ field, wire: 0, number: value.value });
        break;
      }
      case 1: {
        const fixed = readFixed(buf, offset, 8);
        offset = fixed.next;
        fields.push({ field, wire: 1, number: fixed.value });
        break;
      }
      case 2: {
        const length = readVarint(buf, offset);
        const payload = readBytes(buf, length.next, length.value);
        offset = payload.next;
        fields.push({ field, wire: 2, bytes: payload.bytes });
        break;
      }
      case 5: {
        const fixed = readFixed(buf, offset, 4);
        offset = fixed.next;
        fields.push({ field, wire: 5, number: fixed.value });
        break;
      }
      default:
        throw new Error(`unsupported wire type ${wire} at offset ${start}`);
    }
  }
  return fields;
}

export function encodeProto(fields: ProtoField[]): Uint8Array {
  const writer = new Writer();
  for (const field of fields) writeField(writer, field);
  return writer.finish();
}

/** Last length-delimited value of `field`, if any. */
export function getBytes(fields: ProtoField[], field: number): Uint8Array | undefined {
  return last(fields, field, 2)?.bytes;
}

export function getString(fields: ProtoField[], field: number): string | undefined {
  const bytes = getBytes(fields, field);
  if (bytes === undefined) return undefined;
  return new TextDecoder("utf-8").decode(bytes);
}

/** Last varint of `field`, if any. */
export function getVarint(fields: ProtoField[], field: number): bigint | undefined {
  return last(fields, field, 0)?.number;
}

/** Last wire-type-5 value of `field`, interpreted as little-endian float32. */
export function getFloat(fields: ProtoField[], field: number): number | undefined {
  const raw = last(fields, field, 5)?.number;
  if (raw === undefined) return undefined;
  const view = new DataView(new ArrayBuffer(4));
  view.setUint32(0, Number(raw & 0xffffffffn), true);
  return view.getFloat32(0, true);
}

export function getBool(fields: ProtoField[], field: number): boolean | undefined {
  const value = getVarint(fields, field);
  if (value === undefined) return undefined;
  return value !== 0n;
}

/** Every length-delimited occurrence of `field`, each decoded as a submessage. */
export function getMessages(fields: ProtoField[], field: number): ProtoField[][] {
  const messages: ProtoField[][] = [];
  for (const item of fields) {
    if (item.field !== field || item.wire !== 2) continue;
    messages.push(decodeProto(item.bytes ?? new Uint8Array()));
  }
  return messages;
}

/** Replace the first field with this number, or append a length-delimited field. */
export function replaceBytes(fields: ProtoField[], field: number, bytes: Uint8Array): ProtoField[] {
  return replaceField(fields, field, { field, wire: 2, bytes });
}

/** Replace the first field with this number, or append a varint field. */
export function replaceVarint(fields: ProtoField[], field: number, value: bigint): ProtoField[] {
  if (value < 0n) throw new Error("negative varint");
  return replaceField(fields, field, { field, wire: 0, number: value });
}

function last(fields: ProtoField[], field: number, wire: ProtoField["wire"]): ProtoField | undefined {
  for (let index = fields.length - 1; index >= 0; index--) {
    const item = fields[index];
    if (item !== undefined && item.field === field && item.wire === wire) return item;
  }
  return undefined;
}

function replaceField(fields: ProtoField[], field: number, next: ProtoField): ProtoField[] {
  const index = fields.findIndex((item) => item.field === field);
  if (index < 0) return [...fields, next];
  const copy = fields.slice();
  copy[index] = next;
  return copy;
}

function readVarint(buf: Uint8Array, offset: number): { value: bigint; next: number } {
  let value = 0n;
  let shift = 0n;
  const start = offset;
  for (let byteIndex = 0; byteIndex < MAX_VARINT_BYTES; byteIndex++) {
    if (offset >= buf.length) throw new Error(`truncated varint at offset ${start}`);
    const byte = buf[offset];
    if (byte === undefined) throw new Error(`truncated varint at offset ${start}`);
    offset++;
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, next: offset };
    shift += 7n;
  }
  throw new Error(`varint is longer than ${MAX_VARINT_BYTES} bytes at offset ${start}`);
}

function readFixed(buf: Uint8Array, offset: number, size: number): { value: bigint; next: number } {
  if (offset + size > buf.length) {
    throw new Error(`truncated fixed${size * 8} at offset ${offset}`);
  }
  let value = 0n;
  for (let index = 0; index < size; index++) {
    const byte = buf[offset + index];
    if (byte === undefined) throw new Error(`truncated fixed${size * 8} at offset ${offset}`);
    value |= BigInt(byte) << BigInt(index * 8);
  }
  return { value, next: offset + size };
}

function readBytes(buf: Uint8Array, offset: number, length: bigint): { bytes: Uint8Array; next: number } {
  if (length > BigInt(buf.length - offset)) {
    throw new Error(`truncated length-delimited field at offset ${offset}`);
  }
  const size = Number(length);
  const bytes = new Uint8Array(size);
  bytes.set(buf.subarray(offset, offset + size));
  return { bytes, next: offset + size };
}

function writeField(writer: Writer, field: ProtoField): void {
  if (field.wire !== 0 && field.wire !== 1 && field.wire !== 2 && field.wire !== 5) {
    throw new Error(`unsupported wire type ${String(field.wire)}`);
  }
  writer.varint((BigInt(field.field) << 3n) | BigInt(field.wire));
  switch (field.wire) {
    case 0:
      writer.varint(requiredNumber(field));
      break;
    case 1:
      writer.fixed(requiredNumber(field), 8);
      break;
    case 2: {
      const bytes = requiredBytes(field);
      writer.varint(BigInt(bytes.length));
      writer.raw(bytes);
      break;
    }
    case 5:
      writer.fixed(requiredNumber(field), 4);
      break;
    default:
      break;
  }
}

function requiredNumber(field: ProtoField): bigint {
  if (field.number === undefined) {
    throw new Error(`field ${field.field} wire ${field.wire} is missing number`);
  }
  if (field.number < 0n) {
    throw new Error(`field ${field.field} wire ${field.wire} has a negative number`);
  }
  return field.number;
}

function requiredBytes(field: ProtoField): Uint8Array {
  if (field.bytes === undefined) throw new Error(`field ${field.field} is missing bytes`);
  return field.bytes;
}

class Writer {
  private readonly chunks: Uint8Array[] = [];
  private size = 0;

  varint(value: bigint): void {
    if (value < 0n) throw new Error("negative varint");
    const bytes: number[] = [];
    let rest = value;
    do {
      let byte = Number(rest & 0x7fn);
      rest >>= 7n;
      if (rest !== 0n) byte |= 0x80;
      bytes.push(byte);
    } while (rest !== 0n);
    this.raw(Uint8Array.from(bytes));
  }

  fixed(value: bigint, size: number): void {
    const bytes = new Uint8Array(size);
    let rest = value;
    for (let index = 0; index < size; index++) {
      bytes[index] = Number(rest & 0xffn);
      rest >>= 8n;
    }
    this.raw(bytes);
  }

  raw(bytes: Uint8Array): void {
    if (bytes.length === 0) return;
    this.chunks.push(bytes);
    this.size += bytes.length;
  }

  finish(): Uint8Array {
    const out = new Uint8Array(this.size);
    let offset = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    return out;
  }
}
