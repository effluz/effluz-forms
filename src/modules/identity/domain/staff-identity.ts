export interface StaffIdentity {
  email: string;
  name: string;
}

export interface IdentityClaims {
  email?: string;
  emailVerified?: boolean;
  hostedDomain?: string;
  name?: string;
}

export type Admission =
  | { admitted: true; identity: StaffIdentity }
  | {
      admitted: false;
      reason: "unverified_email" | "wrong_domain" | "missing_email";
      attemptedDomain: string | null;
    };

function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 0) return null;
  const domain = email.slice(at + 1).toLowerCase();
  return domain === "" ? null : domain;
}

function localPartOf(email: string): string {
  const at = email.lastIndexOf("@");
  return at < 0 ? email : email.slice(0, at);
}

/**
 * Decides whether verified identity claims may sign in to the admin area.
 * Never reports a full address, only the attempted domain.
 * See specs/system/security.md, "Admin authentication", and
 * specs/use-cases/sign-in.md, "Alternate flows and errors".
 */
export function admit(claims: IdentityClaims, allowedHostedDomain: string): Admission {
  const email = claims.email?.trim().toLowerCase() ?? "";
  const hostedDomain = claims.hostedDomain?.trim().toLowerCase() ?? "";
  const attemptedDomain =
    hostedDomain !== "" ? hostedDomain : email !== "" ? domainOf(email) : null;

  if (email === "") {
    return { admitted: false, reason: "missing_email", attemptedDomain };
  }
  if (claims.emailVerified !== true) {
    return { admitted: false, reason: "unverified_email", attemptedDomain };
  }
  if (hostedDomain !== allowedHostedDomain.trim().toLowerCase()) {
    return { admitted: false, reason: "wrong_domain", attemptedDomain };
  }

  const claimedName = claims.name?.trim() ?? "";
  return {
    admitted: true,
    identity: { email, name: claimedName !== "" ? claimedName : localPartOf(email) },
  };
}
