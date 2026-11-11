import { useEffect, useRef, useState } from 'react';

export const PAGE_SIZE_OPTIONS = [5, 10, 20, 50, 100, 500] as const;
export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

type Props = {
  pageSize: PageSize;
  onPageSizeChange: (size: PageSize) => void;
  onRefresh: () => void;
  refreshing?: boolean;
  rangeLabel?: string;
};

export default function TableSettingsMenu({
  pageSize,
  onPageSizeChange,
  onRefresh,
  refreshing = false,
  rangeLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="table-settings" ref={rootRef}>
      {rangeLabel ? <span className="table-settings-range">{rangeLabel}</span> : null}
      <button
        type="button"
        className={`table-settings-trigger${open ? ' open' : ''}`}
        aria-label="Table settings"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <GearIcon />
        <ChevronIcon />
      </button>
      {open ? (
        <div className="table-settings-menu" role="menu">
          <p className="table-settings-label">Entries per page</p>
          <div className="table-settings-sizes" role="group" aria-label="Entries per page">
            {PAGE_SIZE_OPTIONS.map((n) => (
              <button
                key={n}
                type="button"
                role="menuitemradio"
                aria-checked={pageSize === n}
                className={`table-settings-size${pageSize === n ? ' active' : ''}`}
                onClick={() => {
                  onPageSizeChange(n);
                  setOpen(false);
                }}
              >
                {n}
              </button>
            ))}
          </div>
          <div className="table-settings-divider" />
          <button
            type="button"
            role="menuitem"
            className="table-settings-refresh"
            disabled={refreshing}
            onClick={() => {
              onRefresh();
              setOpen(false);
            }}
          >
            <RefreshIcon />
            Refresh
          </button>
        </div>
      ) : null}

      <style>{`
        .table-settings {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 0.65rem;
          margin-left: auto;
          flex-shrink: 0;
        }
        .table-settings-range {
          color: var(--muted);
          font-size: 0.78rem;
          white-space: nowrap;
          font-weight: 550;
        }
        .table-settings-trigger {
          display: inline-flex;
          align-items: center;
          gap: 0.28rem;
          border: 1px solid var(--border);
          background: #f3f4f6;
          color: #111827;
          border-radius: 8px;
          padding: 0.28rem 0.45rem;
          cursor: pointer;
          line-height: 0;
        }
        .table-settings-trigger:hover,
        .table-settings-trigger.open {
          background: #e5e7eb;
          border-color: #d1d5db;
        }
        .table-settings-menu {
          position: absolute;
          top: calc(100% + 0.35rem);
          right: 0;
          z-index: 40;
          min-width: 260px;
          background: #fff;
          border: 1px solid var(--border);
          border-radius: 10px;
          box-shadow: 0 12px 32px rgba(17, 24, 39, 0.14);
          padding: 0.75rem 0.85rem;
        }
        .table-settings-label {
          margin: 0 0 0.45rem;
          font-size: 0.68rem;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: #4b5563;
        }
        .table-settings-sizes {
          display: grid;
          grid-template-columns: repeat(6, 1fr);
          gap: 0.3rem;
        }
        .table-settings-size {
          border: 1px solid var(--border);
          background: #fff;
          color: #111827;
          border-radius: 6px;
          padding: 0.4rem 0.2rem;
          font-weight: 650;
          font-size: 0.88rem;
          cursor: pointer;
        }
        .table-settings-size:hover { background: #f9fafb; }
        .table-settings-size.active {
          background: #e5e7eb;
          border-color: #d1d5db;
        }
        .table-settings-divider {
          height: 1px;
          background: var(--border);
          margin: 0.7rem 0 0.45rem;
        }
        .table-settings-refresh {
          display: flex;
          align-items: center;
          gap: 0.55rem;
          width: 100%;
          border: 0;
          background: transparent;
          color: #111827;
          border-radius: 6px;
          padding: 0.45rem 0.35rem;
          font-weight: 600;
          font-size: 0.92rem;
          cursor: pointer;
          text-align: left;
        }
        .table-settings-refresh:hover:not(:disabled) { background: #f3f4f6; }
        .table-settings-refresh:disabled { opacity: 0.55; cursor: default; }
      `}</style>
    </div>
  );
}

function GearIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"
        stroke="currentColor"
        strokeWidth="1.7"
      />
      <path
        d="M19.4 13a7.7 7.7 0 0 0 .1-1l2-1.15-2-3.45-2.3.5a7.6 7.6 0 0 0-1.7-1L15.2 4h-4.4l-.3 2.4a7.6 7.6 0 0 0-1.7 1l-2.3-.5-2 3.45L6.5 12a7.7 7.7 0 0 0 0 2l-2 1.15 2 3.45 2.3-.5a7.6 7.6 0 0 0 1.7 1l.3 2.4h4.4l.3-2.4a7.6 7.6 0 0 0 1.7-1l2.3.5 2-3.45-2-1.15Z"
        stroke="currentColor"
        strokeWidth="1.35"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path d="M6 9l6 6 6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function RefreshIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M20 12a8 8 0 1 1-2.3-5.7"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path d="M20 4v5h-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
