import type { TestProject } from "vitest/node";
import { createTestDatabase } from "../support/test-database";

/** Creates a throwaway database, migrates it, hands its URL to the tests and drops it afterwards. */
export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  const db = await createTestDatabase();
  project.provide("databaseUrl", db.url);
  return () => db.drop();
}
