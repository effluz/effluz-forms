import { loadConfig } from "@/app/config";
import { buildContainer } from "@/app/container";
import { revokeSessionsForEmail } from "@/modules/identity/application";
import { parseArgs } from "./revoke-sessions-args";

/**
 * Operator command: deletes every admin session of an address.
 * See ops/runbooks/revoke-sessions.md and specs/use-cases/sign-in.md, "Rules".
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.ok) {
    console.error(args.message);
    process.exit(1);
  }
  // Always the web service config, on a copy so process.env stays untouched.
  const config = loadConfig({ ...process.env, SERVICE: "app" });
  const container = buildContainer(config);
  try {
    const count = await revokeSessionsForEmail(container.identity, {
      email: args.email,
      actorEmail: process.env.OPERATOR_EMAIL ?? null,
    });
    console.log(`Revoked ${String(count)} sessions`);
  } finally {
    await container.pool.end();
  }
}

main().then(
  () => {
    process.exit(0);
  },
  (e: unknown) => {
    // Class name only: error text could carry the address or connection details.
    console.error(`revoke failed: ${e instanceof Error ? e.constructor.name : "unknown error"}`);
    process.exit(1);
  },
);
