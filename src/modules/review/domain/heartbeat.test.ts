import { describe, expect, it } from "vitest";
import { heartbeatState } from "./heartbeat";

const STALE = 300;

describe("heartbeatState", () => {
  it("is ok up to 60 seconds", () => {
    expect(heartbeatState(0, STALE)).toBe("ok");
    expect(heartbeatState(60, STALE)).toBe("ok");
  });

  it("warns above 60 seconds up to the stale threshold", () => {
    expect(heartbeatState(61, STALE)).toBe("warning");
    expect(heartbeatState(300, STALE)).toBe("warning");
  });

  it("is critical above the stale threshold or when no worker ever wrote one", () => {
    expect(heartbeatState(301, STALE)).toBe("critical");
    expect(heartbeatState(null, STALE)).toBe("critical");
  });

  it("takes the threshold as given", () => {
    expect(heartbeatState(120, 120)).toBe("warning");
    expect(heartbeatState(121, 120)).toBe("critical");
  });
});
