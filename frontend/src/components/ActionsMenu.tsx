import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

type ActionsMenuProps = {
  onView: () => void;
  onUpdate: () => void;
  onDelete: () => void;
  onQr?: () => void;
  viewLabel?: string;
  viewDisabled?: boolean;
  deleteDisabled?: boolean;
  deleteBusy?: boolean;
};

export default function ActionsMenu({
  onView,
  onUpdate,
  onDelete,
  onQr,
  viewLabel = 'View',
  viewDisabled = false,
  deleteDisabled = false,
  deleteBusy = false,
}: ActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const [panelStyle, setPanelStyle] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;

    function place() {
      const btn = triggerRef.current;
      if (!btn) return;
      const rect = btn.getBoundingClientRect();
      const panelW = 168;
      const gap = 4;
      let left = rect.right - panelW;
      if (left < 8) left = 8;
      if (left + panelW > window.innerWidth - 8) {
        left = Math.max(8, window.innerWidth - panelW - 8);
      }
      // Prefer below; flip above if near bottom
      const below = rect.bottom + gap;
      const spaceBelow = window.innerHeight - below;
      const estHeight = 150;
      const top =
        spaceBelow < estHeight && rect.top > estHeight
          ? Math.max(8, rect.top - estHeight - gap)
          : below;
      setPanelStyle({
        position: 'fixed',
        top,
        left,
        zIndex: 12000,
        minWidth: panelW,
      });
    }

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;

    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }

    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function run(action: () => void) {
    setOpen(false);
    action();
  }

  const panel =
    open && typeof document !== 'undefined'
      ? createPortal(
          <div
            ref={panelRef}
            className="actions-menu-panel"
            role="menu"
            id={menuId}
            style={panelStyle}
          >
            <MenuButton tone="view" disabled={viewDisabled} onClick={() => run(onView)}>
              <IconEye />
              {viewLabel}
            </MenuButton>
            <MenuButton tone="update" onClick={() => run(onUpdate)}>
              <IconPencil />
              Update
            </MenuButton>
            <MenuButton
              tone="delete"
              disabled={deleteDisabled || deleteBusy}
              onClick={() => run(onDelete)}
            >
              {deleteBusy ? <IconSpinner /> : <IconTrash />}
              {deleteBusy ? '…' : 'Delete'}
            </MenuButton>
          </div>,
          document.body,
        )
      : null;

  return (
    <div className="actions-menu" ref={rootRef}>
      <div className="actions-row">
        {onQr ? (
          <button
            type="button"
            className="actions-qr-btn"
            title="Generate QR code"
            aria-label="Generate QR code"
            onClick={() => run(onQr)}
          >
            <IconQr />
            QR
          </button>
        ) : null}
        <div className="actions-split">
          <button
            type="button"
            className="actions-menu-primary"
            disabled={viewDisabled}
            onClick={() => run(onView)}
            title={viewLabel}
          >
            <IconEye />
            {viewLabel}
          </button>
          <button
            ref={triggerRef}
            type="button"
            className="actions-menu-trigger"
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={menuId}
            aria-label="More actions"
            onClick={() => setOpen((v) => !v)}
          >
            <ChevronIcon />
          </button>
        </div>
      </div>

      {panel}

      <style>{`
        .actions-menu {
          position: relative;
          display: inline-block;
        }
        .actions-row {
          display: inline-flex;
          align-items: center;
          gap: 0.35rem;
        }
        .actions-qr-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.3rem;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: #fff;
          color: #2563eb;
          padding: 0.4rem 0.55rem;
          font-weight: 700;
          font-size: 0.82rem;
          cursor: pointer;
        }
        .actions-qr-btn:hover {
          background: #eff6ff;
          border-color: #93c5fd;
        }
        .actions-qr-btn svg {
          width: 0.95rem;
          height: 0.95rem;
        }
        .actions-split {
          display: inline-flex;
          align-items: stretch;
          border: 1px solid var(--border);
          border-radius: 8px;
          overflow: hidden;
          background: #fff;
        }
        .actions-menu-primary {
          display: inline-flex;
          align-items: center;
          gap: 0.4rem;
          border: none;
          background: #fff;
          color: var(--text, #111827);
          padding: 0.4rem 0.7rem;
          font-weight: 650;
          font-size: 0.86rem;
          cursor: pointer;
        }
        .actions-menu-primary:hover:not(:disabled) {
          background: #f8fafc;
        }
        .actions-menu-primary:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .actions-menu-primary svg,
        .actions-menu-item svg {
          width: 0.95rem;
          height: 0.95rem;
          flex-shrink: 0;
        }
        .actions-menu-trigger {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          border: none;
          border-left: 1px solid var(--border);
          background: #fff;
          color: var(--text, #111827);
          padding: 0 0.45rem;
          cursor: pointer;
        }
        .actions-menu-trigger:hover {
          background: #f8fafc;
        }
        .actions-menu-panel {
          padding: 0.35rem;
          border-radius: 10px;
          background: #fff;
          border: 1px solid var(--border);
          box-shadow: 0 12px 28px rgba(17, 24, 39, 0.16);
          display: grid;
          gap: 0.3rem;
        }
        .actions-menu-item {
          border: 1.5px solid transparent;
          border-radius: 7px;
          padding: 0.45rem 0.7rem;
          font-weight: 700;
          font-size: 0.86rem;
          text-align: left;
          cursor: pointer;
          background: #fff;
          display: inline-flex;
          align-items: center;
          gap: 0.45rem;
        }
        .actions-menu-item:disabled {
          opacity: 0.55;
          cursor: not-allowed;
        }
        .actions-menu-item.view {
          color: #0d9488;
          border-color: #0d9488;
          background: #fff;
        }
        .actions-menu-item.view:hover:not(:disabled) {
          background: #f0fdfa;
        }
        .actions-menu-item.update {
          color: #2563eb;
          border-color: #2563eb;
          background: #fff;
        }
        .actions-menu-item.update:hover:not(:disabled) {
          background: #eff6ff;
        }
        .actions-menu-item.delete {
          color: #dc2626;
          border-color: #dc2626;
          background: #fff;
        }
        .actions-menu-item.delete:hover:not(:disabled) {
          background: #fef2f2;
        }
        .actions-menu-chevron {
          width: 0.85rem;
          height: 0.85rem;
          opacity: 0.7;
        }
        .actions-icon-spin {
          animation: actions-spin 0.8s linear infinite;
        }
        @keyframes actions-spin {
          to { transform: rotate(360deg); }
        }
      `}</style>
    </div>
  );
}

function MenuButton({
  tone,
  children,
  onClick,
  disabled,
}: {
  tone: 'view' | 'update' | 'delete';
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      className={`actions-menu-item ${tone}`}
      disabled={disabled}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function ChevronIcon() {
  return (
    <svg className="actions-menu-chevron" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
      <path d="M5.25 7.5L10 12.25 14.75 7.5" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconEye() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

function IconPencil() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function IconTrash() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M3 6h18" />
      <path d="M8 6V4h8v2" />
      <path d="M19 6l-1 14H6L5 6" />
      <path d="M10 11v6M14 11v6" />
    </svg>
  );
}

function IconSpinner() {
  return (
    <svg className="actions-icon-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <path d="M12 3a9 9 0 1 1-9 9" strokeLinecap="round" />
    </svg>
  );
}

function IconQr() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3M20 14v3M14 20h3M20 20h.01" />
    </svg>
  );
}
