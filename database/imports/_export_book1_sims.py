"""Export Desktop Book1.xlsx Dialog SIM rows → imports/book1_sims.json (read-only on Excel)."""
from __future__ import annotations

import json
from datetime import datetime, date
from pathlib import Path

import openpyxl

EXCEL = Path(r"c:\Users\Server\Desktop\Book1.xlsx")
OUT = Path(__file__).resolve().parent / "book1_sims.json"


def cell_str(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date().isoformat()
    if isinstance(v, date):
        return v.isoformat()
    s = str(v).strip()
    return s if s else None


def phone_str(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, float):
        v = int(v)
    s = str(v).strip()
    if s.endswith(".0"):
        s = s[:-2]
    digits = "".join(ch for ch in s if ch.isdigit())
    return digits if digits else None


def main() -> None:
    wb = openpyxl.load_workbook(EXCEL, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    # Row 0 blank, row 1 headers, data from row 2
    out = []
    for r in rows[2:]:
        if not r or len(r) < 13:
            continue
        phone = phone_str(r[12])
        name = cell_str(r[10])
        if not phone and not name:
            continue
        out.append(
            {
                "row_no": r[0],
                "location": cell_str(r[5]),
                "vendor": cell_str(r[6]) or "Dialog",
                "package": cell_str(r[7]),
                "rental": cell_str(r[8]),
                "issue_date": cell_str(r[9]),
                "name": name,
                "remark": cell_str(r[11]),
                "phone_no": phone,
                "return_date": cell_str(r[13]) if len(r) > 13 else None,
                "handover_1": cell_str(r[14]) if len(r) > 14 else None,
                "handover_1_date": cell_str(r[15]) if len(r) > 15 else None,
                "handover_2": cell_str(r[16]) if len(r) > 16 else None,
                "handover_2_date": cell_str(r[17]) if len(r) > 17 else None,
            }
        )
    OUT.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(out)} rows -> {OUT}")


if __name__ == "__main__":
    main()
