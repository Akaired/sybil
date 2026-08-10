import { Node, mergeAttributes } from "@tiptap/core";
import { ReactNodeViewRenderer } from "@tiptap/react";
import CtaBlockView from "./CtaBlockView";

export type CtaVariant = "primary" | "subtle";

export interface CtaBlockAttrs {
  title: string;
  body: string;
  buttonLabel: string;
  href: string;
  variant: CtaVariant;
}

declare module "@tiptap/core" {
  interface Commands<ReturnType> {
    ctaBlock: {
      insertCtaBlock: (attrs?: Partial<CtaBlockAttrs>) => ReturnType;
    };
  }
}

// Renders to (and parses back from) static, self-contained markup so a
// saved post's content_html round-trips through the editor without losing
// the CTA — parseHTML must recognize exactly what renderHTML produces.
export const CtaBlock = Node.create({
  name: "cta",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return {
      title: { default: "Try Sybil free" },
      body: { default: "Create your first dormant task and see the difference." },
      buttonLabel: { default: "Get started" },
      href: { default: "/register" },
      variant: { default: "primary" },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[class~="sybil-cta"]',
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          const variant = el.classList.contains("sybil-cta--subtle") ? "subtle" : "primary";
          const title = el.querySelector("h4")?.textContent ?? "";
          const body = el.querySelector("p")?.textContent ?? "";
          const btn = el.querySelector("a.sybil-cta__btn");
          return {
            title,
            body,
            buttonLabel: btn?.textContent ?? "",
            href: btn?.getAttribute("href") ?? "",
            variant,
          };
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes, node }) {
    const attrs = node.attrs as CtaBlockAttrs;
    return [
      "div",
      mergeAttributes(HTMLAttributes, { class: `sybil-cta sybil-cta--${attrs.variant}` }),
      ["h4", {}, attrs.title],
      ["p", {}, attrs.body],
      ["a", { href: attrs.href, class: "sybil-cta__btn" }, attrs.buttonLabel],
    ];
  },

  addNodeView() {
    return ReactNodeViewRenderer(CtaBlockView);
  },

  addCommands() {
    return {
      insertCtaBlock:
        (attrs) =>
        ({ commands }) =>
          commands.insertContent({ type: this.name, attrs }),
    };
  },
});

export default CtaBlock;
