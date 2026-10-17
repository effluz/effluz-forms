import { describe, expect, it } from "vitest";
import { parseMailbox } from "./mailbox";

describe("parseMailbox", () => {
  it("reads a display name and address, or a bare address", () => {
    expect(parseMailbox("Effluz Forms <forms@forms.example.com>")).toEqual({
      name: "Effluz Forms",
      email: "forms@forms.example.com",
    });
    expect(parseMailbox("forms@forms.example.com")).toEqual({
      name: null,
      email: "forms@forms.example.com",
    });
  });
});
