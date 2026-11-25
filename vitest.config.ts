import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // One file at a time, one worker. Keeps a full run from stacking
    // Node processes on top of the agents that are still writing.
    fileParallelism: false,
    maxWorkers: 1,
    minWorkers: 1,
  },
});
