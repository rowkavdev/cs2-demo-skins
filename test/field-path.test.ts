import { describe, expect, it } from "vitest";
import { BitReader } from "../src/bits/bit-reader.js";
import { decodeFieldPaths, encodeFieldPaths, stepFieldPath } from "../src/entity/field-path.js";
import type { FieldPath } from "../src/contract.js";

function roundTrip(paths: FieldPath[]): void {
  const encoded = encodeFieldPaths(paths);
  const decoded = decodeFieldPaths(new BitReader(encoded.bytes));
  expect(decoded.paths).toEqual(paths);
  expect(decoded.endBit).toBe(encoded.bitLength);
  expect(decoded.finishBitStart).toBeLessThan(decoded.endBit);
}

describe("field paths", () => {
  it("round-trips a single component", () => {
    roundTrip([[0]]);
  });

  it("round-trips a rising chain", () => {
    roundTrip([[0], [1], [2]]);
  });

  it("round-trips a nested change and a pop", () => {
    roundTrip([[3, 0], [3, 1], [4]]);
  });

  it("round-trips a jump larger than four", () => {
    roundTrip([[0], [7]]);
  });

  it("steps a same-depth change and a shallower path in one op", () => {
    expect(stepFieldPath([3, 0], [3, 1])).not.toBeNull();
    expect(stepFieldPath([3, 1], [4])).not.toBeNull();
    expect(stepFieldPath([-1], [3, 0])).not.toBeNull();
  });

  it("refuses a deeper path that would decrease an existing component", () => {
    expect(stepFieldPath([3, 1], [2, 0, 0])).toBeNull();
  });
});
