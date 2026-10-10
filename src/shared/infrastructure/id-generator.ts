import type { IdGenerator } from "@/shared/application/ports/id-generator";

export const systemIdGenerator: IdGenerator = { newId: () => crypto.randomUUID() };
