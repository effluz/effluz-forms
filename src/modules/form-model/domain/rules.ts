import { z } from "zod";
import type { IssueParams, ValidationCode } from "./issues";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().min(0);

const MAX_PATTERN_LENGTH = 200;
const MAX_REPEAT = 1000;
const MAX_GROUP_DEPTH = 2;

/**
 * Whitelist scanner for the safe regex subset. Walks the pattern once and
 * rejects every construct outside the subset. Quantified groups, backreferences
 * and lookarounds are excluded so a public submission cannot stall the server.
 */
class PatternScanner {
  private pos = 0;
  private readonly source: string;

  constructor(source: string) {
    this.source = source;
  }

  run(): boolean {
    return this.alternation(0) && this.pos === this.source.length;
  }

  private peek(offset = 0): string {
    return this.source.charAt(this.pos + offset);
  }

  private alternation(depth: number): boolean {
    for (;;) {
      if (!this.sequence(depth)) return false;
      if (this.peek() !== "|") return true;
      this.pos++;
    }
  }

  private sequence(depth: number): boolean {
    while (this.pos < this.source.length) {
      const c = this.peek();
      if (c === "|" || c === ")") return true;
      if (c === "^" || c === "$") {
        this.pos++;
        continue;
      }
      if (c === "(") {
        // Groups take no quantifier; a quantifier after ")" fails in atom().
        if (!this.group(depth)) return false;
        continue;
      }
      if (!this.atom(c) || !this.quantifier()) return false;
    }
    return true;
  }

  private group(depth: number): boolean {
    if (depth + 1 > MAX_GROUP_DEPTH) return false;
    if (this.source.startsWith("(?:", this.pos)) {
      this.pos += 3;
    } else if (this.peek(1) === "?") {
      // Lookarounds and named groups.
      return false;
    } else {
      this.pos += 1;
    }
    if (!this.alternation(depth + 1) || this.peek() !== ")") return false;
    this.pos++;
    return true;
  }

  private atom(c: string): boolean {
    if (c === "\\") {
      const escaped = this.peek(1);
      // Backreferences (\1 to \9) and named backreferences (\k) are rejected.
      if (escaped === "" || /[1-9k]/.test(escaped)) return false;
      this.pos += 2;
      return true;
    }
    if (c === "[") return this.characterClass();
    if (c === ".") {
      this.pos++;
      return true;
    }
    // A quantifier or stray bracket where an atom belongs is malformed.
    if (/[*+?{}\]]/.test(c)) return false;
    this.pos++;
    return true;
  }

  private characterClass(): boolean {
    this.pos++;
    if (this.peek() === "^") this.pos++;
    while (this.pos < this.source.length) {
      const c = this.peek();
      if (c === "]") {
        this.pos++;
        return true;
      }
      this.pos += c === "\\" ? 2 : 1;
    }
    return false;
  }

  private quantifier(): boolean {
    const c = this.peek();
    if (c === "{") {
      const repeat = /\{(\d+)(?:(,)(\d*))?\}/y;
      repeat.lastIndex = this.pos;
      const match = repeat.exec(this.source);
      if (!match) return false;
      const bounds = [Number(match[1]), match[3] ? Number(match[3]) : 0];
      if (bounds.some((bound) => bound > MAX_REPEAT)) return false;
      this.pos += match[0].length;
    } else if (c === "*" || c === "+" || c === "?") {
      this.pos++;
    } else {
      return true;
    }
    // One optional lazy modifier.
    if (this.peek() === "?") this.pos++;
    return true;
  }
}

function safeRegex(source: string): boolean {
  if (source.length > MAX_PATTERN_LENGTH) return false;
  if (!new PatternScanner(source).run()) return false;
  try {
    new RegExp(source, "u");
  } catch {
    return false;
  }
  return true;
}

export const ruleSchema = z.discriminatedUnion("rule", [
  z.object({ rule: z.literal("min_length"), value: count }),
  z.object({ rule: z.literal("max_length"), value: count }),
  z.object({
    rule: z.literal("pattern"),
    value: z.string().refine(safeRegex, "unsafe or invalid pattern"),
    flags: z.enum(["i"]).optional(),
  }),
  // Zod 4's z.number() already rejects Infinity and NaN, so no .finite() is needed.
  z.object({ rule: z.literal("min_value"), value: z.number() }),
  z.object({ rule: z.literal("max_value"), value: z.number() }),
  z.object({ rule: z.literal("min_date"), value: isoDate }),
  z.object({ rule: z.literal("max_date"), value: isoDate }),
  z.object({ rule: z.literal("not_future") }),
  z.object({ rule: z.literal("min_selected"), value: count }),
  z.object({ rule: z.literal("max_selected"), value: count }),
  z.object({ rule: z.literal("must_be_true") }),
  z.object({ rule: z.literal("min_files"), value: count }),
  z.object({ rule: z.literal("max_files"), value: count }),
]);
export type Rule = z.infer<typeof ruleSchema>;
export type RuleId = Rule["rule"];

export interface RuleContext {
  today: string;
}

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
export function graphemeLength(text: string): number {
  return Array.from(segmenter.segment(text.normalize("NFC").trim())).length;
}

export function evaluateRule(
  rule: Rule,
  answer: unknown,
  ctx: RuleContext,
): ValidationCode | undefined {
  switch (rule.rule) {
    case "min_length":
      return typeof answer === "string" && graphemeLength(answer) < rule.value
        ? "min_length"
        : undefined;
    case "max_length":
      return typeof answer === "string" && graphemeLength(answer) > rule.value
        ? "max_length"
        : undefined;
    case "pattern":
      return typeof answer === "string" &&
        !new RegExp(`^(?:${rule.value})$`, `u${rule.flags ?? ""}`).test(answer.trim())
        ? "pattern"
        : undefined;
    case "min_value":
      return typeof answer === "number" && answer < rule.value ? "number_min" : undefined;
    case "max_value":
      return typeof answer === "number" && answer > rule.value ? "number_max" : undefined;
    case "min_date":
      return typeof answer === "string" && answer < rule.value ? "date_min" : undefined;
    case "max_date":
      return typeof answer === "string" && answer > rule.value ? "date_max" : undefined;
    case "not_future":
      return typeof answer === "string" && answer > ctx.today ? "date_not_future" : undefined;
    case "min_selected":
      return Array.isArray(answer) && answer.length < rule.value ? "choice_min" : undefined;
    case "max_selected":
      return Array.isArray(answer) && answer.length > rule.value ? "choice_max" : undefined;
    case "must_be_true":
      return answer === false ? "must_be_true" : undefined;
    case "min_files":
      return Array.isArray(answer) && answer.length < rule.value ? "files_min" : undefined;
    case "max_files":
      return Array.isArray(answer) && answer.length > rule.value ? "files_max" : undefined;
  }
}

export function ruleParams(rule: Rule): IssueParams {
  if (!("value" in rule)) return {};
  return typeof rule.value === "number"
    ? { n: rule.value }
    : rule.rule.endsWith("_date")
      ? { date: rule.value }
      : {};
}
