import type { ReactNode } from 'react';

export type AcceptanceEquipmentRow = {
  equipment_type: string;
  make_model: string;
  serial_imei: string;
  asset_tag: string;
  condition: string;
};

export type AcceptanceFormData = {
  form_title: string;
  company_name: string;
  company_short?: string;
  handover_id?: number;
  handover_ids?: number[];
  employee: {
    name: string;
    staff_id: string;
    designation: string;
    department: string;
    contact_number: string;
    company_email: string;
  };
  equipment: AcceptanceEquipmentRow[];
  location_name?: string;
  gate_pass_no?: string;
  checkout_remarks?: string;
  signatures: {
    employee_date: string;
    it_representative_name: string;
    it_date: string;
  };
};

function dash(v: string | undefined | null): string {
  if (v == null || String(v).trim() === '' || String(v).trim() === '—') return '';
  return String(v);
}

function formatDate(iso: string): string {
  const raw = dash(iso);
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw;
  const [y, m, d] = raw.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

function FieldLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="af-field">
      <span className="af-field-label">{label}:</span>
      <span className="af-field-value">{value || '\u00a0'}</span>
    </div>
  );
}

export default function AcceptanceFormPrint({ data }: { data: AcceptanceFormData }) {
  const company = data.company_name || 'Indra Traders';
  const rows: AcceptanceEquipmentRow[] = [...(data.equipment ?? [])];

  while (rows.length < 5) {
    rows.push({
      equipment_type: '',
      make_model: '',
      serial_imei: '',
      asset_tag: '',
      condition: '',
    });
  }

  return (
    <div className="acceptance-doc">
      {/* PAGE 1 — employee + equipment */}
      <article className="acceptance-form af-page af-page-1">
        <p className="af-page-label no-print">Page 1 of 2</p>
        <header className="af-header">
          <img className="af-logo" src="/indra-acceptance-logo.jpg" alt={company} />
          <h1>IT Hardware Acceptance Form</h1>
          <p className="af-intro">
            This form is to acknowledge the receipt of company-owned IT hardware and equipment. By
            signing this document, the employee agrees to the terms and conditions regarding the
            use, care, and return of the assigned equipment.
          </p>
        </header>

        <section className="af-section">
          <h2>1. Employee Information</h2>
          <div className="af-fields">
            <FieldLine label="Employee Name" value={dash(data.employee.name)} />
            <FieldLine label="Employee ID" value={dash(data.employee.staff_id)} />
            <FieldLine label="Designation/Job Title" value={dash(data.employee.designation)} />
            <FieldLine label="Department" value={dash(data.employee.department)} />
            <FieldLine label="Contact Number" value={dash(data.employee.contact_number)} />
            <FieldLine label="Company Email" value={dash(data.employee.company_email)} />
          </div>
        </section>

        <section className="af-section">
          <h2>2. Equipment Details</h2>
          <p className="af-note">Please list all devices and accessories provided to the employee.</p>
          <table className="af-table">
            <thead>
              <tr>
                <th>Equipment Type</th>
                <th>Make &amp; Model</th>
                <th>Serial Number / IMEI</th>
                <th>Asset Tag / IT ID</th>
                <th>Condition</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={`eq-${i}`}>
                  <td>{dash(row.equipment_type) || '\u00a0'}</td>
                  <td>{dash(row.make_model) || '\u00a0'}</td>
                  <td>{dash(row.serial_imei) || '\u00a0'}</td>
                  <td>{dash(row.asset_tag) || '\u00a0'}</td>
                  <td>{dash(row.condition) || '\u00a0'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {dash(data.checkout_remarks) ? (
            <div className="af-remarks">
              <FieldLine label="Handover remarks" value={dash(data.checkout_remarks)} />
            </div>
          ) : null}
        </section>
      </article>

      {/* PAGE 2 — terms + signatures (Word form design) */}
      <article className="acceptance-form af-page af-page-2">
        <p className="af-page-label no-print">Page 2 of 2</p>

        <section className="af-section">
          <h2>3. Terms and Conditions of Use</h2>
          <p className="af-terms-lead">
            By accepting the equipment listed above, I acknowledge and agree to the following terms:
          </p>
          <ol className="af-terms">
            <Term title="Company Property">
              I understand that the hardware and accessories listed above are the sole property of{' '}
              {company} and are provided to me for business purposes.
            </Term>
            <Term title="Acceptable Use">
              I will use the equipment in accordance with the company&apos;s IT and Acceptable Use
              Policies. I will not install unauthorized software or use the devices for illegal or
              inappropriate activities.
            </Term>
            <Term title="Care and Security">
              I will take all reasonable and necessary precautions to protect the equipment from
              damage, theft, or loss. I will not leave the equipment unattended in public or
              unsecured locations.
            </Term>
            <Term title="Reporting">
              In the event of damage, malfunction, loss, or theft, I will immediately report the
              incident to the IT Division.
            </Term>
            <Term title="Data Security">
              I will ensure that company data stored on the device is protected, utilizing required
              passwords, screen locks, and encryption as mandated by the IT Division.
            </Term>
            <Term title="Return of Equipment">
              I agree to return all issued equipment and accessories immediately upon request by the
              IT Division, or upon termination of my employment with {company}. I understand that
              failure to return the equipment, or returning it in a damaged state beyond normal wear
              and tear, may result in deductions from my final settlement or further necessary
              action.
            </Term>
          </ol>
        </section>

        <section className="af-section af-signatures">
          <h2>4. Signatures</h2>
          <div className="af-sign-block">
            <h3>Employee Declaration:</h3>
            <p>
              I hereby acknowledge receipt of the equipment listed above in good working condition.
              I have read, understood, and agree to abide by the terms and conditions outlined in
              this form.
            </p>
            <div className="af-sign-grid">
              <FieldLine label="Employee Signature" value="" />
              <FieldLine label="Date" value={formatDate(data.signatures.employee_date)} />
            </div>
          </div>
          <div className="af-sign-block">
            <h3>IT Division Authorization:</h3>
            <p>Issued and verified by the IT Division.</p>
            <div className="af-sign-grid af-sign-grid-stack">
              <FieldLine
                label="IT Representative Name"
                value={dash(data.signatures.it_representative_name)}
              />
              <FieldLine label="IT Representative Signature" value="" />
              <FieldLine label="Date" value={formatDate(data.signatures.it_date)} />
            </div>
          </div>
        </section>
      </article>
    </div>
  );
}

function Term({ title, children }: { title: string; children: ReactNode }) {
  return (
    <li>
      <strong>{title}:</strong> {children}
    </li>
  );
}
