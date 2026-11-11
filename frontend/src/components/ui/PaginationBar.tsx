import { useEffect, useRef, useState } from 'react';

type Props = {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
  disabled?: boolean;
  /** First page number reserved for Old stock (inclusive). */
  oldStockFromPage?: number | null;
};

export default function PaginationBar({
  page,
  totalPages,
  onPageChange,
  disabled = false,
  oldStockFromPage = null,
}: Props) {
  const pages = Math.max(1, totalPages);
  const current = Math.min(Math.max(1, page), pages);
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

  const go = (p: number) => {
    if (disabled) return;
    const next = Math.min(Math.max(1, p), pages);
    if (next !== current) onPageChange(next);
    setOpen(false);
  };

  return (
    <div className="pagination-bar" ref={rootRef}>
      <button
        type="button"
        className="pagination-btn"
        aria-label="First page"
        disabled={disabled || current <= 1}
        onClick={() => go(1)}
      >
        «
      </button>
      <button
        type="button"
        className="pagination-btn"
        aria-label="Previous page"
        disabled={disabled || current <= 1}
        onClick={() => go(current - 1)}
      >
        ‹
      </button>
      <div className="pagination-page-wrap">
        <button
          type="button"
          className="pagination-page"
          aria-haspopup="listbox"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => setOpen((v) => !v)}
        >
          <span>
            {oldStockFromPage != null && current >= oldStockFromPage
              ? 'Old stock'
              : `Page ${current} of ${pages}`}
          </span>
          <span className="pagination-caret" aria-hidden>
            ▾
          </span>
        </button>
        {open ? (
          <div className="pagination-dropdown" role="listbox">
            {Array.from({ length: pages }, (_, i) => i + 1).map((p) => {
              const isOld = oldStockFromPage != null && p >= oldStockFromPage;
              return (
                <button
                  key={p}
                  type="button"
                  role="option"
                  aria-selected={p === current}
                  className={`pagination-option${p === current ? ' active' : ''}${isOld ? ' old-stock' : ''}`}
                  onClick={() => go(p)}
                >
                  {isOld ? 'Old stock (all)' : `Page ${p}`}
                </button>
              );
            })}
          </div>
        ) : null}
      </div>
      <button
        type="button"
        className="pagination-btn"
        aria-label="Next page"
        disabled={disabled || current >= pages}
        onClick={() => go(current + 1)}
      >
        ›
      </button>
      <button
        type="button"
        className="pagination-btn"
        aria-label="Last page"
        disabled={disabled || current >= pages}
        onClick={() => go(pages)}
      >
        »
      </button>

      <style>{`
        .pagination-bar {
          display: inline-flex;
          align-items: stretch;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          overflow: visible;
          background: #fff;
          flex-shrink: 0;
        }
        .pagination-btn,
        .pagination-page {
          border: 0;
          background: #fff;
          color: #6b7280;
          font-size: 0.8rem;
          font-weight: 500;
          cursor: pointer;
          padding: 0.28rem 0.55rem;
          line-height: 1.2;
        }
        .pagination-btn {
          border-right: 1px solid #d1d5db;
          min-width: 1.9rem;
        }
        .pagination-btn:last-of-type {
          border-right: 0;
          border-left: 1px solid #d1d5db;
        }
        .pagination-btn:hover:not(:disabled),
        .pagination-page:hover:not(:disabled) {
          background: #f9fafb;
          color: #374151;
        }
        .pagination-btn:disabled,
        .pagination-page:disabled {
          opacity: 0.45;
          cursor: default;
        }
        .pagination-page-wrap {
          position: relative;
          border-right: 1px solid #d1d5db;
        }
        .pagination-page {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          min-width: 8.5rem;
          justify-content: space-between;
          white-space: nowrap;
        }
        .pagination-caret {
          font-size: 0.7rem;
          color: #9ca3af;
        }
        .pagination-dropdown {
          position: absolute;
          left: 0;
          top: calc(100% + 0.3rem);
          min-width: 100%;
          max-height: 220px;
          overflow: auto;
          background: #fff;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          box-shadow: 0 10px 28px rgba(17, 24, 39, 0.12);
          z-index: 30;
          padding: 0.25rem;
        }
        .pagination-option {
          display: block;
          width: 100%;
          border: 0;
          background: transparent;
          text-align: left;
          padding: 0.4rem 0.55rem;
          border-radius: 4px;
          color: #374151;
          font-size: 0.88rem;
          cursor: pointer;
        }
        .pagination-option:hover { background: #f3f4f6; }
        .pagination-option.active {
          background: #e5e7eb;
          font-weight: 650;
        }
        .pagination-option.old-stock {
          color: #b91c1c;
        }
      `}</style>
    </div>
  );
}
