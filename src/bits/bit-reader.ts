import type { BitSlice } from "../contract.js";

/** Source 2 bitstream: the least significant bit of each byte is read first. */
export class BitReader {
  bitPos = 0;
  readonly #data: Uint8Array;

  constructor(data: Uint8Array) {
    this.#data = data;
  }

  get byteLength(): number {
    return this.#data.length;
  }

  remainingBits(): number {
    return this.#data.length * 8 - this.bitPos;
  }

  readBit(): number {
    this.#need(1);
    return this.#nextBit();
  }

  /** Unsigned. `n` is 0..32. */
  readBits(n: number): number {
    this.#checkCount(n, 32, "readBits");
    this.#need(n);
    let result = 0;
    let place = 1;
    for (let i = 0; i < n; i++) {
      if (this.#nextBit()) result += place;
      place += place;
    }
    return result;
  }

  /** Unsigned. `n` is 0..64. */
  readBits64(n: number): bigint {
    this.#checkCount(n, 64, "readBits64");
    this.#need(n);
    let result = 0n;
    for (let i = 0; i < n; i++) {
      if (this.#nextBit()) result |= 1n << BigInt(i);
    }
    return result;
  }

  readBoolean(): boolean {
    return this.readBit() === 1;
  }

  /** `n` bytes, assembled LSB-first. The read may start mid-byte. */
  readBytes(n: number): Uint8Array {
    if (!Number.isInteger(n) || n < 0) throw new RangeError(`readBytes(${n})`);
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = this.readBits(8);
    return out;
  }

  peekBits(n: number): number {
    const saved = this.bitPos;
    try {
      return this.readBits(n);
    } finally {
      this.bitPos = saved;
    }
  }

  skipBits(n: number): void {
    if (!Number.isInteger(n) || n < 0) throw new RangeError(`skipBits(${n})`);
    this.#need(n);
    this.bitPos += n;
  }

  /** Bits in `[start, end)`, repacked LSB-first. Does not move `bitPos`. */
  sliceBits(start: number, end: number): BitSlice {
    const total = this.#data.length * 8;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || end > total) {
      throw new RangeError(`sliceBits(${start}, ${end})`);
    }
    const bitLength = end - start;
    const bytes = new Uint8Array((bitLength + 7) >>> 3);
    for (let i = 0; i < bitLength; i++) {
      const at = start + i;
      const bit = (this.#data[at >>> 3] >>> (at & 7)) & 1;
      if (bit) bytes[i >>> 3] |= 1 << (i & 7);
    }
    return { bytes, bitLength };
  }

  #nextBit(): number {
    const at = this.bitPos++;
    return (this.#data[at >>> 3] >>> (at & 7)) & 1;
  }

  #need(n: number): void {
    if (this.bitPos < 0 || this.bitPos + n > this.#data.length * 8) {
      throw new RangeError(
        `bitstream overflow at bit ${this.bitPos}, need ${n}, remaining ${this.remainingBits()}`,
      );
    }
  }

  #checkCount(n: number, max: number, name: string): void {
    if (!Number.isInteger(n) || n < 0 || n > max) throw new RangeError(`${name}(${n})`);
  }
}
