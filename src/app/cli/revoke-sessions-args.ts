export type ParsedArgs = { ok: true; email: string } | { ok: false; message: string };

export const USAGE = "usage: pnpm sessions:revoke <email>";

/** Accepts exactly one address. The message never echoes the argument. */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const [raw, ...rest] = argv;
  if (raw === undefined || rest.length > 0) return { ok: false, message: USAGE };
  const email = raw.trim().toLowerCase();
  const at = email.indexOf("@");
  if (at < 1 || at === email.length - 1) return { ok: false, message: USAGE };
  if (email.indexOf("@", at + 1) !== -1 || /\s/.test(email)) return { ok: false, message: USAGE };
  return { ok: true, email };
}

/** The operator recorded as the audit actor; a blank `OPERATOR_EMAIL` counts as unset. */
export function operatorEmail(env: Readonly<Record<string, string | undefined>>): string | null {
  return env["OPERATOR_EMAIL"]?.trim() || null;
}
