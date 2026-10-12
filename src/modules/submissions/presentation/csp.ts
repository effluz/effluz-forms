/**
 * The renderer's Content-Security-Policy for one request, around the nonce the proxy issues
 * and Next stamps on its scripts. See specs/system/security.md, "Transport and headers".
 */
export function rendererCsp(nonce: string, development: boolean): string {
  const scripts = `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`;
  return [
    "default-src 'self'",
    scripts,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}
