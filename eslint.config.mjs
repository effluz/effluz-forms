import js from "@eslint/js";
import tseslint from "typescript-eslint";
import boundaries from "eslint-plugin-boundaries";
import prettier from "eslint-config-prettier";

const moduleLayers = ["domain", "application", "infrastructure", "presentation"];

const element = (type) => ({ element: { type } });
// A layer of the importing file's own module (the `module` folder name is captured).
const ownModule = (layer) => ({
  element: { type: `module-${layer}`, captured: { module: "{{ from.element.captured.module }}" } },
});
const thirdParty = (...source) => ({ module: { origin: ["external", "core"], source } });

// Inter-module dependency graph (specs/architecture.md). A module may import only the
// public entry point (application/index.ts) of the modules listed here; modules absent
// from the table get none.
const MODULE_DEPS = {
  "form-model": [],
  identity: [],
  media: [],
  notifications: [],
  definitions: ["form-model", "identity"],
  submissions: ["form-model", "definitions", "media", "notifications"],
  review: ["form-model", "definitions", "submissions", "media", "identity"],
};
const moduleOf = (type, module) => ({ element: { type, captured: { module } } });
// A module's single public entry point: its application/index.ts file.
const entryOf = (module) => ({
  ...moduleOf("module-application", module),
  file: { categories: "module-application-entry" },
});
const moduleLayerPolicies = Object.entries(MODULE_DEPS).flatMap(([module, deps]) =>
  ["application", "infrastructure", "presentation"].map((layer) => ({
    from: moduleOf(`module-${layer}`, module),
    allow: {
      to: [
        element("shared-domain"),
        element("shared-application"),
        ...(layer === "infrastructure" ? [element("shared-infrastructure")] : []),
        ...(layer === "presentation" ? [element("shared-presentation")] : []),
        moduleOf("module-domain", module),
        moduleOf("module-application", module),
        moduleOf(`module-${layer}`, module),
        ...deps.map(entryOf),
      ],
    },
  })),
);

const frameworks = ["react", "react-dom", "next", "next/*"];
// The Next entry files that must sit at the src root (src/proxy.ts and its test).
const rootEntry = { file: { categories: "root-entry" } };

export default tseslint.config(
  { ignores: [".next/**", "node_modules/**", "coverage/**", "next-env.d.ts"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  // Plain JS files (this config) are outside the TypeScript project.
  { files: ["**/*.{js,mjs}"], ...tseslint.configs.disableTypeChecked },
  {
    plugins: { boundaries },
    settings: {
      "import/resolver": { typescript: { project: "./tsconfig.json" } },
      "boundaries/include": ["src/**/*"],
      "boundaries/elements": [
        { type: "app", pattern: "src/app", partialMatch: false },
        { type: "shared-domain", pattern: "src/shared/domain", partialMatch: false },
        { type: "shared-application", pattern: "src/shared/application", partialMatch: false },
        {
          type: "shared-infrastructure",
          pattern: "src/shared/infrastructure",
          partialMatch: false,
        },
        { type: "shared-presentation", pattern: "src/shared/presentation", partialMatch: false },
        ...moduleLayers.map((layer) => ({
          type: `module-${layer}`,
          pattern: `src/modules/*/${layer}`,
          capture: ["module"],
          partialMatch: false,
        })),
      ],
      // Files are categorized within their element; the entry file stays application code.
      "boundaries/files": [
        { category: "module-application-entry", pattern: "src/modules/*/application/index.ts" },
        // Next requires the proxy at the src root, outside app/. Only these named files
        // are known there; any other file outside an element still fails no-unknown-files.
        { category: "root-entry", pattern: "src/proxy{,.test}.ts" },
      ],
    },
    rules: {
      "boundaries/no-unknown-files": "error",
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          checkAllOrigins: true,
          policies: [
            // Third-party and Node core imports are allowed everywhere; the last two policies
            // below carve out the framework and Node restrictions for the inner layers.
            { allow: { to: { module: { origin: ["external", "core"] } } } },

            // Layer rules. Cross-module imports are allowed only into another module's
            // application layer, and only along the edges of MODULE_DEPS.
            { from: element("shared-domain"), allow: { to: element("shared-domain") } },
            {
              from: element("shared-application"),
              allow: { to: [element("shared-domain"), element("shared-application")] },
            },
            {
              from: element("shared-infrastructure"),
              allow: {
                to: [
                  element("shared-domain"),
                  element("shared-application"),
                  element("shared-infrastructure"),
                ],
              },
            },
            {
              from: element("shared-presentation"),
              allow: {
                to: [
                  element("shared-domain"),
                  element("shared-application"),
                  element("shared-presentation"),
                ],
              },
            },
            {
              from: element("module-domain"),
              allow: { to: [element("shared-domain"), ownModule("domain")] },
            },
            ...moduleLayerPolicies,
            {
              // The src root entry files get exactly the app's permissions.
              from: [element("app"), rootEntry],
              allow: {
                to: [
                  element("app"),
                  rootEntry,
                  element("shared-application"),
                  element("shared-infrastructure"),
                  element("shared-presentation"),
                  element("module-application"),
                  element("module-infrastructure"),
                  element("module-presentation"),
                ],
              },
            },

            {
              from: [element("module-domain"), element("shared-domain")],
              // Every Node core module, bare (`fs`) or prefixed (`node:fs`), is core origin.
              disallow: { to: [thirdParty(...frameworks), { module: { origin: "core" } }] },
              message: "domain depends on nothing outside itself",
            },
            {
              from: [element("module-application"), element("shared-application")],
              disallow: { to: thirdParty(...frameworks) },
              message: "application is framework-free",
            },
          ],
        },
      ],
    },
  },
  prettier,
);
