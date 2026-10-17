import type { NextConfig } from "next";

/*
 * Keep the `NextConfig` annotation: excess-property checking makes `pnpm typecheck` refuse a
 * misspelled or removed option, which next-config.test.ts cannot catch. The experimental
 * names were checked against next@16.4.0, `next/dist/server/config-shared.d.ts`
 * (`ExperimentalConfig`); grep it again after a Next upgrade before renaming one.
 */
const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Native and WASM image libraries must load from node_modules, not be bundled.
  serverExternalPackages: ["sharp", "libheif-js"],
  experimental: {
    // A page post may carry every file of a submission: LIMITS.submissionSizeMb (100 MB)
    // plus 1 MB for the text fields, through the proxy and into the Server Action.
    serverActions: { bodySizeLimit: "101mb" },
    proxyClientMaxBodySize: "101mb",
    // Paths outside the three root layouts answer with src/app/global-not-found.tsx.
    globalNotFound: true,
  },
};

export default nextConfig;
