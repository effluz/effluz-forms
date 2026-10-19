export const POST_URL_MAX = 2048;

/** `url: null` means the curator left the link blank, which is allowed. */
export type PostUrlResult = { ok: true; url: string | null } | { ok: false };

// Whitespace and control characters never belong in a link a curator pastes.
const hasForbiddenCharacter = (text: string): boolean =>
  /\s/.test(text) || Array.from(text).some((c) => (c.codePointAt(0) ?? 0) < 0x20 || c === "\u007f");

/** The literal `https://` and a host's first character, so the stored link renders absolute. */
const HTTPS_PREFIX = /^https:\/\/[^/\\]/i;

/**
 * Checks the optional post link of "Mark as published": blank is fine, anything else must be an
 * `https` URL written with `https://` and a host, at most POST_URL_MAX characters. The link is
 * stored as typed (trimmed).
 */
export function parsePostUrl(input: string): PostUrlResult {
  const trimmed = input.trim();
  if (trimmed === "") return { ok: true, url: null };
  if (trimmed.length > POST_URL_MAX || hasForbiddenCharacter(trimmed)) return { ok: false };
  if (!HTTPS_PREFIX.test(trimmed)) return { ok: false };
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return { ok: false };
  }
  if (parsed.protocol !== "https:" || parsed.hostname === "") return { ok: false };
  return { ok: true, url: trimmed };
}
