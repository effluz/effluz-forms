import { z } from "zod";
import { keySchema } from "./keys";
import { OPERATORS, operatorSchema } from "./operators";

const clauseValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.union([z.string(), z.number(), z.boolean()])),
]);

export const clauseSchema = z
  .object({ field: keySchema, op: operatorSchema, value: clauseValueSchema.optional() })
  .superRefine((clause, ctx) => {
    const needsValue = OPERATORS[clause.op].needsValue;
    if (needsValue && clause.value === undefined)
      ctx.addIssue({ code: "custom", message: "operator needs a value", path: ["value"] });
    if (!needsValue && clause.value !== undefined)
      ctx.addIssue({ code: "custom", message: "operator takes no value", path: ["value"] });
  });
export type Clause = z.infer<typeof clauseSchema>;

/** A clause or one flat group of clauses; groups do not nest (specs/form-definition.md). */
export type Condition = Clause | { all: Clause[] } | { any: Clause[] };

export const conditionSchema: z.ZodType<Condition> = z.union([
  clauseSchema,
  z.object({ all: z.array(clauseSchema) }).strict(),
  z.object({ any: z.array(clauseSchema) }).strict(),
]);

function evaluateClause(clause: Clause, answers: Readonly<Record<string, unknown>>): boolean {
  const answer = Object.hasOwn(answers, clause.field) ? answers[clause.field] : undefined;
  return OPERATORS[clause.op].evaluate(answer, clause.value);
}

export function evaluateCondition(
  condition: Condition,
  answers: Readonly<Record<string, unknown>>,
): boolean {
  if ("all" in condition) return condition.all.every((c) => evaluateClause(c, answers));
  if ("any" in condition) return condition.any.some((c) => evaluateClause(c, answers));
  return evaluateClause(condition, answers);
}

/** Every field key referenced anywhere in the condition, in order of appearance. */
export function referencedKeys(condition: Condition): string[] {
  if ("all" in condition) return condition.all.map((c) => c.field);
  if ("any" in condition) return condition.any.map((c) => c.field);
  return [condition.field];
}
