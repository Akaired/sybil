import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Vault-backed secret lookup, falling back to the Deno.env var if the row
// isn't in the vault yet. Cache is per-invocation only (create a fresh one
// at the top of each request handler) — never module-level, since isolates
// can be reused warm across invocations and a rotated secret must take
// effect on the next call.
export type SecretCache = Map<string, string>;

export function createSecretCache(): SecretCache {
  return new Map();
}

export async function getSecret(
  name: string,
  cache?: SecretCache,
): Promise<string | undefined> {
  if (cache?.has(name)) return cache.get(name);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data, error } = await supabase.rpc("get_vault_secret", {
    secret_name: name,
  });

  const value = !error && data ? (data as string) : Deno.env.get(name);
  if (value && cache) cache.set(name, value);
  return value;
}
