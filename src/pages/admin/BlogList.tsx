import { useContext, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Pencil, Eye, Trash2, Send, Undo2 } from "lucide-react";
import { AuthContext } from "../../contexts/AuthContext";
import { blog, blogApiErrorMessage, type BlogPostSummary, type BlogPostStatus } from "../../lib/blogApi";
import { AdminLoading, AdminError, AdminEmpty } from "../../components/admin/AdminStatus";
import Modal from "../../components/Modal";

const STATUS_LABEL: Record<BlogPostStatus, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

const STATUS_CLASS: Record<BlogPostStatus, string> = {
  draft: "bg-warning/14 text-warning",
  published: "bg-success/14 text-success",
  archived: "bg-fg-subtle/20 text-fg-subtle",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function BlogList() {
  const navigate = useNavigate();
  const { platformRole } = useContext(AuthContext);
  // Docs/blog admin is superadmin-only for writes — staff gets read-only access
  // to this section (blog-admin edge function enforces the same split).
  const canWrite = platformRole === "superadmin";

  const [posts, setPosts] = useState<BlogPostSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<BlogPostStatus | "all">("all");
  const [q, setQ] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<BlogPostSummary | null>(null);

  function load() {
    setError(null);
    blog
      .list({ status: statusFilter === "all" ? undefined : statusFilter, q: q || undefined, limit: 100 })
      .then((res) => setPosts(res.posts))
      .catch((err) => setError(blogApiErrorMessage(err, "Couldn't load posts.")));
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter]);

  async function togglePublish(post: BlogPostSummary) {
    setBusyId(post.id);
    try {
      if (post.status === "published") {
        await blog.unpublish({ id: post.id });
      } else {
        await blog.publish({ id: post.id });
      }
      load();
    } catch (err) {
      setError(blogApiErrorMessage(err, "Action failed."));
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const post = pendingDelete;
    setBusyId(post.id);
    try {
      await blog.remove({ id: post.id });
      setPendingDelete(null);
      load();
    } catch (err) {
      setError(blogApiErrorMessage(err, "Delete failed."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as BlogPostStatus | "all")}
            className="text-[13px] bg-bg-elevated border border-fg-subtle/25 rounded-md px-2.5 py-1.5 text-fg-primary outline-none cursor-pointer"
          >
            <option value="all">All statuses</option>
            <option value="draft">Draft</option>
            <option value="published">Published</option>
            <option value="archived">Archived</option>
          </select>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && load()}
            placeholder="Search title…"
            className="text-[13px] bg-bg-elevated border border-fg-subtle/25 rounded-md px-2.5 py-1.5 text-fg-primary outline-none w-48"
          />
        </div>
        {canWrite && (
          <button
            onClick={() => navigate("/admin/blog/new")}
            className="inline-flex items-center gap-1.5 bg-fg-accent text-bg-base font-semibold text-[13px] rounded-md px-3 py-1.5 hover:opacity-90 transition-opacity duration-150 cursor-pointer"
          >
            <Plus size={14} /> New article
          </button>
        )}
      </div>

      {error && <AdminError message={error} />}

      <div className="bg-bg-elevated border border-fg-subtle/20 rounded-lg overflow-hidden">
        {posts === null ? (
          <AdminLoading />
        ) : posts.length === 0 ? (
          <AdminEmpty message="No articles match this filter." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-fg-subtle/15 text-left text-fg-subtle">
                  <th className="font-medium px-4 py-2.5">Title</th>
                  <th className="font-medium px-4 py-2.5">Status</th>
                  <th className="font-medium px-4 py-2.5">Author</th>
                  <th className="font-medium px-4 py-2.5">Updated</th>
                  <th className="font-medium px-4 py-2.5">Tags</th>
                  <th className="font-medium px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {posts.map((post) => (
                  <tr key={post.id} className="border-b border-fg-subtle/10 last:border-0">
                    <td className="px-4 py-2.5 text-fg-primary font-medium max-w-[280px] truncate">{post.title}</td>
                    <td className="px-4 py-2.5">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_CLASS[post.status]}`}>
                        {STATUS_LABEL[post.status]}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-fg-muted">{post.author_name ?? "—"}</td>
                    <td className="px-4 py-2.5 text-fg-muted whitespace-nowrap">{formatDateTime(post.updated_at)}</td>
                    <td className="px-4 py-2.5 text-fg-subtle text-xs">{post.tags.join(", ") || "—"}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {canWrite && (
                          <Link
                            to={`/admin/blog/${post.id}`}
                            title="Edit"
                            className="w-7 h-7 flex items-center justify-center rounded-md text-fg-muted hover:text-fg-primary hover:bg-bg-surface transition-colors duration-150"
                          >
                            <Pencil size={14} />
                          </Link>
                        )}
                        <a
                          href={`/blog/${post.slug}?preview=1`}
                          target="_blank"
                          rel="noopener noreferrer"
                          title="Preview"
                          className="w-7 h-7 flex items-center justify-center rounded-md text-fg-muted hover:text-fg-primary hover:bg-bg-surface transition-colors duration-150"
                        >
                          <Eye size={14} />
                        </a>
                        {canWrite && (
                          <button
                            onClick={() => togglePublish(post)}
                            disabled={busyId === post.id}
                            title={post.status === "published" ? "Unpublish" : "Publish"}
                            className="w-7 h-7 flex items-center justify-center rounded-md text-fg-muted hover:text-fg-primary hover:bg-bg-surface transition-colors duration-150 disabled:opacity-40 cursor-pointer"
                          >
                            {post.status === "published" ? <Undo2 size={14} /> : <Send size={14} />}
                          </button>
                        )}
                        {canWrite && (
                          <button
                            onClick={() => setPendingDelete(post)}
                            disabled={busyId === post.id}
                            title="Delete"
                            className="w-7 h-7 flex items-center justify-center rounded-md text-fg-muted hover:text-danger hover:bg-danger/10 transition-colors duration-150 disabled:opacity-40 cursor-pointer"
                          >
                            <Trash2 size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete article"
        footer={
          <>
            <button
              onClick={() => setPendingDelete(null)}
              className="text-sm text-fg-muted hover:text-fg-primary px-3.5 py-1.5 rounded-md transition-colors duration-150 cursor-pointer"
            >
              Cancel
            </button>
            <button
              onClick={confirmDelete}
              disabled={busyId === pendingDelete?.id}
              className="text-sm font-semibold text-bg-base bg-danger px-3.5 py-1.5 rounded-md hover:opacity-90 transition-opacity duration-150 disabled:opacity-50 cursor-pointer"
            >
              {busyId === pendingDelete?.id ? "Deleting…" : "Delete"}
            </button>
          </>
        }
      >
        <p className="text-sm text-fg-muted">
          Delete <span className="text-fg-primary font-medium">"{pendingDelete?.title}"</span>? This can&apos;t be
          undone.
        </p>
      </Modal>
    </div>
  );
}
