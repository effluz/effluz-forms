import { describe, expect, it } from "vitest";
import { acceptedType, extensionFor } from "./media";

describe("acceptedType", () => {
  it("accepts the documented types only", () => {
    expect(acceptedType("image/heif")).toBe("image/heif");
    expect(acceptedType("video/quicktime")).toBe("video/quicktime");
    expect(acceptedType("image/gif")).toBeNull();
    expect(acceptedType(null)).toBeNull();
  });
});

describe("extensionFor", () => {
  it("names each type's extension, HEIF as heic", () => {
    expect(extensionFor("image/heif")).toBe("heic");
    expect(extensionFor("video/quicktime")).toBe("mov");
    expect(() => extensionFor("text/html")).toThrow();
  });
});
