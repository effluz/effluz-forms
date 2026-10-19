import { describe, expect, it } from "vitest";
import {
  statusAfterEdit,
  statusAfterOpen,
  statusAfterRevert,
  statusAfterUnpublish,
} from "./status";

describe("curation status ladder", () => {
  it("walks the ladder from curate-submission.md", () => {
    expect(statusAfterOpen("new")).toBe("viewed");
    expect(statusAfterOpen("edited")).toBe("edited");

    expect(statusAfterEdit("new")).toBe("edited");
    expect(statusAfterEdit("viewed")).toBe("edited");
    expect(statusAfterEdit("published")).toBe("published");

    expect(statusAfterRevert("edited", 0)).toBe("viewed");
    expect(statusAfterRevert("edited", 1)).toBe("edited");
    expect(statusAfterRevert("published", 0)).toBe("published");

    expect(statusAfterUnpublish(0)).toBe("viewed");
    expect(statusAfterUnpublish(2)).toBe("edited");
  });
});
