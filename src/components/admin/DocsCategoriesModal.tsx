import { useContext, useEffect, useState } from "react";
import { ArrowUp, ArrowDown, Trash2, Plus } from "lucide-react";
import { AuthContext } from "../../contexts/AuthContext";
import { docs, docsApiErrorMessage, type DocsCategoryRow } from "../../lib/docsApi";
import Modal from "../Modal";
import { AdminError, AdminLoading } from "./AdminStatus";

export default function DocsCategoriesModal({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { platformRole } = useContext(AuthContext);
  const canWrite = platformRole === "superadmin";

  const [categories, setCategories] = useState<DocsCategoryRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newLabel, setNewLabel] = useState("");
  const [pendingDelete, setPendingDelete] = useState<DocsCategoryRow | null>(null);

  function load() {
    setError(null);
    docs
      .categoryList()
      .then((res) => setCategories(res.categories))
      .catch((err) => setError(docsApiErrorMessage(err, "Couldn't load categories.")));
  }

  useEffect(() => {
    if (open) load();
  }, [open]);

  async function renameLabel(cat: DocsCategoryRow, label: string) {
    if (label.trim() === cat.label || !label.trim()) return;
    setBusyId(cat.id);
    try {
      await docs.categoryUpdate({ id: cat.id, label: label.trim() });
      load();
      onChanged();
    } catch (err) {
      setError(docsApiErrorMessage(err, "Rename failed."));
    } finally {
      setBusyId(null);
    }
  }

  async function move(cat: DocsCategoryRow, direction: -1 | 1) {
    if (!categories) return;
    const idx = categories.findIndex((c) => c.id === cat.id);
    const swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= categories.length) return;
    const other = categories[swapIdx];

    setBusyId(cat.id);
    try {
      await docs.categoryReorder({
        items: [
          { id: cat.id, order_index: other.order_index },
          { id: other.id, order_index: cat.order_index },
        ],
      });
      load();
      onChanged();
    } catch (err) {
      setError(docsApiErrorMessage(err, "Reorder failed."));
    } finally {
      setBusyId(null);
    }
  }

  async function addCategory() {
    const label = newLabel.trim();
    if (!label) return;
    try {
      await docs.categoryCreate({ label });
      setNewLabel("");
      load();
      onChanged();
    } catch (err) {
      setError(docsApiErrorMessage(err, "Couldn't create the category."));
    }
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    const cat = pendingDelete;
    setBusyId(cat.id);
    try {
      await docs.categoryRemove({ id: cat.id });
      setPendingDelete(null);
      load();
      onChanged();
    } catch (err) {
      setError(docsApiErrorMessage(err, "Delete failed."));
    } finally {
      setBusyId(null);
    }
  }

  return (
    <>
      <Modal open={open} onClose={onClose} title="Manage categories">
        <div className="space-y-3 min-w-[380px]">
          {error && <AdminError message={error} />}

          {categories === null ? (
            <AdminLoading />
          ) : (
            <div className="space-y-1">
              {categories.map((cat, i) => (
                <div
                  key={cat.id}
                  className="flex items-center gap-2 bg-bg-elevated border border-fg-subtle/20 rounded-md px-2.5 py-1.5"
                >
                  <div className="flex items-center gap-0.5 shrink-0">
                    <button
                      onClick={() => move(cat, -1)}
                      disabled={i === 0 || busyId === cat.id}
                      title="Move up"
                      className="w-6 h-6 flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-bg-surface transition-colors duration-150 disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      onClick={() => move(cat, 1)}
                      disabled={i === categories.length - 1 || busyId === cat.id}
                      title="Move down"
                      className="w-6 h-6 flex items-center justify-center rounded text-fg-muted hover:text-fg-primary hover:bg-bg-surface transition-colors duration-150 disabled:opacity-30 cursor-pointer"
                    >
                      <ArrowDown size={13} />
                    </button>
                  </div>
                  <input
                    defaultValue={cat.label}
                    onBlur={(e) => renameLabel(cat, e.target.value)}
                    disabled={busyId === cat.id}
                    className="flex-1 min-w-0 text-sm bg-transparent outline-none text-fg-primary"
                  />
                  <span className="text-[11px] text-fg-subtle shrink-0">/{cat.slug}</span>
                  {canWrite && (
                    <button
                      onClick={() => setPendingDelete(cat)}
                      disabled={busyId === cat.id}
                      title="Delete"
                      className="w-6 h-6 shrink-0 flex items-center justify-center rounded text-fg-muted hover:text-danger hover:bg-danger/10 transition-colors duration-150 disabled:opacity-40 cursor-pointer"
                    >
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 pt-2 border-t border-fg-subtle/15">
            <input
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCategory()}
              placeholder="New category name"
              className="flex-1 text-sm bg-bg-base border border-fg-subtle/25 rounded-md px-2.5 py-1.5 text-fg-primary outline-none"
            />
            <button
              onClick={addCategory}
              className="inline-flex items-center gap-1.5 bg-fg-accent text-bg-base font-semibold text-xs rounded-md px-3 py-1.5 hover:opacity-90 transition-opacity duration-150 cursor-pointer shrink-0"
            >
              <Plus size={13} /> Add
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        title="Delete category"
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
          Delete <span className="text-fg-primary font-medium">"{pendingDelete?.label}"</span>? Pages still in this
          category will block the delete.
        </p>
      </Modal>
    </>
  );
}
