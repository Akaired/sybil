import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react";
import type { CtaVariant } from "./CtaBlock";

export default function CtaBlockView({ node, updateAttributes, selected }: NodeViewProps) {
  const attrs = node.attrs as {
    title: string;
    body: string;
    buttonLabel: string;
    href: string;
    variant: CtaVariant;
  };

  return (
    <NodeViewWrapper
      className={`sybil-cta sybil-cta--${attrs.variant} !my-4 outline-none ${
        selected ? "ring-2 ring-fg-accent" : ""
      }`}
      contentEditable={false}
    >
      <div className="flex items-center justify-between gap-3 mb-2">
        <span className="text-[10px] uppercase tracking-wide text-fg-subtle font-semibold">CTA block</span>
        <select
          value={attrs.variant}
          onChange={(e) => updateAttributes({ variant: e.target.value as CtaVariant })}
          className="text-xs bg-bg-base border border-fg-subtle/30 rounded px-2 py-1 text-fg-primary cursor-pointer"
        >
          <option value="primary">Primary</option>
          <option value="subtle">Subtle</option>
        </select>
      </div>
      <input
        value={attrs.title}
        onChange={(e) => updateAttributes({ title: e.target.value })}
        placeholder="Title"
        className="w-full bg-transparent border-none outline-none font-semibold text-[1.1em] text-fg-primary mb-1 p-0"
      />
      <textarea
        value={attrs.body}
        onChange={(e) => updateAttributes({ body: e.target.value })}
        placeholder="Body"
        rows={2}
        className="w-full bg-transparent border-none outline-none resize-none text-fg-muted leading-[1.6] p-0 mb-2"
      />
      <div className="flex items-center gap-2 flex-wrap">
        <input
          value={attrs.buttonLabel}
          onChange={(e) => updateAttributes({ buttonLabel: e.target.value })}
          placeholder="Button label"
          className="text-sm font-semibold px-3 py-1.5 rounded-md bg-bg-base border border-fg-subtle/30 outline-none text-fg-primary"
        />
        <input
          value={attrs.href}
          onChange={(e) => updateAttributes({ href: e.target.value })}
          placeholder="URL"
          className="text-sm flex-1 min-w-[140px] px-3 py-1.5 rounded-md bg-bg-base border border-fg-subtle/30 outline-none text-fg-primary"
        />
      </div>
    </NodeViewWrapper>
  );
}
