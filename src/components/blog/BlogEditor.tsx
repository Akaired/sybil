import { useCallback, useEffect, useState } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import Placeholder from "@tiptap/extension-placeholder";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import CharacterCount from "@tiptap/extension-character-count";
import { Table, TableRow, TableCell, TableHeader } from "@tiptap/extension-table";
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough, Code, Heading2, Heading3,
  Heading4, List, ListOrdered, Quote, Minus, AlignLeft, AlignCenter, AlignRight,
  Undo2, Redo2, Link as LinkIcon, Unlink, Image as ImageIcon, Video as VideoIcon,
  Sparkles, Table as TableIcon, ExternalLink, X,
} from "lucide-react";
import CtaBlock from "./CtaBlock";
import VideoEmbed from "./VideoEmbed";
import { blog } from "../../lib/blogApi";
import "../../styles/blog-content.css";

interface BlogEditorProps {
  postId: string;
  content: Record<string, unknown> | string | null;
  onUpdate: (editor: Editor) => void;
  onWordStats: (stats: { words: number; readingMinutes: number }) => void;
}

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`w-8 h-8 flex items-center justify-center rounded-md transition-colors duration-150 cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed ${
        active ? "bg-fg-accent/15 text-fg-accent" : "text-fg-muted hover:text-fg-primary hover:bg-bg-elevated"
      }`}
    >
      {children}
    </button>
  );
}

function Sep() {
  return <div className="w-px h-6 bg-fg-subtle/20 mx-1" />;
}

function LinkBubbleMenu({ editor }: { editor: Editor }) {
  const [editing, setEditing] = useState(false);
  const [url, setUrl] = useState("");
  const [newTab, setNewTab] = useState(true);

  const openEditor = useCallback(() => {
    const prev = editor.getAttributes("link").href ?? "";
    setUrl(prev);
    setNewTab(editor.getAttributes("link").target === "_blank");
    setEditing(true);
  }, [editor]);

  const apply = useCallback(() => {
    let href = url.trim();
    if (!href) {
      editor.chain().focus().unsetLink().run();
      setEditing(false);
      return;
    }
    if (!/^https?:\/\/|^mailto:/.test(href)) href = `https://${href}`;
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href, target: newTab ? "_blank" : null, rel: newTab ? "noopener noreferrer" : null })
      .run();
    setEditing(false);
  }, [editor, url, newTab]);

  const remove = useCallback(() => {
    editor.chain().focus().unsetLink().run();
    setEditing(false);
  }, [editor]);

  return (
    <BubbleMenu
      editor={editor}
      shouldShow={({ editor: e }) => e.isActive("link") || (!e.state.selection.empty && !editing)}
      options={{ placement: "top" }}
    >
      {editing || editor.isActive("link") ? (
        <div className="flex items-center gap-2 bg-bg-elevated border border-fg-subtle/25 rounded-lg shadow-lg p-2">
          {editing ? (
            <>
              <input
                autoFocus
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && apply()}
                placeholder="https://…"
                className="text-sm bg-bg-base border border-fg-subtle/30 rounded px-2 py-1.5 text-fg-primary outline-none w-56"
              />
              <label className="flex items-center gap-1.5 text-xs text-fg-muted whitespace-nowrap cursor-pointer">
                <input type="checkbox" checked={newTab} onChange={(e) => setNewTab(e.target.checked)} />
                new tab
              </label>
              <ToolbarButton onClick={apply} title="Apply">
                <LinkIcon size={15} />
              </ToolbarButton>
            </>
          ) : (
            <>
              <a
                href={editor.getAttributes("link").href}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm text-fg-accent flex items-center gap-1 px-1 max-w-[220px] truncate"
              >
                <ExternalLink size={13} />
                {editor.getAttributes("link").href}
              </a>
              <ToolbarButton onClick={openEditor} title="Edit link">
                <LinkIcon size={15} />
              </ToolbarButton>
              <ToolbarButton onClick={remove} title="Remove link">
                <Unlink size={15} />
              </ToolbarButton>
            </>
          )}
        </div>
      ) : (
        <div className="flex items-center bg-bg-elevated border border-fg-subtle/25 rounded-lg shadow-lg p-1">
          <ToolbarButton onClick={openEditor} title="Add link">
            <LinkIcon size={15} />
          </ToolbarButton>
        </div>
      )}
    </BubbleMenu>
  );
}

function ImageModal({ postId, onClose, onInsert }: { postId: string; onClose: () => void; onInsert: (src: string, alt: string) => void }) {
  const [tab, setTab] = useState<"upload" | "url">("upload");
  const [url, setUrl] = useState("");
  const [alt, setAlt] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);

  const submit = useCallback(async () => {
    if (!alt.trim()) {
      setError("Alt text is required");
      return;
    }
    setError(null);
    if (tab === "url") {
      if (!url.trim()) {
        setError("Enter an image URL");
        return;
      }
      onInsert(url.trim(), alt.trim());
      return;
    }
    if (!file) {
      setError("Choose a file");
      return;
    }
    setUploading(true);
    try {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const { url: uploadedUrl } = await blog.uploadMedia({
        post_id: postId,
        filename: file.name,
        content_type: file.type,
        data_base64: dataUrl,
      });
      onInsert(uploadedUrl, alt.trim());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  }, [tab, url, alt, file, postId, onInsert]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-bg-elevated border border-fg-subtle/20 rounded-xl p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-fg-primary">Insert image</h3>
          <button onClick={onClose} className="text-fg-muted hover:text-fg-primary cursor-pointer">
            <X size={18} />
          </button>
        </div>
        <div className="flex gap-2 mb-4">
          <button
            type="button"
            onClick={() => setTab("upload")}
            className={`text-sm px-3 py-1.5 rounded-md cursor-pointer ${tab === "upload" ? "bg-fg-accent/15 text-fg-accent" : "text-fg-muted"}`}
          >
            Upload
          </button>
          <button
            type="button"
            onClick={() => setTab("url")}
            className={`text-sm px-3 py-1.5 rounded-md cursor-pointer ${tab === "url" ? "bg-fg-accent/15 text-fg-accent" : "text-fg-muted"}`}
          >
            Paste URL
          </button>
        </div>
        {tab === "upload" ? (
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="w-full text-sm text-fg-muted mb-3"
          />
        ) : (
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
            className="w-full text-sm bg-bg-base border border-fg-subtle/30 rounded-md px-3 py-2 text-fg-primary outline-none mb-3"
          />
        )}
        <input
          value={alt}
          onChange={(e) => setAlt(e.target.value)}
          placeholder="Alt text (required)"
          className="w-full text-sm bg-bg-base border border-fg-subtle/30 rounded-md px-3 py-2 text-fg-primary outline-none mb-3"
        />
        {error && <p className="text-xs text-fg-accent mb-3">{error}</p>}
        <button
          type="button"
          onClick={submit}
          disabled={uploading}
          className="w-full py-2.5 rounded-md bg-fg-accent text-bg-base font-semibold text-sm disabled:opacity-50 cursor-pointer"
        >
          {uploading ? "Uploading…" : "Insert"}
        </button>
      </div>
    </div>
  );
}

function videoEmbedUrl(raw: string): string | null {
  const url = raw.trim();
  const yt = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{6,})/);
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`;
  const vimeo = url.match(/vimeo\.com\/(\d+)/);
  if (vimeo) return `https://player.vimeo.com/video/${vimeo[1]}`;
  const loom = url.match(/loom\.com\/share\/([\w-]+)/);
  if (loom) return `https://www.loom.com/embed/${loom[1]}`;
  return null;
}

function VideoModal({ onClose, onInsert }: { onClose: () => void; onInsert: (embedUrl: string) => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(() => {
    const embed = videoEmbedUrl(url);
    if (!embed) {
      setError("That doesn't look like a YouTube, Vimeo or Loom link.");
      return;
    }
    onInsert(embed);
  }, [url, onInsert]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div
        className="bg-bg-elevated border border-fg-subtle/20 rounded-xl p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-fg-primary">Embed video</h3>
          <button onClick={onClose} className="text-fg-muted hover:text-fg-primary cursor-pointer">
            <X size={18} />
          </button>
        </div>
        <input
          autoFocus
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="YouTube, Vimeo or Loom URL"
          className="w-full text-sm bg-bg-base border border-fg-subtle/30 rounded-md px-3 py-2 text-fg-primary outline-none mb-3"
        />
        {error && <p className="text-xs text-fg-accent mb-3">{error}</p>}
        <button
          type="button"
          onClick={submit}
          className="w-full py-2.5 rounded-md bg-fg-accent text-bg-base font-semibold text-sm cursor-pointer"
        >
          Insert
        </button>
      </div>
    </div>
  );
}

export default function BlogEditor({ postId, content, onUpdate, onWordStats }: BlogEditorProps) {
  const [showImageModal, setShowImageModal] = useState(false);
  const [showVideoModal, setShowVideoModal] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ link: false }),
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Link.configure({ openOnClick: false, autolink: false }),
      Image.configure({ HTMLAttributes: { class: "" } }),
      VideoEmbed,
      CharacterCount,
      Placeholder.configure({ placeholder: "Start writing…" }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      CtaBlock,
    ],
    content:
      typeof content === "string" ? content : content && Object.keys(content).length > 0 ? content : "",
    onUpdate: ({ editor: e }) => {
      onUpdate(e);
      const words = e.storage.characterCount?.words() ?? 0;
      onWordStats({ words, readingMinutes: Math.max(1, Math.ceil(words / 200)) });
    },
  });

  useEffect(() => {
    if (!editor) return;
    const words = editor.storage.characterCount?.words() ?? 0;
    onWordStats({ words, readingMinutes: Math.max(1, Math.ceil(words / 200)) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor]);

  if (!editor) return null;

  const insertImage = (src: string, alt: string) => {
    editor.chain().focus().setImage({ src, alt }).run();
    setShowImageModal(false);
  };

  const insertVideo = (embedUrl: string) => {
    editor.chain().focus().insertContent({ type: "videoEmbed", attrs: { src: embedUrl } }).run();
    setShowVideoModal(false);
  };

  const words = editor.storage.characterCount?.words() ?? 0;
  const readingMinutes = Math.max(1, Math.ceil(words / 200));

  return (
    <div className="flex flex-col border border-fg-subtle/20 rounded-xl bg-bg-elevated/30 overflow-hidden">
      {/* Toolbar */}
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-0.5 p-2 border-b border-fg-subtle/20 bg-bg-elevated">
        <ToolbarButton title="Bold" active={editor.isActive("bold")} onClick={() => editor.chain().focus().toggleBold().run()}>
          <Bold size={15} />
        </ToolbarButton>
        <ToolbarButton title="Italic" active={editor.isActive("italic")} onClick={() => editor.chain().focus().toggleItalic().run()}>
          <Italic size={15} />
        </ToolbarButton>
        <ToolbarButton title="Underline" active={editor.isActive("underline")} onClick={() => editor.chain().focus().toggleUnderline().run()}>
          <UnderlineIcon size={15} />
        </ToolbarButton>
        <ToolbarButton title="Strikethrough" active={editor.isActive("strike")} onClick={() => editor.chain().focus().toggleStrike().run()}>
          <Strikethrough size={15} />
        </ToolbarButton>
        <ToolbarButton title="Inline code" active={editor.isActive("code")} onClick={() => editor.chain().focus().toggleCode().run()}>
          <Code size={15} />
        </ToolbarButton>

        <Sep />

        <ToolbarButton title="Heading 2" active={editor.isActive("heading", { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
          <Heading2 size={15} />
        </ToolbarButton>
        <ToolbarButton title="Heading 3" active={editor.isActive("heading", { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
          <Heading3 size={15} />
        </ToolbarButton>
        <ToolbarButton title="Heading 4" active={editor.isActive("heading", { level: 4 })} onClick={() => editor.chain().focus().toggleHeading({ level: 4 }).run()}>
          <Heading4 size={15} />
        </ToolbarButton>

        <Sep />

        <ToolbarButton title="Bullet list" active={editor.isActive("bulletList")} onClick={() => editor.chain().focus().toggleBulletList().run()}>
          <List size={15} />
        </ToolbarButton>
        <ToolbarButton title="Numbered list" active={editor.isActive("orderedList")} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
          <ListOrdered size={15} />
        </ToolbarButton>
        <ToolbarButton title="Quote" active={editor.isActive("blockquote")} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
          <Quote size={15} />
        </ToolbarButton>
        <ToolbarButton title="Code block" active={editor.isActive("codeBlock")} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
          <Code size={15} />
        </ToolbarButton>
        <ToolbarButton title="Horizontal rule" onClick={() => editor.chain().focus().setHorizontalRule().run()}>
          <Minus size={15} />
        </ToolbarButton>

        <Sep />

        <ToolbarButton title="Align left" active={editor.isActive({ textAlign: "left" })} onClick={() => editor.chain().focus().setTextAlign("left").run()}>
          <AlignLeft size={15} />
        </ToolbarButton>
        <ToolbarButton title="Align center" active={editor.isActive({ textAlign: "center" })} onClick={() => editor.chain().focus().setTextAlign("center").run()}>
          <AlignCenter size={15} />
        </ToolbarButton>
        <ToolbarButton title="Align right" active={editor.isActive({ textAlign: "right" })} onClick={() => editor.chain().focus().setTextAlign("right").run()}>
          <AlignRight size={15} />
        </ToolbarButton>

        <Sep />

        <ToolbarButton title="Image" onClick={() => setShowImageModal(true)}>
          <ImageIcon size={15} />
        </ToolbarButton>
        <ToolbarButton title="Video" onClick={() => setShowVideoModal(true)}>
          <VideoIcon size={15} />
        </ToolbarButton>
        <ToolbarButton title="Table" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>
          <TableIcon size={15} />
        </ToolbarButton>
        <ToolbarButton title="Insert CTA block" onClick={() => editor.chain().focus().insertCtaBlock().run()}>
          <Sparkles size={15} />
        </ToolbarButton>

        <Sep />

        <ToolbarButton title="Undo" disabled={!editor.can().undo()} onClick={() => editor.chain().focus().undo().run()}>
          <Undo2 size={15} />
        </ToolbarButton>
        <ToolbarButton title="Redo" disabled={!editor.can().redo()} onClick={() => editor.chain().focus().redo().run()}>
          <Redo2 size={15} />
        </ToolbarButton>
      </div>

      {editor && <LinkBubbleMenu editor={editor} />}

      <div className="px-8 py-8 min-h-[420px] cursor-text" onClick={() => editor.chain().focus().run()}>
        <EditorContent editor={editor} className="blog-content" />
      </div>

      <div className="flex justify-end px-4 py-2 border-t border-fg-subtle/15 text-xs text-fg-subtle">
        {words} words · {readingMinutes} min read
      </div>

      {showImageModal && (
        <ImageModal postId={postId} onClose={() => setShowImageModal(false)} onInsert={insertImage} />
      )}
      {showVideoModal && <VideoModal onClose={() => setShowVideoModal(false)} onInsert={insertVideo} />}
    </div>
  );
}
