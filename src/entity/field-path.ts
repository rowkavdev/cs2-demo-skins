import { BitReader } from "../bits/bit-reader.js";
import { BitWriter } from "../bits/bit-writer.js";
import {
  readBitVarS32,
  readUBitVar,
  readUBitVarFieldPath,
  writeBitVarS32,
  writeUBitVar,
  writeUBitVarFieldPath,
} from "../bits/ubit.js";
import { FIELD_PATH_OP, FIELD_PATH_WEIGHTS } from "../contract.js";
import type { BitSlice, FieldPath } from "../contract.js";

const MAX_DEPTH = 7;
const FINISH = FIELD_PATH_OP.finish;

type Node = {
  weight: number;
  value: number;
  left: Node | null;
  right: Node | null;
};

type Cursor = {
  path: number[];
  last: number;
};

/**
 * Go container/heap order: smaller weight first, and on a tie the higher
 * value first. Zero weights are stored as 1. Internal values start at 40.
 * The first pop is the left child (bit 0) and the second is the right (bit 1).
 */
function buildTree(): Node {
  const pending: Node[] = FIELD_PATH_WEIGHTS.map((weight, value) => ({
    weight: weight === 0 ? 1 : weight,
    value,
    left: null,
    right: null,
  }));
  let nextValue = 40;
  while (pending.length > 1) {
    const left = takeMin(pending);
    const right = takeMin(pending);
    pending.push({
      weight: left.weight + right.weight,
      value: nextValue,
      left,
      right,
    });
    nextValue++;
  }
  return pending[0];
}

function isLess(a: Node, b: Node): boolean {
  if (a.weight !== b.weight) return a.weight < b.weight;
  return a.value >= b.value;
}

function takeMin(nodes: Node[]): Node {
  let best = 0;
  for (let i = 1; i < nodes.length; i++) {
    if (isLess(nodes[i], nodes[best])) best = i;
  }
  return nodes.splice(best, 1)[0];
}

const ROOT = buildTree();
const CODES: number[][] = Array.from({ length: FIELD_PATH_WEIGHTS.length }, () => []);

function collectCodes(node: Node, prefix: number[]): void {
  if (!node.left && !node.right) {
    CODES[node.value] = prefix.slice();
    return;
  }
  if (node.left) collectCodes(node.left, [...prefix, 0]);
  if (node.right) collectCodes(node.right, [...prefix, 1]);
}

collectCodes(ROOT, []);

function readOp(reader: BitReader): number {
  let node = ROOT;
  while (node.left || node.right) {
    const bit = reader.readBit();
    const next = bit === 1 ? node.right : node.left;
    if (!next) throw new Error("field-path Huffman walk left the tree");
    node = next;
  }
  return node.value;
}

function writeOp(writer: BitWriter, op: number): void {
  const code = CODES[op];
  if (!code || code.length === 0) throw new Error(`no Huffman code for field-path op ${op}`);
  for (const bit of code) writer.writeBit(bit);
}

function freshCursor(): Cursor {
  return { path: [-1, 0, 0, 0, 0, 0, 0], last: 0 };
}

function snapshot(cursor: Cursor): FieldPath {
  return cursor.path.slice(0, cursor.last + 1);
}

function pushSlot(cursor: Cursor): void {
  cursor.last++;
  if (cursor.last >= MAX_DEPTH) throw new RangeError("field path is deeper than 7");
}

function popSlots(cursor: Cursor, count: number): void {
  if (!Number.isInteger(count) || count < 0 || count > cursor.last) {
    throw new RangeError(`field path pop ${count} from depth ${cursor.last + 1}`);
  }
  for (let i = 0; i < count; i++) {
    cursor.path[cursor.last] = 0;
    cursor.last--;
  }
}

function applyOp(cursor: Cursor, op: number, reader: BitReader): void {
  const path = cursor.path;
  switch (op) {
    case FIELD_PATH_OP.plusOne:
      path[cursor.last] += 1;
      return;
    case FIELD_PATH_OP.plusTwo:
      path[cursor.last] += 2;
      return;
    case FIELD_PATH_OP.plusThree:
      path[cursor.last] += 3;
      return;
    case FIELD_PATH_OP.plusFour:
      path[cursor.last] += 4;
      return;
    case FIELD_PATH_OP.plusN:
      path[cursor.last] += readUBitVarFieldPath(reader) + 5;
      return;
    case FIELD_PATH_OP.pushOneLeftDeltaZeroRightZero:
      pushSlot(cursor);
      path[cursor.last] = 0;
      return;
    case FIELD_PATH_OP.pushOneLeftDeltaZeroRightNonZero:
      pushSlot(cursor);
      path[cursor.last] = readUBitVarFieldPath(reader);
      return;
    case FIELD_PATH_OP.pushOneLeftDeltaOneRightZero:
      path[cursor.last] += 1;
      pushSlot(cursor);
      path[cursor.last] = 0;
      return;
    case FIELD_PATH_OP.pushOneLeftDeltaOneRightNonZero:
      path[cursor.last] += 1;
      pushSlot(cursor);
      path[cursor.last] = readUBitVarFieldPath(reader);
      return;
    case FIELD_PATH_OP.pushOneLeftDeltaNRightZero:
      path[cursor.last] += readUBitVarFieldPath(reader);
      pushSlot(cursor);
      path[cursor.last] = 0;
      return;
    case FIELD_PATH_OP.pushOneLeftDeltaNRightNonZero:
      path[cursor.last] += readUBitVarFieldPath(reader) + 2;
      pushSlot(cursor);
      path[cursor.last] = readUBitVarFieldPath(reader) + 1;
      return;
    case FIELD_PATH_OP.pushOneLeftDeltaNRightNonZeroPack6Bits:
      path[cursor.last] += reader.readBits(3) + 2;
      pushSlot(cursor);
      path[cursor.last] = reader.readBits(3) + 1;
      return;
    case FIELD_PATH_OP.pushOneLeftDeltaNRightNonZeroPack8Bits:
      path[cursor.last] += reader.readBits(4) + 2;
      pushSlot(cursor);
      path[cursor.last] = reader.readBits(4) + 1;
      return;
    case FIELD_PATH_OP.pushTwoLeftDeltaZero:
      pushSlot(cursor);
      path[cursor.last] += readUBitVarFieldPath(reader);
      pushSlot(cursor);
      path[cursor.last] += readUBitVarFieldPath(reader);
      return;
    case FIELD_PATH_OP.pushTwoPack5LeftDeltaZero:
      pushSlot(cursor);
      path[cursor.last] = reader.readBits(5);
      pushSlot(cursor);
      path[cursor.last] = reader.readBits(5);
      return;
    case FIELD_PATH_OP.pushThreeLeftDeltaZero:
      pushSlot(cursor);
      path[cursor.last] += readUBitVarFieldPath(reader);
      pushSlot(cursor);
      path[cursor.last] += readUBitVarFieldPath(reader);
      pushSlot(cursor);
      path[cursor.last] += readUBitVarFieldPath(reader);
      return;
    case FIELD_PATH_OP.pushThreePack5LeftDeltaZero:
      pushSlot(cursor);
      path[cursor.last] = reader.readBits(5);
      pushSlot(cursor);
      path[cursor.last] = reader.readBits(5);
      pushSlot(cursor);
      path[cursor.last] = reader.readBits(5);
      return;
    case FIELD_PATH_OP.pushTwoLeftDeltaOne:
      path[cursor.last] += 1;
      pushSlot(cursor);
      path[cursor.last] += readUBitVarFieldPath(reader);
      pushSlot(cursor);
      path[cursor.last] += readUBitVarFieldPath(reader);
      return;
    case FIELD_PATH_OP.pushTwoPack5LeftDeltaOne:
      path[cursor.last] += 1;
      pushSlot(cursor);
      path[cursor.last] += reader.readBits(5);
      pushSlot(cursor);
      path[cursor.last] += reader.readBits(5);
      return;
    case FIELD_PATH_OP.pushThreeLeftDeltaOne:
      path[cursor.last] += 1;
      pushSlot(cursor);
      path[cursor.last] += readUBitVarFieldPath(reader);
      pushSlot(cursor);
      path[cursor.last] += readUBitVarFieldPath(reader);
      pushSlot(cursor);
      path[cursor.last] += readUBitVarFieldPath(reader);
      return;
    case FIELD_PATH_OP.pushThreePack5LeftDeltaOne:
      path[cursor.last] += 1;
      pushSlot(cursor);
      path[cursor.last] += reader.readBits(5);
      pushSlot(cursor);
      path[cursor.last] += reader.readBits(5);
      pushSlot(cursor);
      path[cursor.last] += reader.readBits(5);
      return;
    case FIELD_PATH_OP.pushTwoLeftDeltaN:
      path[cursor.last] += readUBitVar(reader) + 2;
      pushSlot(cursor);
      path[cursor.last] += readUBitVarFieldPath(reader);
      pushSlot(cursor);
      path[cursor.last] += readUBitVarFieldPath(reader);
      return;
    case FIELD_PATH_OP.pushTwoPack5LeftDeltaN:
      path[cursor.last] += readUBitVar(reader) + 2;
      pushSlot(cursor);
      path[cursor.last] += reader.readBits(5);
      pushSlot(cursor);
      path[cursor.last] += reader.readBits(5);
      return;
    case FIELD_PATH_OP.pushThreeLeftDeltaN:
      path[cursor.last] += readUBitVar(reader) + 2;
      pushSlot(cursor);
      path[cursor.last] += readUBitVarFieldPath(reader);
      pushSlot(cursor);
      path[cursor.last] += readUBitVarFieldPath(reader);
      pushSlot(cursor);
      path[cursor.last] += readUBitVarFieldPath(reader);
      return;
    case FIELD_PATH_OP.pushThreePack5LeftDeltaN:
      path[cursor.last] += readUBitVar(reader) + 2;
      pushSlot(cursor);
      path[cursor.last] += reader.readBits(5);
      pushSlot(cursor);
      path[cursor.last] += reader.readBits(5);
      pushSlot(cursor);
      path[cursor.last] += reader.readBits(5);
      return;
    case FIELD_PATH_OP.pushN: {
      const count = readUBitVar(reader);
      path[cursor.last] += readUBitVar(reader);
      for (let i = 0; i < count; i++) {
        pushSlot(cursor);
        path[cursor.last] += readUBitVarFieldPath(reader);
      }
      return;
    }
    case FIELD_PATH_OP.pushNAndNonTopological: {
      for (let i = 0; i <= cursor.last; i++) {
        if (reader.readBoolean()) path[i] += readBitVarS32(reader) + 1;
      }
      const count = readUBitVar(reader);
      for (let i = 0; i < count; i++) {
        pushSlot(cursor);
        path[cursor.last] = readUBitVarFieldPath(reader);
      }
      return;
    }
    case FIELD_PATH_OP.popOnePlusOne:
      popSlots(cursor, 1);
      path[cursor.last] += 1;
      return;
    case FIELD_PATH_OP.popOnePlusN:
      popSlots(cursor, 1);
      path[cursor.last] += readUBitVarFieldPath(reader) + 1;
      return;
    case FIELD_PATH_OP.popAllButOnePlusOne:
      popSlots(cursor, cursor.last);
      path[0] += 1;
      return;
    case FIELD_PATH_OP.popAllButOnePlusN:
      popSlots(cursor, cursor.last);
      path[0] += readUBitVarFieldPath(reader) + 1;
      return;
    case FIELD_PATH_OP.popAllButOnePlusNPack3Bits:
      popSlots(cursor, cursor.last);
      path[0] += reader.readBits(3) + 1;
      return;
    case FIELD_PATH_OP.popAllButOnePlusNPack6Bits:
      popSlots(cursor, cursor.last);
      path[0] += reader.readBits(6) + 1;
      return;
    case FIELD_PATH_OP.popNPlusOne:
      popSlots(cursor, readUBitVarFieldPath(reader));
      path[cursor.last] += 1;
      return;
    case FIELD_PATH_OP.popNPlusN:
      popSlots(cursor, readUBitVarFieldPath(reader));
      path[cursor.last] += readBitVarS32(reader);
      return;
    case FIELD_PATH_OP.popNAndNonTopographical:
      popSlots(cursor, readUBitVarFieldPath(reader));
      for (let i = 0; i <= cursor.last; i++) {
        if (reader.readBoolean()) path[i] += readBitVarS32(reader);
      }
      return;
    case FIELD_PATH_OP.nonTopoComplex:
      for (let i = 0; i <= cursor.last; i++) {
        if (reader.readBoolean()) path[i] += readBitVarS32(reader);
      }
      return;
    case FIELD_PATH_OP.nonTopoPenultimatePlusOne:
      if (cursor.last < 1) return;
      path[cursor.last - 1] += 1;
      return;
    case FIELD_PATH_OP.nonTopoComplexPack4Bits:
      for (let i = 0; i <= cursor.last; i++) {
        if (reader.readBoolean()) path[i] += reader.readBits(4) - 7;
      }
      return;
    default:
      throw new Error(`unknown field-path op ${op}`);
  }
}

function sliceOf(writer: BitWriter): BitSlice {
  return { bytes: writer.toUint8Array(), bitLength: writer.bitLength };
}

function writeSameDepth(writer: BitWriter, from: FieldPath, to: FieldPath): void {
  const delta = to[to.length - 1] - from[from.length - 1];
  const onlyLast = from.slice(0, -1).every((value, index) => value === to[index]);
  if (onlyLast && delta > 0) {
    if (delta === 1) {
      writeOp(writer, FIELD_PATH_OP.plusOne);
      return;
    }
    if (delta === 2) {
      writeOp(writer, FIELD_PATH_OP.plusTwo);
      return;
    }
    if (delta === 3) {
      writeOp(writer, FIELD_PATH_OP.plusThree);
      return;
    }
    if (delta === 4) {
      writeOp(writer, FIELD_PATH_OP.plusFour);
      return;
    }
    writeOp(writer, FIELD_PATH_OP.plusN);
    writeUBitVarFieldPath(writer, delta - 5);
    return;
  }
  writeOp(writer, FIELD_PATH_OP.nonTopoComplex);
  for (let i = 0; i < from.length; i++) {
    const change = to[i] - from[i];
    if (change === 0) {
      writer.writeBit(0);
    } else {
      writer.writeBit(1);
      writeBitVarS32(writer, change);
    }
  }
}

function writeShallower(writer: BitWriter, from: FieldPath, to: FieldPath): void {
  writeOp(writer, FIELD_PATH_OP.popNAndNonTopographical);
  writeUBitVarFieldPath(writer, from.length - to.length);
  for (let i = 0; i < to.length; i++) {
    const change = to[i] - from[i];
    if (change === 0) {
      writer.writeBit(0);
    } else {
      writer.writeBit(1);
      writeBitVarS32(writer, change);
    }
  }
}

function writeDeeper(writer: BitWriter, from: FieldPath, to: FieldPath): boolean {
  for (let i = 0; i < from.length; i++) {
    if (to[i] < from[i]) return false;
  }
  for (let i = from.length; i < to.length; i++) {
    if (to[i] < 0) return false;
  }
  const added = to.length - from.length;
  const prefixStable = from.slice(0, -1).every((value, index) => value === to[index]);
  if (prefixStable) {
    writeOp(writer, FIELD_PATH_OP.pushN);
    writeUBitVar(writer, added);
    writeUBitVar(writer, to[from.length - 1] - from[from.length - 1]);
    for (let i = from.length; i < to.length; i++) writeUBitVarFieldPath(writer, to[i]);
    return true;
  }
  writeOp(writer, FIELD_PATH_OP.pushNAndNonTopological);
  for (let i = 0; i < from.length; i++) {
    const change = to[i] - from[i];
    if (change === 0) {
      writer.writeBit(0);
    } else {
      writer.writeBit(1);
      writeBitVarS32(writer, change - 1);
    }
  }
  writeUBitVar(writer, added);
  for (let i = from.length; i < to.length; i++) writeUBitVarFieldPath(writer, to[i]);
  return true;
}

/** One operation from `from` to `to`, or null when no single op can do it. */
export function stepFieldPath(from: FieldPath, to: FieldPath): BitSlice | null {
  if (from.length === 0 || to.length === 0 || to.length > MAX_DEPTH) return null;
  const writer = new BitWriter();
  if (to.length === from.length) {
    writeSameDepth(writer, from, to);
  } else if (to.length < from.length) {
    writeShallower(writer, from, to);
  } else if (!writeDeeper(writer, from, to)) {
    return null;
  }
  return sliceOf(writer);
}

export function decodeFieldPaths(reader: BitReader): {
  paths: FieldPath[];
  finishBitStart: number;
  endBit: number;
} {
  const cursor = freshCursor();
  const paths: FieldPath[] = [];
  for (;;) {
    const start = reader.bitPos;
    const op = readOp(reader);
    if (op === FINISH) {
      return { paths, finishBitStart: start, endBit: reader.bitPos };
    }
    applyOp(cursor, op, reader);
    paths.push(snapshot(cursor));
  }
}

export function encodeFieldPaths(paths: FieldPath[]): BitSlice {
  const writer = new BitWriter();
  let cursor: FieldPath = [-1];
  for (const next of paths) {
    const step = stepFieldPath(cursor, next);
    if (!step) throw new Error(`cannot encode field path ${next.join("/")} from ${cursor.join("/")}`);
    writer.writeSlice(step);
    cursor = next.slice();
  }
  writeOp(writer, FINISH);
  return sliceOf(writer);
}
