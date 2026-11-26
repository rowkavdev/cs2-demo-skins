import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

function run(args: string[]): { status: number | null; stdout: string; stderr: string } {
  const result = spawnSync(process.execPath, ["--experimental-strip-types", "--import", "./scripts/register-ts.mjs", "src/cli.ts", ...args], {
    encoding: "utf8",
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe("cs2skin", () => {
  it("lists the AK-47", () => {
    const result = run(["weapons"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("AK-47");
  });

  it("finds Howl by search", () => {
    const result = run(["paints", "--search", "howl"]);
    expect(result.status).toBe(0);
    expect(result.stdout).toContain("Howl");
  });
});
