import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { api } from '../services/client';

export type EmployeeHit = {
  id: number;
  staff_id: string;
  epf_number?: string | null;
  name: string;
  title?: string | null;
  display_name: string;
  employment_status?: string | null;
  directory_tag?: string | null;
  designation?: string | null;
  department_name?: string | null;
  work_location?: string | null;
  company_code?: string | null;
  company_short?: string | null;
};

function directoryTagInfo(
  emp: EmployeeHit,
): { label: string; tone: 'current' | 'probation' | 'former' | 'other' } | null {
  const raw = String(emp.directory_tag || emp.employment_status || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '');
  if (!raw) return null;
  if (raw === 'former' || raw === 'exemployee') return { label: 'Former', tone: 'former' };
  if (raw === 'probation') return { label: 'Probation', tone: 'probation' };
  if (raw === 'current') return { label: 'Current', tone: 'current' };
  const label = String(emp.directory_tag || emp.employment_status || '').trim();
  return label ? { label, tone: 'other' } : null;
}

type Props = {
  value: string;
  onChange: (value: string, employee?: EmployeeHit) => void;
  /** Limit suggestions to one company. Ignored when allCompanies is true. */
  companyCode?: string;
  /** Search ITL + IMS + ISP together (default for asset forms). */
  allCompanies?: boolean;
  className?: string;
  inputClassName?: string;
  placeholder?: string;
  required?: boolean;
  disabled?: boolean;
  autoFocus?: boolean;
};

function normalizeCompany(code?: string): string {
  const c = (code || '').toUpperCase();
  if (c === 'ITL') return 'IT';
  return c;
}

function companyLabel(emp: EmployeeHit): string {
  const short = String(emp.company_short || '').trim();
  if (short) return short;
  const code = String(emp.company_code || '').trim().toUpperCase();
  if (code === 'IT') return 'ITL';
  return code;
}

export default function EmployeeNameInput({
  value,
  onChange,
  companyCode,
  allCompanies = false,
  className,
  inputClassName = 'asset-control bare',
  placeholder = 'Type employee name…',
  required,
  disabled,
  autoFocus,
}: Props) {
  const listId = useId();
  const wrapRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<EmployeeHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const skipSearchRef = useRef(false);

  useEffect(() => {
    if (skipSearchRef.current) {
      skipSearchRef.current = false;
      return;
    }
    const q = value.trim();
    if (q.length < 2 || disabled) {
      setHits([]);
      setLoading(false);
      return;
    }

    const t = window.setTimeout(() => {
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setLoading(true);
      const params = new URLSearchParams();
      params.set('q', q);
      params.set('limit', allCompanies ? '25' : '12');
      if (!allCompanies) {
        const co = normalizeCompany(companyCode);
        if (co && co !== 'ALL') params.set('company', co);
      }

      void api<{ data: EmployeeHit[] }>(`/api/employees?${params.toString()}`, {
        signal: ac.signal,
      })
        .then((res) => {
          if (ac.signal.aborted) return;
          setHits(Array.isArray(res.data) ? res.data : []);
          setActive(0);
          setOpen(true);
        })
        .catch((e) => {
          if (e instanceof DOMException && e.name === 'AbortError') return;
          setHits([]);
        })
        .finally(() => {
          if (!ac.signal.aborted) setLoading(false);
        });
    }, 180);

    return () => {
      window.clearTimeout(t);
      abortRef.current?.abort();
    };
  }, [value, companyCode, allCompanies, disabled]);

  const showList = open && !disabled && (loading || hits.length > 0 || value.trim().length >= 2);

  useLayoutEffect(() => {
    if (!showList) {
      setMenuStyle(null);
      return;
    }

    function place() {
      const el = wrapRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const gap = 4;
      const maxH = Math.min(280, window.innerHeight * 0.42);
      const spaceBelow = window.innerHeight - r.bottom - gap;
      const spaceAbove = r.top - gap;
      const openUp = spaceBelow < Math.min(160, maxH) && spaceAbove > spaceBelow;
      const width = Math.min(Math.max(r.width, 22 * 16), Math.min(36 * 16, window.innerWidth * 0.92));
      const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
      const style: CSSProperties = {
        position: 'fixed',
        left,
        width,
        zIndex: 10050,
        maxHeight: maxH,
      };
      if (openUp) {
        style.bottom = window.innerHeight - r.top + gap;
        style.top = 'auto';
      } else {
        style.top = r.bottom + gap;
        style.bottom = 'auto';
      }
      setMenuStyle(style);
    }

    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [showList, hits.length, loading, value]);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (wrapRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  function pick(emp: EmployeeHit) {
    const label = (emp.display_name || emp.name || '').trim();
    skipSearchRef.current = true;
    setHits([]);
    setOpen(false);
    onChange(label, emp);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!open || hits.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => (i + 1) % hits.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => (i - 1 + hits.length) % hits.length);
    } else if (e.key === 'Enter' && hits[active]) {
      e.preventDefault();
      pick(hits[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const list =
    showList && menuStyle ? (
      <ul
        ref={listRef}
        id={listId}
        className="emp-suggest-list emp-suggest-list--portal"
        role="listbox"
        style={menuStyle}
        onWheel={(e) => e.stopPropagation()}
        onTouchMove={(e) => e.stopPropagation()}
      >
        {loading && hits.length === 0 ? (
          <li className="emp-suggest-empty">Searching employees…</li>
        ) : null}
        {!loading && hits.length === 0 ? (
          <li className="emp-suggest-empty">No matching employees</li>
        ) : null}
        {hits.map((emp, i) => {
          const staff = String(emp.staff_id || '').trim();
          const epf = String(emp.epf_number || '').trim();
          const co = companyLabel(emp);
          const tag = directoryTagInfo(emp);
          const meta = [
            co || null,
            staff ? `Emp #${staff}` : null,
            epf && epf !== staff ? `EPF ${epf}` : null,
            emp.department_name || null,
            emp.designation || null,
          ]
            .filter(Boolean)
            .join(' · ');
          return (
            <li key={emp.id} role="option" aria-selected={i === active}>
              <button
                type="button"
                className={`emp-suggest-item${i === active ? ' active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => pick(emp)}
              >
                <span className="emp-suggest-name-row">
                  <span className="emp-suggest-name">{emp.display_name || emp.name}</span>
                  {tag ? (
                    <span className={`emp-suggest-tag emp-suggest-tag--${tag.tone}`}>
                      {tag.label}
                    </span>
                  ) : null}
                </span>
                {meta ? <span className="emp-suggest-meta">{meta}</span> : null}
              </button>
            </li>
          );
        })}
      </ul>
    ) : null;

  return (
    <div className={`emp-suggest ${className ?? ''}`.trim()} ref={wrapRef}>
      <input
        className={inputClassName}
        value={value}
        required={required}
        disabled={disabled}
        autoFocus={autoFocus}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        onFocus={() => {
          if (hits.length > 0) setOpen(true);
        }}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {list ? createPortal(list, document.body) : null}
    </div>
  );
}
