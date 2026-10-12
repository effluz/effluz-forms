import { describe, expect, it } from "vitest";
import { LIMITS } from "@/shared/domain/form-model";
import { fileMaxBytes } from "./staging";

const MB = 1024 * 1024;

describe("fileMaxBytes", () => {
  it("is the field's own limit when that is under the system maximum", () => {
    expect(fileMaxBytes({ kinds: ["image"], maxFiles: 1, maxSizeMb: 4 })).toBe(4 * MB);
  });

  it("never exceeds the system per-file maximum, whatever the field asks for", () => {
    const over = LIMITS.fileSizeMb + 40;
    expect(fileMaxBytes({ kinds: ["video"], maxFiles: 1, maxSizeMb: over })).toBe(
      LIMITS.fileSizeMb * MB,
    );
  });
});
