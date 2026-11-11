import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export type ToastTone = 'success' | 'error' | 'info';

type ToastItem = {
  id: number;
  message: string;
  tone: ToastTone;
};

type ToastApi = {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
};

const ToastContext = createContext<ToastApi | null>(null);

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const timers = useRef<Map<number, number>>(new Map());

  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t) window.clearTimeout(t);
    timers.current.delete(id);
    setItems((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const push = useCallback(
    (message: string, tone: ToastTone) => {
      const id = nextId++;
      setItems((prev) => [...prev.slice(-4), { id, message, tone }]);
      const timer = window.setTimeout(() => dismiss(id), 4200);
      timers.current.set(id, timer);
    },
    [dismiss],
  );

  useEffect(() => {
    return () => {
      timers.current.forEach((t) => window.clearTimeout(t));
      timers.current.clear();
    };
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      success: (message) => push(message, 'success'),
      error: (message) => push(message, 'error'),
      info: (message) => push(message, 'info'),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-relevant="additions">
        {items.map((item) => (
          <div key={item.id} className={`toast-banner toast-${item.tone}`} role="status">
            <span className="toast-icon" aria-hidden>
              {item.tone === 'success' ? '✓' : item.tone === 'error' ? '!' : 'i'}
            </span>
            <span className="toast-message">{item.message}</span>
            <button type="button" className="toast-close" aria-label="Dismiss" onClick={() => dismiss(item.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
      <style>{`
        .toast-stack {
          position: fixed;
          top: 1rem;
          left: 50%;
          transform: translateX(-50%);
          z-index: 10000;
          display: flex;
          flex-direction: column;
          gap: 0.5rem;
          width: min(520px, calc(100vw - 1.5rem));
          pointer-events: none;
        }
        .toast-banner {
          pointer-events: auto;
          display: flex;
          align-items: center;
          gap: 0.65rem;
          padding: 0.75rem 0.9rem;
          border-radius: 10px;
          box-shadow: 0 10px 30px rgba(15, 23, 42, 0.18);
          font-size: 0.92rem;
          font-weight: 600;
          animation: toast-in 0.22s ease-out;
          border: 1px solid transparent;
        }
        .toast-success {
          background: #ecfdf5;
          color: #065f46;
          border-color: #a7f3d0;
        }
        .toast-error {
          background: #fef2f2;
          color: #991b1b;
          border-color: #fecaca;
        }
        .toast-info {
          background: #eff6ff;
          color: #1e40af;
          border-color: #bfdbfe;
        }
        .toast-icon {
          width: 1.4rem;
          height: 1.4rem;
          border-radius: 999px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          font-size: 0.75rem;
          flex-shrink: 0;
          background: rgba(255,255,255,0.7);
        }
        .toast-message { flex: 1; line-height: 1.35; }
        .toast-close {
          border: 0;
          background: transparent;
          color: inherit;
          font-size: 1.15rem;
          line-height: 1;
          cursor: pointer;
          opacity: 0.7;
          padding: 0 0.15rem;
        }
        .toast-close:hover { opacity: 1; }
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(-8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    return {
      success: () => undefined,
      error: () => undefined,
      info: () => undefined,
    };
  }
  return ctx;
}
