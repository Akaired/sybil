import { createClient } from "@supabase/supabase-js";
import { authStorage } from "../lib/authStorage";

const supabaseUrl = "https://uhrqlwoejawnnhdeabob.supabase.co";
const supabaseAnonKey =
  "sb_publishable_VzqtaABi8AuN62C2xewvZA_LY5jJjdE";

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    flowType: "implicit",
    detectSessionInUrl: true,
    // Routes session persistence through localStorage or sessionStorage
    // depending on the "Remember me on this device" login choice — see
    // authStorage.ts. persistSession/autoRefreshToken stay at their default
    // (true): we still want the session written and silently refreshed,
    // just to whichever backing store the user opted into.
    storage: authStorage,
  },
});
