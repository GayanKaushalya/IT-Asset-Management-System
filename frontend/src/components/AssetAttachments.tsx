import { useCallback, useEffect, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { api, downloadAuthenticated } from '../services/client';
import { useToast } from './ui/Toast';

export type AssetAttachment = {
  id: number;
  file_name: string;
  mime_type?: string | null;
  file_size?: number | null;
  uploaded_by_name?: string | null;
  created_at?: string | null;
};

const ALLOWED_EXT = [
  'jpg', 'jpeg', 'png', 'gif', 'webp',
  'pdf', 'txt', 'csv', 'log',
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
  'zip',
];
const MAX_FILES = 10;
const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPT = ALLOWED_EXT.map((e) => `.${e}`).join(',');

function formatSize(n?: number | null): string {
  if (n == null || Number.isNaN(n)) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.');
  return i >= 0 ? name.slice(i + 1).toLowerCase() : '';
}

function UploadIcon(): ReactNode {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  );
}

type Props = {
  /** When set, files upload immediately to this asset. */
  category?: string | null;
  assetId?: number | null;
  /** Staged files for create-before-id flow. */
  stagedFiles?: File[];
  onStagedFilesChange?: (files: File[]) => void;
  compact?: boolean;
};

export default function AssetAttachments({
  category,
  assetId,
  stagedFiles,
  onStagedFilesChange,
  compact = false,
}: Props) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<AssetAttachment[]>([]);
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const liveMode = Boolean(category && assetId && assetId > 0);

  const load = useCallback(async () => {
    if (!category || !assetId) return;
    setLoading(true);
    try {
      const res = await api<{ data: AssetAttachment[] }>(
        `/api/assets/${category}/${assetId}/attachments`,
      );
      setItems(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not load attachments');
    } finally {
      setLoading(false);
    }
  }, [category, assetId, toast]);

  useEffect(() => {
    if (liveMode) void load();
  }, [liveMode, load]);

  function validateFiles(incoming: File[], already: number): File[] {
    const room = MAX_FILES - already;
    if (room <= 0) {
      toast.error(`Maximum of ${MAX_FILES} files`);
      return [];
    }
    const accepted: File[] = [];
    for (const file of incoming) {
      if (accepted.length >= room) break;
      const ext = extOf(file.name);
      if (!ALLOWED_EXT.includes(ext)) {
        toast.error(`Not allowed: ${file.name}`);
        continue;
      }
      if (file.size <= 0 || file.size > MAX_BYTES) {
        toast.error(`${file.name} must be under 10 MB`);
        continue;
      }
      accepted.push(file);
    }
    return accepted;
  }

  async function uploadOne(file: File) {
    if (!category || !assetId) return;
    const body = new FormData();
    body.append('file', file);
    const res = await api<{ data: AssetAttachment[] }>(
      `/api/assets/${category}/${assetId}/attachments`,
      { method: 'POST', body },
    );
    setItems(Array.isArray(res.data) ? res.data : []);
  }

  async function handleFiles(list: FileList | File[] | null) {
    if (!list) return;
    const incoming = Array.from(list);
    if (liveMode) {
      const accepted = validateFiles(incoming, items.length);
      if (!accepted.length) return;
      setUploading(true);
      try {
        for (const file of accepted) {
          await uploadOne(file);
        }
        toast.success(accepted.length === 1 ? 'File uploaded' : `${accepted.length} files uploaded`);
      } catch (e) {
        toast.error(e instanceof Error ? e.message : 'Upload failed');
        await load();
      } finally {
        setUploading(false);
      }
      return;
    }
    if (!onStagedFilesChange) return;
    const current = stagedFiles ?? [];
    const accepted = validateFiles(incoming, current.length);
    if (!accepted.length) return;
    onStagedFilesChange([...current, ...accepted]);
  }

  async function removeLive(id: number) {
    if (!category || !assetId) return;
    if (!window.confirm('Remove this attachment?')) return;
    try {
      const res = await api<{ data: AssetAttachment[] }>(
        `/api/assets/${category}/${assetId}/attachments/${id}`,
        { method: 'DELETE' },
      );
      setItems(Array.isArray(res.data) ? res.data : []);
      toast.success('Attachment removed');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Delete failed');
    }
  }

  async function downloadLive(att: AssetAttachment) {
    if (!category || !assetId) return;
    try {
      await downloadAuthenticated(
        `/api/assets/${category}/${assetId}/attachments/${att.id}`,
        att.file_name || 'attachment',
      );
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Download failed');
    }
  }

  function onDrop(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
    void handleFiles(e.dataTransfer.files);
  }

  const staged = stagedFiles ?? [];
  const count = liveMode ? items.length : staged.length;

  return (
    <div className={`asset-attach${compact ? ' asset-attach--compact' : ''}`}>
      <div className="asset-attach-head">
        <h4 className="asset-attach-title">
          Attachments <span className="asset-attach-optional">(optional)</span>
        </h4>
        <span className="asset-attach-count">
          {count} / {MAX_FILES}
        </span>
      </div>

      <div
        className={`asset-attach-drop${dragOver ? ' is-drag' : ''}${uploading ? ' is-busy' : ''}`}
        role="button"
        tabIndex={0}
        onClick={() => !uploading && inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragEnter={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        <span className="asset-attach-icon" aria-hidden>
          <UploadIcon />
        </span>
        <p className="asset-attach-lead">
          {uploading ? 'Uploading…' : 'Drop files here or click to browse'}
        </p>
        <p className="asset-attach-hint">
          Up to {MAX_FILES} files, 10 MB each. Allowed: {ALLOWED_EXT.join(', ')}
        </p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          disabled={uploading}
          onChange={(e) => {
            void handleFiles(e.target.files);
            e.target.value = '';
          }}
        />
      </div>

      {liveMode && loading ? (
        <p className="asset-attach-empty">Loading attachments…</p>
      ) : null}

      {liveMode && items.length > 0 ? (
        <ul className="asset-attach-list">
          {items.map((att) => (
            <li key={att.id}>
              <button type="button" className="asset-attach-name" onClick={() => void downloadLive(att)}>
                {att.file_name}
              </button>
              <span className="asset-attach-meta">{formatSize(att.file_size)}</span>
              <button type="button" className="btn btn-soft btn-sm" onClick={() => void removeLive(att.id)}>
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {!liveMode && staged.length > 0 ? (
        <ul className="asset-attach-list">
          {staged.map((file, idx) => (
            <li key={`${file.name}-${file.size}-${idx}`}>
              <span className="asset-attach-name">{file.name}</span>
              <span className="asset-attach-meta">{formatSize(file.size)}</span>
              <button
                type="button"
                className="btn btn-soft btn-sm"
                onClick={() =>
                  onStagedFilesChange?.(staged.filter((_, i) => i !== idx))
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <style>{`
        .asset-attach { margin-top: 0.85rem; }
        .asset-attach-head {
          display: flex; align-items: baseline; justify-content: space-between;
          gap: 0.75rem; margin-bottom: 0.45rem;
        }
        .asset-attach-title {
          margin: 0; font-size: 0.95rem; font-weight: 700; color: #e2e8f0;
        }
        .asset-attach-optional { font-weight: 500; color: #94a3b8; font-size: 0.85rem; }
        .asset-attach-count { font-size: 0.78rem; color: #94a3b8; }
        .asset-attach-drop {
          border: 1.5px dashed #475569;
          border-radius: 14px;
          background: #0f172a;
          padding: 1.35rem 1rem;
          text-align: center;
          cursor: pointer;
          transition: border-color 0.15s ease, background 0.15s ease;
        }
        .asset-attach-drop:hover, .asset-attach-drop.is-drag {
          border-color: #3b82f6;
          background: #111827;
        }
        .asset-attach-drop.is-busy { opacity: 0.7; pointer-events: none; }
        .asset-attach-icon {
          width: 44px; height: 44px; border-radius: 999px;
          display: inline-grid; place-items: center;
          background: #2563eb; color: #fff; margin-bottom: 0.65rem;
        }
        .asset-attach-lead {
          margin: 0 0 0.35rem; color: #f8fafc; font-weight: 650; font-size: 0.95rem;
        }
        .asset-attach-hint {
          margin: 0; color: #94a3b8; font-size: 0.75rem; line-height: 1.45;
          max-width: 36rem; margin-inline: auto;
        }
        .asset-attach-list {
          list-style: none; margin: 0.75rem 0 0; padding: 0; display: grid; gap: 0.4rem;
        }
        .asset-attach-list li {
          display: flex; align-items: center; gap: 0.65rem; flex-wrap: wrap;
          padding: 0.45rem 0.65rem; border-radius: 10px;
          background: #f8fafc; border: 1px solid #e2e8f0;
        }
        .asset-attach-name {
          border: 0; background: transparent; padding: 0;
          font-weight: 650; color: #1e293b; cursor: pointer; text-align: left;
          flex: 1; min-width: 8rem;
        }
        button.asset-attach-name:hover { color: #2563eb; text-decoration: underline; }
        .asset-attach-meta { color: #64748b; font-size: 0.78rem; }
        .asset-attach-empty { margin: 0.55rem 0 0; color: #94a3b8; font-size: 0.85rem; }
        /* Light surfaces (add form) */
        .asset-form-sections .asset-attach-title,
        .aed-main .asset-attach-title { color: #0f172a; }
        .asset-form-sections .asset-attach-optional,
        .aed-main .asset-attach-optional,
        .asset-form-sections .asset-attach-count,
        .aed-main .asset-attach-count { color: #64748b; }
        .asset-form-sections .asset-attach-drop,
        .aed-main .asset-attach-drop {
          background: #0b1220;
        }
      `}</style>
    </div>
  );
}

/** Upload staged files after asset create. Returns count uploaded. */
export async function uploadStagedAssetFiles(
  category: string,
  assetId: number,
  files: File[],
): Promise<number> {
  let n = 0;
  for (const file of files.slice(0, MAX_FILES)) {
    const body = new FormData();
    body.append('file', file);
    await api(`/api/assets/${category}/${assetId}/attachments`, { method: 'POST', body });
    n += 1;
  }
  return n;
}
