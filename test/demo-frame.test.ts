import { describe, expect, it } from "vitest";
import {
  DEM_FILE_INFO,
  DEM_IS_COMPRESSED,
  DEM_PACKET,
  DEM_SIGNON_PACKET,
  DEM_SPAWN_GROUPS,
  DEM_STOP,
  DEMO_MAGIC,
  type DemoFile,
} from "../src/contract.js";
import { readDemo, writeDemo } from "../src/demo/frame.js";

const HEADER_SIZE = 16;

function u32(buf: Uint8Array, offset: number): number {
  return new DataView(buf.buffer, buf.byteOffset, buf.byteLength).getUint32(offset, true);
}

function readVarint(buf: Uint8Array, offset: number): { value: number; next: number } {
  let value = 0n;
  let shift = 0n;
  const start = offset;
  for (let count = 0; count < 10; count++) {
    const byte = buf[offset];
    if (byte === undefined) throw new Error(`truncated varint at offset ${start}`);
    offset++;
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value: Number(value), next: offset };
    shift += 7n;
  }
  throw new Error(`varint is too long at offset ${start}`);
}

function walk(buf: Uint8Array): Array<{ offset: number; command: number; compressed: boolean; size: number }> {
  const commands = [];
  let offset = HEADER_SIZE;
  while (offset < buf.length) {
    const start = offset;
    const id = readVarint(buf, offset);
    const tick = readVarint(buf, id.next);
    const size = readVarint(buf, tick.next);
    if (size.next + size.value > buf.length) throw new Error("truncated command body");
    commands.push({
      offset: start,
      command: id.value - (id.value & DEM_IS_COMPRESSED),
      compressed: (id.value & DEM_IS_COMPRESSED) !== 0,
      size: size.value,
    });
    offset = size.next + size.value;
  }
  expect(offset).toBe(buf.length);
  return commands;
}

describe("demo frame", () => {
  it("round-trips commands, compresses only when smaller, and patches header offsets", () => {
    const repetitive = new Uint8Array(256).fill(0x61);
    const tiny = Uint8Array.of(0x10, 0x20, 0x30);
    const file: DemoFile = {
      commands: [
        { command: DEM_SIGNON_PACKET, compressed: true, tick: -1, body: tiny },
        { command: DEM_FILE_INFO, compressed: false, tick: 0, body: repetitive },
        { command: DEM_FILE_INFO, compressed: true, tick: 1, body: Uint8Array.of(0x09) },
        { command: DEM_PACKET, compressed: true, tick: 2147483647, body: Uint8Array.of(1, 2, 3, 4, 5) },
        { command: DEM_SPAWN_GROUPS, compressed: true, tick: -2147483648, body: Uint8Array.of(4, 5, 6) },
        { command: DEM_STOP, compressed: true, tick: 100, body: new Uint8Array() },
      ],
    };

    const bytes = writeDemo(file);
    expect(bytes.subarray(0, 8)).toEqual(new TextEncoder().encode(DEMO_MAGIC));
    // Signon is one command byte, zigzag(-1) = 1, a 1-byte size, and 3 body bytes.
    expect(Array.from(bytes.subarray(16, 22))).toEqual([DEM_SIGNON_PACKET, 1, tiny.length, ...tiny]);
    expect(u32(bytes, 8)).toBe(22);
    expect(bytes[22]).toBe(DEM_FILE_INFO | DEM_IS_COMPRESSED);

    const wire = walk(bytes);
    const fileInfos = wire.filter((command) => command.command === DEM_FILE_INFO);
    expect(fileInfos.map((command) => command.offset)[0]).toBe(22);
    expect(fileInfos).toHaveLength(2);
    expect(fileInfos[0]?.compressed).toBe(true);
    expect(fileInfos[0]?.size).toBeLessThan(repetitive.length);
    expect(fileInfos[1]?.compressed).toBe(false);
    expect(fileInfos[1]?.size).toBe(1);
    expect(u32(bytes, 8)).toBe(fileInfos[0]?.offset);
    expect(u32(bytes, 8)).not.toBe(fileInfos[1]?.offset);

    const spawn = wire.find((command) => command.command === DEM_SPAWN_GROUPS);
    expect(spawn).toBeDefined();
    expect(u32(bytes, 12)).toBe(spawn?.offset);
    expect(bytes[u32(bytes, 12)]).toBe(DEM_SPAWN_GROUPS);
    expect(wire[0]?.compressed).toBe(false);
    expect(wire[0]?.size).toBe(tiny.length);

    const round = readDemo(bytes);
    expect(round.commands.map((command) => command.command)).toEqual(file.commands.map((command) => command.command));
    expect(round.commands.map((command) => command.tick)).toEqual(file.commands.map((command) => command.tick));
    expect(round.commands.map((command) => Array.from(command.body))).toEqual(
      file.commands.map((command) => Array.from(command.body)),
    );
    expect(round.commands.map((command) => command.compressed)).toEqual([false, true, false, false, false, false]);
    expect(round.commands[1]?.body).toEqual(repetitive);
  });

  it("points the file-info offset at the first matching command", () => {
    const bytes = writeDemo({
      commands: [
        { command: DEM_FILE_INFO, compressed: false, tick: 3, body: Uint8Array.of(1) },
        { command: DEM_FILE_INFO, compressed: false, tick: 4, body: Uint8Array.of(2) },
      ],
    });
    expect(u32(bytes, 8)).toBe(16);
    expect(bytes[16]).toBe(DEM_FILE_INFO);
    expect(bytes[20]).toBe(DEM_FILE_INFO);
    expect(u32(bytes, 12)).toBe(0);
    const round = readDemo(bytes);
    expect(round.commands.map((command) => command.tick)).toEqual([3, 4]);
    expect(round.commands.map((command) => Array.from(command.body))).toEqual([[1], [2]]);
  });

  it("leaves both header offsets at 0 when those commands are absent", () => {
    const empty = writeDemo({ commands: [] });
    expect(empty).toHaveLength(HEADER_SIZE);
    expect(empty.subarray(0, 8)).toEqual(new TextEncoder().encode(DEMO_MAGIC));
    expect(u32(empty, 8)).toBe(0);
    expect(u32(empty, 12)).toBe(0);
    expect(readDemo(empty)).toEqual({ commands: [] });

    const bytes = writeDemo({
      commands: [{ command: DEM_STOP, compressed: false, tick: 0, body: new Uint8Array() }],
    });
    expect(u32(bytes, 8)).toBe(0);
    expect(u32(bytes, 12)).toBe(0);
    expect(readDemo(bytes).commands).toEqual([
      { command: DEM_STOP, compressed: false, tick: 0, body: new Uint8Array() },
    ]);
  });
});
