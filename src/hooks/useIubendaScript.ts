import { useEffect } from "react";

const IUBENDA_SRC = "https://cdn.iubenda.com/iubenda.js";

// Loads the iubenda embed script once per page load so the
// iubenda-embed links in the footer render as the real policy chips
// instead of plain anchors. Safe to call from multiple pages/mounts —
// guards against injecting the script twice.
export function useIubendaScript() {
  useEffect(() => {
    if (document.querySelector(`script[src="${IUBENDA_SRC}"]`)) return;
    const script = document.createElement("script");
    script.src = IUBENDA_SRC;
    document.body.appendChild(script);
  }, []);
}
