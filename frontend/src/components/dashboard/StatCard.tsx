import type { CSSProperties, ReactNode } from 'react';

interface StatCardProps {
  label: string;
  value: string;
  hint?: string;
}

const cardStyle: CSSProperties = {
  background: 'linear-gradient(160deg, #0f3d2e 0%, #1a5c45 55%, #0d2f24 100%)',
  color: '#f4f7f5',
  borderRadius: 12,
  padding: '1.25rem 1.4rem',
  boxShadow: '0 10px 30px rgba(13, 47, 36, 0.25)',
  minHeight: 110,
};

export function StatCard({ label, value, hint }: StatCardProps): ReactNode {
  return (
    <article style={cardStyle}>
      <p style={{ margin: 0, opacity: 0.8, fontSize: 13, letterSpacing: '0.04em' }}>{label}</p>
      <p style={{ margin: '0.45rem 0 0', fontSize: 28, fontWeight: 700 }}>{value}</p>
      {hint ? (
        <p style={{ margin: '0.35rem 0 0', fontSize: 12, opacity: 0.7 }}>{hint}</p>
      ) : null}
    </article>
  );
}
