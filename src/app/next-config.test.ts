import { describe, expect, it } from "vitest";
import { LIMITS } from "@/shared/domain/form-model";
import nextConfig from "../../next.config";

describe("next.config", () => {
  it("lets a page post carry every file of a submission, through the proxy and the Server Action", () => {
    const limit = `${String(LIMITS.submissionSizeMb + 1)}mb`;
    expect(nextConfig.experimental?.serverActions?.bodySizeLimit).toBe(limit);
    expect(nextConfig.experimental?.proxyClientMaxBodySize).toBe(limit);
    expect(nextConfig.serverExternalPackages).toEqual(["sharp", "libheif-js"]);
  });
});
