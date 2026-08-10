import { Node, mergeAttributes } from "@tiptap/core";

// Generic embed node for YouTube/Vimeo/Loom — the editor only ever inserts
// an already-normalized embed URL (see videoEmbedUrl() in BlogEditor), and
// parseHTML must accept any of the three hostnames so a saved post's iframe
// loads back into the editor. Same whitelist as blog-admin's server-side
// sanitizer, so nothing this node produces gets stripped on save.
export const VideoEmbed = Node.create({
  name: "videoEmbed",
  group: "block",
  atom: true,
  draggable: true,

  addAttributes() {
    return { src: { default: "" } };
  },

  parseHTML() {
    return [
      {
        tag: "iframe[src]",
        getAttrs: (el) => {
          if (!(el instanceof HTMLElement)) return false;
          const src = el.getAttribute("src") ?? "";
          const ok =
            /^https:\/\/(www\.)?youtube\.com\/embed\//.test(src) ||
            /^https:\/\/player\.vimeo\.com\/video\//.test(src) ||
            /^https:\/\/(www\.)?loom\.com\/embed\//.test(src);
          return ok ? { src } : false;
        },
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      "iframe",
      mergeAttributes(HTMLAttributes, {
        src: HTMLAttributes.src,
        allow: "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture",
        allowfullscreen: "true",
        frameborder: "0",
      }),
    ];
  },
});

export default VideoEmbed;
