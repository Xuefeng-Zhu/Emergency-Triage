import { describe, expect, it } from "vitest";
import {
  analyses,
  jobs,
  recordingChunks,
  recordings,
  transcripts,
} from "../src/schema";

describe("database schema", () => {
  it("exports the durable workflow tables", () => {
    expect(recordings).toBeDefined();
    expect(recordingChunks).toBeDefined();
    expect(transcripts).toBeDefined();
    expect(analyses).toBeDefined();
    expect(jobs).toBeDefined();
  });
});
