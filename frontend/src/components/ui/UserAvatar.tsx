type Props = {
  name?: string | null;
  size?: 'sm' | 'md';
  className?: string;
};

export default function UserAvatar({ name, size = 'md', className = '' }: Props) {
  const initial = (name || 'U').trim().slice(0, 1).toUpperCase() || 'U';
  return (
    <div className={`avatar ${size === 'sm' ? 'sm' : ''} primary ${className}`.trim()} aria-hidden>
      {initial}
    </div>
  );
}
