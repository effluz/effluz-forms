import { describe, expect, it } from "vitest";
import {
  acceptAttribute,
  formatBytes,
  formatInstant,
  formatIsoDate,
  formatMegabytes,
  formatNumber,
  kindsKey,
  limitsKey,
} from "./format";

describe("format", () => {
  it("formats sizes and dates per locale", () => {
    expect(formatMegabytes(10, "en")).toBe("10 MB");
    expect(formatMegabytes(10, "es")).toBe("10 MB");
    expect(formatBytes(1536 * 1024, "en")).toBe("1.5 MB");
    expect(formatBytes(1536 * 1024, "es")).toBe("1,5 MB");
    expect(formatBytes(512 * 1024, "en")).toBe("512 kB");
    expect(formatBytes(10, "en")).toBe("1 kB");
    expect(formatIsoDate("2026-11-09", "en")).toBe("November 9, 2026");
    expect(formatIsoDate("2026-11-09", "es")).toBe("9 de noviembre de 2026");
  });

  it("returns an unreadable date as given", () => {
    expect(formatIsoDate("not a date", "en")).toBe("not a date");
  });

  it("formats numbers per locale", () => {
    expect(formatNumber(1234.5, "en")).toBe("1,234.5");
    expect(formatNumber(12, "es")).toBe("12");
  });

  it("formats an instant in a zone with its short name", () => {
    const text = formatInstant("2026-11-09T15:30:00Z", "en", "America/Bogota");
    expect(text).toContain("November 9, 2026");
    expect(text).toContain("10:30");
  });

  it("names the accepted kinds and the input's accept list", () => {
    expect(kindsKey(["image"])).toBe("kinds_images");
    expect(kindsKey(["video"])).toBe("kinds_videos");
    expect(kindsKey(["image", "video"])).toBe("kinds_mixed");
    expect(limitsKey(["image"])).toBe("files_limits_images");
    expect(limitsKey(["video"])).toBe("files_limits_videos");
    expect(limitsKey(["video", "image"])).toBe("files_limits_mixed");
    expect(acceptAttribute(["image"])).toBe(
      "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic",
    );
    expect(acceptAttribute(["video"])).toBe("video/mp4,video/quicktime");
    expect(acceptAttribute(["image", "video"])).toBe(
      "image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,video/mp4,video/quicktime",
    );
  });
});
