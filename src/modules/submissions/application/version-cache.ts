import {
  loadVersion,
  type DefinitionsDeps,
  type FormVersion,
} from "@/modules/definitions/application";

/**
 * A per-process cache of published versions by id, least recently used out
 * first. Versions never change, so nothing invalidates it
 * (`specs/architecture.md`, "Publishing data flow", step 4).
 */
export class VersionCache {
  private readonly entries = new Map<string, FormVersion>();

  constructor(private readonly max = 100) {}

  async get(definitions: DefinitionsDeps, id: string): Promise<FormVersion | null> {
    const hit = this.entries.get(id);
    if (hit) {
      this.entries.delete(id);
      this.entries.set(id, hit);
      return hit;
    }
    const version = await loadVersion(definitions, id);
    if (version) {
      this.entries.set(id, version);
      while (this.entries.size > this.max) {
        const oldest = this.entries.keys().next();
        if (oldest.done) break;
        this.entries.delete(oldest.value);
      }
    }
    return version;
  }
}
