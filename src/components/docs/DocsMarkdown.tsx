import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeSlug from "rehype-slug";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import "../../styles/docs-content.css";

export interface DocsHeading {
  id: string;
  text: string;
  level: 2 | 3;
}

// content_md is authored by a staff member's browser and rendered on a
// public page — raw HTML is never enabled (no rehype-raw in this chain) and
// rehype-sanitize strips anything that slips through as an autolinked/GFM
// artifact. This exact component is reused by the admin editor's live
// preview so what staff sees while writing is what the public page renders.
const SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    code: [...(defaultSchema.attributes?.code ?? []), "className"],
  },
};

export default function DocsMarkdown({
  content,
  onHeadingsChange,
}: {
  content: string;
  onHeadingsChange?: (headings: DocsHeading[]) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!onHeadingsChange || !ref.current) return;
    const nodes = ref.current.querySelectorAll("h2, h3");
    const headings: DocsHeading[] = Array.from(nodes).map((el) => ({
      id: el.id,
      text: el.textContent ?? "",
      level: el.tagName === "H2" ? 2 : 3,
    }));
    onHeadingsChange(headings);
  }, [content, onHeadingsChange]);

  return (
    <div className="docs-content" ref={ref}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSlug, [rehypeSanitize, SANITIZE_SCHEMA]]}
        skipHtml
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
