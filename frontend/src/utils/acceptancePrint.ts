import type { AcceptanceEquipmentRow, AcceptanceFormData } from '../components/AcceptanceFormPrint';

function esc(v: string): string {
  return v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

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

function field(label: string, value: string): string {
  return `<div class="af-field"><span class="af-field-label">${esc(label)}:</span><span class="af-field-value">${esc(value) || '&nbsp;'}</span></div>`;
}

function padEquipment(rows: AcceptanceEquipmentRow[]): AcceptanceEquipmentRow[] {
  const out = [...rows];
  while (out.length < 5) {
    out.push({
      equipment_type: '',
      make_model: '',
      serial_imei: '',
      asset_tag: '',
      condition: '',
    });
  }
  return out;
}

const PRINT_CSS = `
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0;
    padding: 0;
    background: #fff;
    color: #111;
    font-family: Calibri, "Segoe UI", Arial, sans-serif;
    font-size: 11pt;
    line-height: 1.4;
  }
  .af-page { page-break-after: always; }
  .af-page:last-child { page-break-after: auto; }
  .af-header { text-align: center; }
  .af-logo {
    display: block;
    max-width: 220px;
    max-height: 72px;
    margin: 0 auto 0.65rem;
    object-fit: contain;
  }
  h1 {
    margin: 0 0 0.7rem;
    font-size: 18pt;
    font-weight: 700;
  }
  .af-intro { margin: 0 0 1rem; text-align: justify; }
  .af-section { margin-top: 0.95rem; }
  .af-section h2 {
    margin: 0 0 0.45rem;
    font-size: 12pt;
    font-weight: 700;
  }
  .af-section h3 {
    margin: 0 0 0.3rem;
    font-size: 11pt;
    font-weight: 700;
  }
  .af-note, .af-terms-lead { margin: 0 0 0.45rem; }
  .af-fields { display: grid; gap: 0.4rem; }
  .af-field {
    display: grid;
    grid-template-columns: 10.5rem minmax(0, 1fr);
    gap: 0.4rem;
    align-items: end;
  }
  .af-field-value {
    border-bottom: 1px solid #333;
    min-height: 1.2rem;
    padding: 0 0.1rem 0.05rem;
    font-weight: 600;
  }
  .af-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    table-layout: fixed;
    font-size: 9.5pt;
    margin-top: 0.25rem;
    border: 1.5pt solid #000;
  }
  .af-table th,
  .af-table td {
    border-right: 1pt solid #000;
    border-bottom: 1pt solid #000;
    padding: 0.35rem 0.4rem;
    text-align: left;
    vertical-align: middle;
    word-break: break-word;
    background: #fff;
  }
  .af-table th:last-child,
  .af-table td:last-child {
    border-right: none;
  }
  .af-table tr:last-child td {
    border-bottom: none;
  }
  .af-table th {
    font-weight: 700;
    text-align: center;
    background: #f3f4f6;
  }
  .af-table td {
    height: 1.85rem;
    min-height: 1.85rem;
  }
  .af-remarks {
    margin-top: 0.75rem;
  }
  .af-terms {
    margin: 0.35rem 0 0;
    padding-left: 1.2rem;
    display: grid;
    gap: 0.45rem;
  }
  .af-terms li { text-align: justify; }
  .af-sign-block { margin-top: 0.95rem; }
  .af-signatures { margin-top: 1.15rem; }
  .af-sign-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 0.7rem 1.25rem;
    margin-top: 0.7rem;
  }
  .af-sign-grid-stack {
    grid-template-columns: 1fr;
    max-width: 28rem;
  }
  .toolbar {
    position: sticky;
    top: 0;
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: #fff;
    border-bottom: 1px solid #e5e7eb;
  }
  .toolbar button {
    font: inherit;
    padding: 0.55rem 1rem;
    border-radius: 8px;
    border: 1px solid #cbd5e1;
    background: #2563eb;
    color: #fff;
    cursor: pointer;
    font-weight: 650;
  }
  .toolbar button.secondary {
    background: #fff;
    color: #111;
  }
  .sheet {
    width: min(820px, 100%);
    margin: 1rem auto 2rem;
    padding: 0 1rem;
  }
  @media print {
    .toolbar { display: none !important; }
    .sheet { width: 100%; margin: 0; padding: 0; }
    .af-table,
    .af-table th,
    .af-table td {
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    .af-table {
      border: 1.5pt solid #000 !important;
    }
    .af-table th,
    .af-table td {
      border-right: 1pt solid #000 !important;
      border-bottom: 1pt solid #000 !important;
    }
    .af-table th:last-child,
    .af-table td:last-child {
      border-right: none !important;
    }
    .af-table tr:last-child td {
      border-bottom: none !important;
    }
  }
`;

export function buildAcceptancePrintHtml(data: AcceptanceFormData, logoSrc: string): string {
  const company = data.company_name || 'Indra Traders';
  const rows = padEquipment(data.equipment ?? []);
  const eqRows = rows
    .map(
      (row) => `<tr>
        <td>${esc(dash(row.equipment_type)) || '&nbsp;'}</td>
        <td>${esc(dash(row.make_model)) || '&nbsp;'}</td>
        <td>${esc(dash(row.serial_imei)) || '&nbsp;'}</td>
        <td>${esc(dash(row.asset_tag)) || '&nbsp;'}</td>
        <td>${esc(dash(row.condition)) || '&nbsp;'}</td>
      </tr>`,
    )
    .join('');

  const terms = [
    [
      'Company Property',
      `I understand that the hardware and accessories listed above are the sole property of ${company} and are provided to me for business purposes.`,
    ],
    [
      'Acceptable Use',
      "I will use the equipment in accordance with the company's IT and Acceptable Use Policies. I will not install unauthorized software or use the devices for illegal or inappropriate activities.",
    ],
    [
      'Care and Security',
      'I will take all reasonable and necessary precautions to protect the equipment from damage, theft, or loss. I will not leave the equipment unattended in public or unsecured locations.',
    ],
    [
      'Reporting',
      'In the event of damage, malfunction, loss, or theft, I will immediately report the incident to the IT Division.',
    ],
    [
      'Data Security',
      'I will ensure that company data stored on the device is protected, utilizing required passwords, screen locks, and encryption as mandated by the IT Division.',
    ],
    [
      'Return of Equipment',
      `I agree to return all issued equipment and accessories immediately upon request by the IT Division, or upon termination of my employment with ${company}. I understand that failure to return the equipment, or returning it in a damaged state beyond normal wear and tear, may result in deductions from my final settlement or further necessary action.`,
    ],
  ]
    .map(([title, body]) => `<li><strong>${esc(title)}:</strong> ${esc(body)}</li>`)
    .join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>IT Hardware Acceptance Form</title>
  <style>${PRINT_CSS}</style>
</head>
<body>
  <div class="toolbar">
    <button type="button" class="secondary" data-close>Close</button>
    <button type="button" data-print>Print / Select printer</button>
  </div>
  <div class="sheet">
    <article class="af-page">
      <header class="af-header">
        <img class="af-logo" src="${esc(logoSrc)}" alt="${esc(company)}" />
        <h1>IT Hardware Acceptance Form</h1>
        <p class="af-intro">
          This form is to acknowledge the receipt of company-owned IT hardware and equipment. By
          signing this document, the employee agrees to the terms and conditions regarding the
          use, care, and return of the assigned equipment.
        </p>
      </header>
      <section class="af-section">
        <h2>1. Employee Information</h2>
        <div class="af-fields">
          ${field('Employee Name', dash(data.employee.name))}
          ${field('Employee ID', dash(data.employee.staff_id))}
          ${field('Designation/Job Title', dash(data.employee.designation))}
          ${field('Department', dash(data.employee.department))}
          ${field('Contact Number', dash(data.employee.contact_number))}
          ${field('Company Email', dash(data.employee.company_email))}
        </div>
      </section>
      <section class="af-section">
        <h2>2. Equipment Details</h2>
        <p class="af-note">Please list all devices and accessories provided to the employee.</p>
        <table class="af-table">
          <thead>
            <tr>
              <th>Equipment Type</th>
              <th>Make &amp; Model</th>
              <th>Serial Number / IMEI</th>
              <th>Asset Tag / IT ID</th>
              <th>Condition</th>
            </tr>
          </thead>
          <tbody>${eqRows}</tbody>
        </table>
      </section>
    </article>
    <article class="af-page">
      <section class="af-section">
        <h2>3. Terms and Conditions of Use</h2>
        <p class="af-terms-lead">
          By accepting the equipment listed above, I acknowledge and agree to the following terms:
        </p>
        <ol class="af-terms">${terms}</ol>
      </section>
      <section class="af-section af-signatures">
        <h2>4. Signatures</h2>
        <div class="af-sign-block">
          <h3>Employee Declaration:</h3>
          <p>
            I hereby acknowledge receipt of the equipment listed above in good working condition.
            I have read, understood, and agree to abide by the terms and conditions outlined in
            this form.
          </p>
          <div class="af-sign-grid">
            ${field('Employee Signature', '')}
            ${field('Date', formatDate(data.signatures.employee_date))}
          </div>
        </div>
        <div class="af-sign-block">
          <h3>IT Division Authorization:</h3>
          <p>Issued and verified by the IT Division.</p>
          <div class="af-sign-grid af-sign-grid-stack">
            ${field('IT Representative Name', dash(data.signatures.it_representative_name))}
            ${field('IT Representative Signature', '')}
            ${field('Date', formatDate(data.signatures.it_date))}
          </div>
        </div>
      </section>
    </article>
  </div>
  <script>
    function closePrintView() {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'itam-acceptance-print-close' }, '*');
      } else {
        window.close();
      }
    }
    document.querySelector('[data-print]')?.addEventListener('click', function () {
      window.print();
    });
    document.querySelector('[data-close]')?.addEventListener('click', closePrintView);
  </script>
</body>
</html>`;
}

export type PrintAcceptanceOptions = {
  /** Fires after the system print dialog closes (print completed or cancelled). */
  onAfterPrint?: () => void;
};

/**
 * Print via a hidden full-size iframe (Firefox needs non-zero size).
 * Frame stays off-screen so it never blocks the app UI / clipboard.
 */
export function printAcceptanceForm(
  data: AcceptanceFormData,
  options?: PrintAcceptanceOptions,
): { ok: boolean; reason?: string } {
  const logoSrc = `${window.location.origin}/indra-acceptance-logo.jpg`;
  const html = buildAcceptancePrintHtml(data, logoSrc);

  const frameId = 'itam-acceptance-print-frame';
  let frame = document.getElementById(frameId) as HTMLIFrameElement | null;
  if (!frame) {
    frame = document.createElement('iframe');
    frame.id = frameId;
    frame.setAttribute('title', 'Acceptance form print');
    document.body.appendChild(frame);

    window.addEventListener('message', (ev) => {
      if (ev.data?.type === 'itam-acceptance-print-close') {
        dismissAcceptancePrintFrame();
      }
    });
  }

  // Park off-screen (real size for Firefox) — never cover the app
  dismissAcceptancePrintFrame();

  const doc = frame.contentDocument;
  const win = frame.contentWindow;
  if (!doc || !win) {
    return openFallbackWindow(html, options);
  }

  doc.open();
  doc.write(html);
  doc.close();

  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    win.removeEventListener('afterprint', onAfterPrint);
    dismissAcceptancePrintFrame();
    options?.onAfterPrint?.();
  };
  const onAfterPrint = () => finish();
  win.addEventListener('afterprint', onAfterPrint);
  // Safety cleanup if afterprint never fires; do not treat as a completed print
  window.setTimeout(() => {
    win.removeEventListener('afterprint', onAfterPrint);
    dismissAcceptancePrintFrame();
  }, 120_000);

  try {
    win.focus();
    win.print();
  } catch {
    dismissAcceptancePrintFrame();
    return openFallbackWindow(html, options);
  }

  return { ok: true };
}

export function dismissAcceptancePrintFrame(): void {
  const el = document.getElementById('itam-acceptance-print-frame') as HTMLIFrameElement | null;
  if (!el) return;
  el.style.cssText =
    'position:fixed;width:830px;height:1170px;left:-10000px;top:0;border:0;opacity:0;pointer-events:none;z-index:-1;';
}

function openFallbackWindow(
  html: string,
  options?: PrintAcceptanceOptions,
): { ok: boolean; reason?: string } {
  const w = window.open('', `itam-acceptance-print-${Date.now()}`, 'width=920,height=1200');
  if (!w) {
    return {
      ok: false,
      reason: 'Could not open print view. Allow pop-ups for this site and try again.',
    };
  }
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();

  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    w.removeEventListener('afterprint', onAfterPrint);
    options?.onAfterPrint?.();
  };
  const onAfterPrint = () => finish();
  w.addEventListener('afterprint', onAfterPrint);

  try {
    w.print();
  } catch {
    // User can still click Print in the opened window toolbar
  }
  return { ok: true };
}
