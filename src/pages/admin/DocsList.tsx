import { useContext, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Plus, Pencil, Eye, Trash2, Send, Undo2, ArrowUp, ArrowDown, Settings2 } from "lucide-react";
import { AuthContext } from "../../contexts/AuthContext";
import {
  docs,
  docsApiErrorMessage,
  type DocsCategory,
  type DocsCategoryRow,
  type DocsPageSummary,
  type DocsPageStatus,
} from "../../lib/docsApi";
import { AdminLoading, AdminError, AdminEmpty } from "../../components/admin/AdminStatus";
import DocsCategoriesModal from "../../components/admin/DocsCategoriesModal";
import Modal from "../../components/Modal";

const STATUS_LABEL: Record<DocsPageStatus, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

const STATUS_CLASS: Record<DocsPageStatus, string> = {
  draft: "bg-warning/14 text-warning",
  published: "bg-success/14 text-success",
  archived: "bg-fg-subtle/20 text-fg-subtle",
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default function DocsList() {
  const navigate = useNavigate();
  const { platformRole } = useContext(AuthContext);
  // Docs/blog admin is superadmin-only for writes — staff gets read-only access
  // to this section (docs-admin edge function enforces the same split).
  const canWrite = platformRole === "superadmin";

  const [pages, setPages] = useState<DocsPageSummary[] | null>(null);
  const [categories, setCategories] = useState<DocsCategoryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<DocsPageSummary | null>(null);
  const [categoriesModalOpen, setCategoriesModalOpen] = useState(false);

  function load() {
    setError(null);
    docs
      .list()
      .then((res) => setPages(res.pages))
      .catch((err) => setError(docsApiErrorMessage(err, "Couldn't load pages.")));
    docs
      .categoryList()
      .then((res) => setCategories(res.categories))
      .catch((err) => setError(docsApiErrorMessage(err, "Couldn't load categories.")));
  }

  useEffect(() => {
    load();
  }, []);

  async function togglePublish(page: DocsPageSummary) {
    setBusyId(page.id);
    try {
      if (page.status === "published") {
        await docs.unpublish({ id: page.id });
      } else {
        await docs.publish({ id: page.id });
      }
      load();
    } catch (err) {
      setError(docsApiErrorMessage(err, "Action failed."));
    } finally {
      setBusyId(null);
    }
  }

  async function move(category: DocsCategory, page: DocsPageSummary, direction: -1 | 1) {
    const inCategory = (pages ?? []).filter((p) => p.category === category);
    const idx = inCategory.findIndex((p) => p.id === page.id);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= inCategory.length) return;
    const other = inCategory[swapIdx];

    setBusyId(page.id);
    try {
      await docs.reorder({
        items: [
          { id: page.id, order_index: other.order_index },
          { id: other.id, order_index: page.order_index },
        ],
      });
      load();
    } catch (err) {
      setError(docsApiErrorMessage(err, "Reorder failed."));
    } finally {
      setBusyId(null);
    }
  }

  async function addPage(category: DocsCategory) {
    try {
      const { page } = await docs.create({ title: "Untitled", category });
      navigate(`/admin/docs/${page.id}`);
    } catch (err) {
      setError(docsApiErrorMessage(err, "Couldn't create the page."));
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const page = pendingDelete;
    setBusyId(page.id);
    try {
      await docs.remove({ id: page.id });
      setPendingDelete(null);
      load();
    } catch (err) {
      setError(docsApiErrorMessage(err, "Delete failed."));
    } finally {
      setBusyId(null);
    }
  }

  const grouped = categories.map((category) => ({
    category: category.slug,
    label: category.label,
    pages: (pages ?? []).filter((p) => p.category === category.slug).sort((a, b) => a.order_index - b.order_index),
  }));

  return (
    <div className="space-y-6">
      {canWrite && (
        <div className="flex justify-end">
          <button
            onClick={() => setCategoriesModalOpen(true)}
            className="inline-flex items-center gap-1.5 text-fg-muted hover:text-fg-primary text-xs font-medium border border-fg-subtle/25 rounded-md px-2.5 py-1.5 transition-colors duration-150 cursor-pointer"
          >
            <Settings2 size={13} /> Manage categories
          </button>
        </div>
      )}

      {error && <AdminError message={error} />}

      {pages === null ? (
        <AdminLoading />
      ) : (
        grouped.map((g) => (
          <div key={g.category} className="bg-bg-elevated border border-fg-subtle/20 rounded-lg overflow-hidden">
            <div className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-fg-subtle/15">
              <h2 className="text-sm font-semibold text-fg-primary">{g.label}</h2>
              {canWrite && (
                <button
                  onClick={() => addPage(g.category)}
                  className="inline-flex items-center gap-1.5 text-fg-muted hover:text-fg-primary text-xs font-medium transition-colors duration-150 cursor-pointer"
                >
                  <Plus size={13} /> Add page
                </button>
              )}
            </div>

            {g.pages.length === 0 ? (
              <AdminEmpty message="No pages in this category yet." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <tbody>
                    {g.pages.map((page, i) => (
                      <tr key={page.id} className="border-b border-fg-subtle/10 last:border-0">
                        <td className="px-4 py-2.5 w-16">
                          {canWrite && (
                            <div className="flex items-center gap-0.5">
                              <button
                                onClick={() => move(g.category, page, -1)}
                                disabled={i === 0 || busyId === page.id}
                                title="Move up"
                                className="w-6 h-6 flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-bg-surface transition-colors duration-150 disabled:opacity-30 cursor-pointer"
                              >
                                <ArrowUp size={13} />
                              </button>
                              <button
                                onClick={() => move(g.category, page, 1)}
                                disabled={i === g.pages.length - 1 || busyId === page.id}
                                title="Move down"
                                className="w-6 h-6 flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-bg-surface transition-colors duration-150 disabled:opacity-30 cursor-pointer"
                              >
                                <ArrowDown size={13} />
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-fg-primary font-medium max-w-[320px] truncate">{page.title}</td>
                        <td className="px-4 py-2.5">
                          <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_CLASS[page.status]}`}>
                            {STATUS_LABEL[page.status]}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-fg-muted whitespace-nowrap">{formatDateTime(page.updated_at)}</td>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center justify-end gap-1">
                            {canWrite && (
                              <Link
                                to={`/admin/docs/${page.id}`}
                                title="Edit"
                                className="w-7 h-7 flex items-center justify-center rounded-md text-fg-muted hover:text-fg-primary hover:bg-bg-surface transition-colors duration-150"
                              >
                                <Pencil size={14} />
                              </Link>
                            )}
                            <a
                              href={`/docs/${page.slug}?preview=1`}
                              target="_blank"
                              rel="noopener noreferrer"
                              title="Preview"
                              className="w-7 h-7 flex items-center justify-center rounded-md text-fg-muted hover:text-fg-primary hover:bg-bg-surface transition-colors duration-150"
                            >
                              <Eye size={14} />
                            </a>
                            {canWrite && (
                              <button
                                onClick={() => togglePublish(page)}
                                disabled={busyId === page.id}
                                title={page.status === "published" ? "Unpublish" : "Publish"}
                                className="w-7 h-7 flex items-center justify-center rounded-md text-fg-muted hover:text-fg-primary hover:bg-bg-surface transition-colors duration-150 disabled:opacity-40 cursor-pointer"
                              >
                                {page.status === "published" ? <Undo2 size={14} /> : <Send size={14} />}
                              </button>
                            )}
                            {canWrite && (
                              <button
                                onClick={() => setPendingDelete(page)}
                                disabled={busyId === page.id}
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
        ))
      )}

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete page"
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

      <DocsCategoriesModal
        open={categoriesModalOpen}
        onClose={() => setCategoriesModalOpen(false)}
        onChanged={load}
      />
    </div>
  );
}
