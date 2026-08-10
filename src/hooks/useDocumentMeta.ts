import { useEffect } from "react";

export interface DocumentMeta {
  title: string;
  description?: string;
  ogTitle?: string;
  ogDescription?: string;
  ogImage?: string;
  ogType?: string;
  twitterCard?: string;
  canonical?: string;
  jsonLd?: Record<string, unknown>;
}

function setMetaTag(attr: "name" | "property", key: string, content: string) {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  if (!el) {
    el = document.createElement("meta");
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.setAttribute("content", content);
}

// Sets document.title and upserts description/OG/Twitter/canonical tags for
// the current route. Reverts nothing on unmount — the next page's own call
// overwrites these tags, which is fine for an SPA with no server-rendered head.
export function useDocumentMeta(meta: DocumentMeta) {
  useEffect(() => {
    document.title = meta.title;

    if (meta.description) setMetaTag("name", "description", meta.description);
    setMetaTag("property", "og:title", meta.ogTitle ?? meta.title);
    if (meta.ogDescription ?? meta.description) {
      setMetaTag("property", "og:description", meta.ogDescription ?? meta.description!);
    }
    if (meta.ogImage) setMetaTag("property", "og:image", meta.ogImage);
    setMetaTag("property", "og:type", meta.ogType ?? "website");
    setMetaTag("name", "twitter:card", meta.twitterCard ?? "summary_large_image");

    if (meta.canonical) {
      let link = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
      if (!link) {
        link = document.createElement("link");
        link.setAttribute("rel", "canonical");
        document.head.appendChild(link);
      }
      link.setAttribute("href", meta.canonical);
    }

    let jsonLdEl: HTMLScriptElement | null = null;
    if (meta.jsonLd) {
      jsonLdEl = document.createElement("script");
      jsonLdEl.type = "application/ld+json";
      jsonLdEl.text = JSON.stringify(meta.jsonLd);
      document.head.appendChild(jsonLdEl);
    }

    return () => {
      if (jsonLdEl) document.head.removeChild(jsonLdEl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.title, meta.description, meta.ogImage, meta.canonical, JSON.stringify(meta.jsonLd)]);
}
