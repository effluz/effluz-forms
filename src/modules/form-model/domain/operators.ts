import { z } from "zod";

export const operatorSchema = z.enum([
  "equals",
  "not_equals",
  "contains",
  "not_contains",
  "is_empty",
  "is_not_empty",
  "greater_than",
  "less_than",
  "is_one_of",
]);
export type OperatorId = z.infer<typeof operatorSchema>;

export interface OperatorDefinition {
  id: OperatorId;
  needsValue: boolean;
  evaluate(answer: unknown, value: unknown): boolean;
}

type Primitive = string | number | boolean;
const isPrimitive = (v: unknown): v is Primitive =>
  typeof v === "string" || typeof v === "number" || typeof v === "boolean";

const isoDate = /^\d{4}-\d{2}-\d{2}$/;

function isEmpty(answer: unknown): boolean {
  if (answer === undefined || answer === null) return true;
  if (typeof answer === "string") return answer.trim().length === 0;
  if (Array.isArray(answer)) return answer.length === 0;
  return false;
}

function compare(answer: unknown, value: unknown): number | undefined {
  if (typeof answer === "number" && typeof value === "number") return answer - value;
  if (
    typeof answer === "string" &&
    typeof value === "string" &&
    isoDate.test(answer) &&
    isoDate.test(value)
  ) {
    return answer < value ? -1 : answer > value ? 1 : 0;
  }
  return undefined;
}

function contains(answer: unknown, value: unknown): boolean {
  if (typeof answer === "string" && typeof value === "string") return answer.includes(value);
  if (Array.isArray(answer) && isPrimitive(value)) return answer.includes(value);
  return false;
}

const def = (
  id: OperatorId,
  needsValue: boolean,
  evaluate: OperatorDefinition["evaluate"],
): OperatorDefinition => ({
  id,
  needsValue,
  evaluate: (a, v) => {
    try {
      return evaluate(a, v);
    } catch {
      return false;
    }
  },
});

export const OPERATORS: Record<OperatorId, OperatorDefinition> = {
  equals: def("equals", true, (a, v) => isPrimitive(a) && isPrimitive(v) && a === v),
  not_equals: def("not_equals", true, (a, v) => !(isPrimitive(a) && isPrimitive(v) && a === v)),
  contains: def("contains", true, contains),
  not_contains: def("not_contains", true, (a, v) => !contains(a, v)),
  is_empty: def("is_empty", false, (a) => isEmpty(a)),
  is_not_empty: def("is_not_empty", false, (a) => !isEmpty(a)),
  greater_than: def("greater_than", true, (a, v) => {
    const c = compare(a, v);
    return c !== undefined && c > 0;
  }),
  less_than: def("less_than", true, (a, v) => {
    const c = compare(a, v);
    return c !== undefined && c < 0;
  }),
  is_one_of: def("is_one_of", true, (a, v) => Array.isArray(v) && isPrimitive(a) && v.includes(a)),
};
