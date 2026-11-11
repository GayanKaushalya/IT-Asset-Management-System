import PageHeader from '../components/ui/PageHeader';
import AgreementsPanel from './AgreementsPanel';

/** Standalone Agreements under Asset Management (sidebar). */
export default function AgreementsPage() {
  return (
    <main className="page page--fill">
      <PageHeader
        eyebrow="Asset Management"
        title="Agreements"
        subtitle="Vendor software, hardware, and networking agreements — terms, renewals, and change history."
      />
      <AgreementsPanel />
    </main>
  );
}
