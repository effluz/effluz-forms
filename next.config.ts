import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Native and WASM image libraries must load from node_modules, not be bundled.
  serverExternalPackages: ["sharp", "libheif-js"],
};

export default nextConfig;
