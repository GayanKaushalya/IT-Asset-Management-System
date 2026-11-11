import { Link } from 'react-router-dom';
import PageHeader from '../components/ui/PageHeader';
import { EmptyState } from '../components/ui/EmptyState';

type Props = {
  title: string;
  description: string;
  eyebrow?: string;
  actionLabel?: string;
  actionTo?: string;
};

export default function PlaceholderPage({
  title,
  description,
  eyebrow = 'Coming soon',
  actionLabel = 'Back to Dashboard',
  actionTo = '/',
}: Props) {
  return (
    <main className="page">
      <PageHeader title={title} subtitle={description} eyebrow={eyebrow} />
      <div className="card">
        <EmptyState
          title={`${title} is on the roadmap`}
          description="This module will be available in a future release. Existing asset, handover, and credential workflows remain fully available."
          action={
            <Link to={actionTo} className="btn btn-primary">
              {actionLabel}
            </Link>
          }
        />
      </div>
    </main>
  );
}
