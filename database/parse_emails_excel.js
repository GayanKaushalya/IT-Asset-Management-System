const fs = require('fs');
const path = require('path');
const XLSX = require('D:/ITAMS/frontend/node_modules/xlsx');

const src = process.argv[2] || 'z:/Pavithra/Email Usernames & Passwords.xlsx';
const outPath = path.join(__dirname, 'imports', 'emails_from_excel.json');

const wb = XLSX.readFile(src);

function companyFromEmail(email) {
  const at = email.lastIndexOf('@');
  const domain = at >= 0 ? email.slice(at + 1).toLowerCase().trim() : '';
  if (domain.includes('motorspare') || domain.includes('indramotor')) return 'IMS';
  if (domain.includes('servicepark') || domain.includes('indraservice')) return 'ISP';
  if (domain.includes('foton')) return 'FOTON';
  if (domain.includes('indratraders')) return 'IT';
  return 'OTHER';
}

const all = [];

for (const sheet of wb.SheetNames) {
  const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { header: 1, defval: null });
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (!Array.isArray(r) || r.length === 0) continue;

    let email = null;
    let password = null;
    let name = '';

    if (sheet === 'ISP') {
      if (i === 0) continue; // header
      email = r[0];
      password = r[2] != null && String(r[2]).trim() !== '' ? r[2] : r[1];
    } else if (sheet === 'Sheet1') {
      // Names optional — leave blank per import request
      name = '';
      email = r[2];
      password = r[3];
    } else {
      email = r[0];
      password = r[1];
    }

    if (email == null) continue;
    email = String(email).trim().toLowerCase().replace(/\s+/g, '');
    if (!email.includes('@') || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;

    password =
      password == null || String(password).trim() === '' || String(password).trim() === 'null'
        ? ''
        : String(password).trim();

    all.push({
      sheet,
      email,
      password,
      name,
      company: companyFromEmail(email),
    });
  }
}

// Dedupe by email (case-insensitive): prefer non-empty password; later row wins on conflict
const map = new Map();
for (const row of all) {
  const key = row.email;
  const prev = map.get(key);
  if (!prev) {
    map.set(key, row);
    continue;
  }
  const next = { ...row };
  if (prev.password && !row.password) {
    next.password = prev.password;
  }
  if (!next.name && prev.name) next.name = prev.name;
  // Prefer company from domain if prior was OTHER
  if (prev.company !== 'OTHER' && next.company === 'OTHER') {
    next.company = prev.company;
  }
  if (prev.password && row.password && prev.password !== row.password) {
    next.password = row.password; // last non-empty wins
    next.password_conflict = true;
  }
  map.set(key, next);
}

const out = [...map.values()].sort((a, b) =>
  a.company === b.company ? a.email.localeCompare(b.email) : a.company.localeCompare(b.company),
);

const by = {};
let blank = 0;
for (const r of out) {
  by[r.company] = (by[r.company] || 0) + 1;
  if (!r.password) blank += 1;
}

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(out, null, 2));
console.log(JSON.stringify({ total: out.length, blankPasswords: blank, byCompany: by, outPath }, null, 2));
