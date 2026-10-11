import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EMAIL_TOKENS } from "./layout";

type Tokens = {
  brand: Record<string, string>;
  font: { family: { sans: string } };
};

const tokens = JSON.parse(readFileSync("design-system/tokens.json", "utf8")) as Tokens;

describe("email layout colors", () => {
  it("match the design-system tokens they are commented with", () => {
    expect(EMAIL_TOKENS.TEXT.toUpperCase()).toBe(tokens.brand["ink"]);
    expect(EMAIL_TOKENS.LINK.toUpperCase()).toBe(tokens.brand["plum"]);
    expect(EMAIL_TOKENS.MUTED.toUpperCase()).toBe(tokens.brand["mauve"]);
    expect(EMAIL_TOKENS.PAGE.toUpperCase()).toBe(tokens.brand["blush"]);
    expect(EMAIL_TOKENS.CARD.toUpperCase()).toBe(tokens.brand["white"]);
    expect(EMAIL_TOKENS.BORDER.toUpperCase()).toBe(tokens.brand["lavender"]);
    expect(EMAIL_TOKENS.FONT).toBe(tokens.font.family.sans);
  });
});
