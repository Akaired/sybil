import { useContext } from "react";
import { AuthContext } from "../../contexts/AuthContext";
import Layout from "../Layout";
import { PublicDocsNav, PublicDocsFooter } from "./PublicDocsChrome";

// /docs and /docs/:slug are the same components whether or not the visitor
// is signed in — only the chrome around them changes. Signed-in: mount
// inside the real app Layout (sidebar, top bar). Signed-out: the same public
// nav/footer used by /blog. Layout accepts children as a fallback to its
// normal <Outlet/> specifically so it can be reused here without a second
// nested route registration.
//
// Layout's MusicPlayer needs a MusicPlayerProvider ancestor — that's
// App.tsx's session-gated AuthedMusicPlayer, mounted once above the router
// so it survives navigating here from the protected app (and vice versa)
// instead of restarting playback on every crossing.
export default function DocsShell({ children }: { children: React.ReactNode }) {
  const { session } = useContext(AuthContext);

  if (session) {
    return <Layout>{children}</Layout>;
  }

  return (
    <div className="w-full min-h-screen bg-bg-base">
      <PublicDocsNav />
      {children}
      <PublicDocsFooter />
    </div>
  );
}
