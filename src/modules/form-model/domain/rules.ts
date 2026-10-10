import { RE2JS } from "re2js";
import { z } from "zod";
import type { IssueParams, ValidationCode } from "./issues";

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const count = z.number().int().min(0);

const MAX_PATTERN_LENGTH = 200;
/**
 * Most compiled instructions a pattern may have. RE2 matching costs input
 * length times program size and counted repeats expand in the program, so the
 * length cap alone does not bound cost. `a{1000}` (1,002) fits. See ADR 0015.
 */
export const MAX_PROGRAM_SIZE = 1_100;

/**
 * A pattern is safe when it is short, RE2 can compile it and its compiled
 * program is small. RE2 has no backreferences or lookarounds, so those fail to
 * compile, and matching runs in time linear in input size times program size.
 * See ADR 0015.
 */
function safeRegex(source: string): boolean {
  if (source.length > MAX_PATTERN_LENGTH) return false;
  try {
    return RE2JS.compile(source).programSize() <= MAX_PROGRAM_SIZE;
  } catch {
    return false;
  }
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
    // A string never has more graphemes than UTF-16 code units, so the cheap
    // code-unit length decides first and graphemes are counted only when needed.
    case "min_length":
      return typeof answer === "string" &&
        (answer.length < rule.value || graphemeLength(answer) < rule.value)
        ? "min_length"
        : undefined;
    case "max_length":
      return typeof answer === "string" &&
        answer.length > rule.value &&
        graphemeLength(answer) > rule.value
        ? "max_length"
        : undefined;
    case "pattern":
      if (typeof answer !== "string") return undefined;
      return RE2JS.compile(rule.value, rule.flags === "i" ? RE2JS.CASE_INSENSITIVE : 0).testExact(
        answer.trim(),
      )
        ? undefined
        : "pattern";
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
