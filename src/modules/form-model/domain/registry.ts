import type { AnyFieldType, FieldTypeDefinition, FieldTypeId } from "./field-type";

export class UnknownFieldTypeError extends Error {
  constructor(public readonly id: string) {
    super(`unknown field type: ${id}`);
    this.name = "UnknownFieldTypeError";
  }
}

export interface FieldTypeRegistry {
  get(id: string): FieldTypeDefinition;
  has(id: string): id is FieldTypeId;
  list(): readonly FieldTypeDefinition[];
}

export function createRegistry(defs: readonly AnyFieldType[]): FieldTypeRegistry {
  const map = new Map<string, AnyFieldType>();
  for (const def of defs) {
    if (map.has(def.id)) throw new Error(`duplicate field type: ${def.id}`);
    map.set(def.id, def);
  }
  const list = Object.freeze([...map.values()]);
  return {
    get(id) {
      const def = map.get(id);
      if (!def) throw new UnknownFieldTypeError(id);
      return def;
    },
    has(id): id is FieldTypeId {
      return map.has(id);
    },
    list() {
      return list;
    },
  };
}
