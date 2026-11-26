import { describe, expect, it } from "vitest";
import { parseDemoTime } from "../src/time/parse.js";

const clock = { startTick: 100, tickInterval: 1 / 64 };

describe("parseDemoTime", () => {
  it("reads absolute ticks", () => {
    expect(parseDemoTime("#12345", clock)).toBe(12345);
    expect(parseDemoTime("tick:12345", clock)).toBe(12345);
  });

  it("reads clock times and seconds from the start", () => {
    expect(parseDemoTime("1:23", clock)).toBe(100 + Math.round(83 / (1 / 64)));
    expect(parseDemoTime("1:23.5", clock)).toBe(100 + Math.round(83.5 / (1 / 64)));
    expect(parseDemoTime("90", clock)).toBe(100 + 90 * 64);
    expect(parseDemoTime("90s", clock)).toBe(100 + 90 * 64);
  });

  it("rejects empty and negative times", () => {
    expect(() => parseDemoTime("  ", clock)).toThrow(/empty/);
    expect(() => parseDemoTime("#-5", clock)).toThrow(/negative/);
  });
});
