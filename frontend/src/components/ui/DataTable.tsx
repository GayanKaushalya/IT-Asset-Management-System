import type { ReactNode } from 'react';

type SearchBarProps = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onSubmit?: () => void;
};

export function SearchBar({ value, onChange, placeholder = 'Search…', onSubmit }: SearchBarProps) {
  return (
    <form
      className="toolbar"
      style={{ marginBottom: 0, flex: 1 }}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit?.();
      }}
    >
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-label={placeholder}
      />
      {onSubmit ? (
        <button type="submit" className="btn btn-soft">
          Search
        </button>
      ) : null}
    </form>
  );
}

type FilterBarProps = {
  children: ReactNode;
};

export function FilterBar({ children }: FilterBarProps) {
  return <div className="toolbar">{children}</div>;
}

type DataTableProps = {
  toolbar?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
};

export function DataTableShell({ toolbar, children, footer, className = '' }: DataTableProps) {
  return (
    <div className={`card list-card ${className}`.trim()}>
      {toolbar ? <div className="list-card-toolbar">{toolbar}</div> : null}
      <div className="asset-table-scroll">{children}</div>
      {footer ? <div className="list-card-footer">{footer}</div> : null}
    </div>
  );
}
