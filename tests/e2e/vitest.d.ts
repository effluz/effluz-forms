import "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
    baseUrl: string;
    stagingDir: string;
  }
}
