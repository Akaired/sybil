export interface MinimalProfile {
  display_name?: string | null;
}

export interface MinimalUser {
  email?: string | null;
  user_metadata?: Record<string, unknown> | null;
}

/**
 * Single source of truth for "what name do we show for the current user".
 * Order: sybil_profiles.display_name → user_metadata.full_name → username →
 * name → email local-part → "Utente". `profile` being null/undefined is a
 * normal case (row not loaded yet, missing, or the table not deployed to
 * this environment yet) — not an error — so it just falls through.
 * Never returns "" or "undefined".
 */
export function getDisplayName(
  user: MinimalUser | null | undefined,
  profile: MinimalProfile | null | undefined,
): string {
  const fromProfile = profile?.display_name?.trim();
  if (fromProfile) return fromProfile;

  const metadata = user?.user_metadata ?? {};

  const fullName = typeof metadata.full_name === "string" ? metadata.full_name.trim() : "";
  if (fullName) return fullName;

  const username = typeof metadata.username === "string" ? metadata.username.trim() : "";
  if (username) return username;

  const name = typeof metadata.name === "string" ? metadata.name.trim() : "";
  if (name) return name;

  const emailLocal = user?.email ? user.email.split("@")[0]?.trim() : "";
  if (emailLocal) return emailLocal;

  return "Utente";
}

export function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const chars = parts.length > 1 ? [parts[0][0], parts[1][0]] : [parts[0][0], parts[0][1] ?? ""];
  return chars.join("").toUpperCase();
}
