/** Absolute demo tick. `#` and `tick:` are absolute. Everything else is seconds from the start. */
export function parseDemoTime(text: string, ctx: { startTick: number; tickInterval: number }): number {
  const trimmed = text.trim();
  if (!trimmed) throw new Error("empty demo time");
  const tick = absoluteTick(trimmed, ctx);
  if (!Number.isInteger(tick)) throw new Error(`bad demo time ${text}`);
  if (tick < 0) throw new Error(`negative demo time ${text}`);
  return tick;
}

function absoluteTick(text: string, ctx: { startTick: number; tickInterval: number }): number {
  if (text.startsWith("#")) return Number(text.slice(1));
  if (text.startsWith("tick:")) return Number(text.slice(5));
  if (text.includes(":")) {
    const split = text.split(":");
    const minutes = Number(split[0]);
    const seconds = Number(split[1]);
    if (split.length !== 2 || !Number.isFinite(minutes) || !Number.isFinite(seconds)) {
      throw new Error(`bad demo time ${text}`);
    }
    return ctx.startTick + Math.round((minutes * 60 + seconds) / ctx.tickInterval);
  }
  const seconds = text.endsWith("s") ? Number(text.slice(0, -1)) : Number(text);
  if (!Number.isFinite(seconds)) throw new Error(`bad demo time ${text}`);
  return ctx.startTick + Math.round(seconds / ctx.tickInterval);
}
