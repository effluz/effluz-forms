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

export type Condition = Clause | { all: Condition[] } | { any: Condition[] };

export const conditionSchema: z.ZodType<Condition> = z.lazy(() =>
  z.union([
    clauseSchema,
    z.object({ all: z.array(conditionSchema) }).strict(),
    z.object({ any: z.array(conditionSchema) }).strict(),
  ]),
);

export function evaluateCondition(
  condition: Condition,
  answers: Readonly<Record<string, unknown>>,
): boolean {
  if ("all" in condition) return condition.all.every((c) => evaluateCondition(c, answers));
  if ("any" in condition) return condition.any.some((c) => evaluateCondition(c, answers));
  return OPERATORS[condition.op].evaluate(answers[condition.field], condition.value);
}

/** Every field key referenced anywhere in the condition, in order of appearance. */
export function referencedKeys(condition: Condition): string[] {
  if ("all" in condition) return condition.all.flatMap(referencedKeys);
  if ("any" in condition) return condition.any.flatMap(referencedKeys);
  return [condition.field];
}
