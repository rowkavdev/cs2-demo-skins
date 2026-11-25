import type { BitSlice } from "../contract.js";

/** Source 2 bitstream: the least significant bit of each byte is written first. */
export class BitWriter {
  #buf = new Uint8Array(64);
  #pos = 0;

  get bitLength(): number {
    return this.#pos;
  }

  writeBit(bit: number): void {
    const index = this.#pos >>> 3;
    this.#ensure(index);
    if ((bit & 1) !== 0) this.#buf[index] |= 1 << (this.#pos & 7);
    this.#pos++;
  }

  /** Writes the low `n` bits of `value`, least significant bit first. `n` is 0..32. */
  writeBits(n: number, value: number): void {
    this.#checkCount(n, 32, "writeBits");
    let v = value >>> 0;
    for (let i = 0; i < n; i++) {
      this.writeBit(v & 1);
      v >>>= 1;
    }
  }

  /** Writes the low `n` bits of `value`, least significant bit first. `n` is 0..64. */
  writeBits64(n: number, value: bigint): void {
    this.#checkCount(n, 64, "writeBits64");
    if (typeof value !== "bigint") throw new TypeError("writeBits64 value must be a bigint");
    for (let i = 0; i < n; i++) this.writeBit(Number((value >> BigInt(i)) & 1n));
  }

  writeBoolean(value: boolean): void {
    this.writeBit(value ? 1 : 0);
  }

  writeBytes(data: Uint8Array): void {
    for (let i = 0; i < data.length; i++) this.writeBits(8, data[i]);
  }

  writeSlice(slice: BitSlice): void {
    const { bytes, bitLength } = slice;
    if (!Number.isInteger(bitLength) || bitLength < 0) throw new RangeError("writeSlice");
    for (let i = 0; i < bitLength; i++) {
      const index = i >>> 3;
      if (index >= bytes.length) throw new RangeError("writeSlice short");
      this.writeBit((bytes[index] >>> (i & 7)) & 1);
    }
  }

  /** Zero-pads the tail of the last byte. */
  toUint8Array(): Uint8Array {
    return this.#buf.slice(0, (this.#pos + 7) >>> 3);
  }

  #ensure(byteIndex: number): void {
    if (byteIndex < this.#buf.length) return;
    let size = this.#buf.length;
    while (byteIndex >= size) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.#buf);
    this.#buf = next;
  }

  #checkCount(n: number, max: number, name: string): void {
    if (!Number.isInteger(n) || n < 0 || n > max) throw new RangeError(`${name}(${n})`);
  }
}
