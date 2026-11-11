"""Parse Desktop Book1.xlsx old phone list → JSON for import."""
import json
import re
from datetime import date, datetime
from pathlib import Path

import openpyxl

SRC = Path(r"c:\Users\Server\Desktop\Book1.xlsx")
OUT = Path(__file__).with_name("old_phones_book1.json")


def cell(r, i):
    if i >= len(r):
        return None
    v = r[i]
    if v is None:
        return None
    if isinstance(v, (datetime, date)):
        return v.strftime("%Y-%m-%d")
    s = str(v).strip()
    if not s or s.lower() == "none":
        return None
    # normalize dd/mm/yyyy
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{4})$", s)
    if m:
        d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
        return f"{y:04d}-{mo:02d}-{d:02d}"
    return s


def main():
    wb = openpyxl.load_workbook(SRC, data_only=True)
    ws = wb.active
    rows = list(ws.iter_rows(values_only=True))
    phones = []
    i = 3
    while i < len(rows):
        r = rows[i]
        no = cell(r, 0)
        if no is None:
            i += 1
            continue
        imei1 = cell(r, 11)
        imei2 = None
        if i + 1 < len(rows):
            n = rows[i + 1]
            label = cell(n, 10)
            if cell(n, 0) is None and label in ("2", "2.0") and cell(n, 11):
                imei2 = cell(n, 11)
        phones.append(
            {
                "sheet_no": no,
                "emp_no": cell(r, 1),
                "asset_no": cell(r, 2),
                "code": cell(r, 3),
                "brand": cell(r, 4),
                "serial": cell(r, 5),
                "location": cell(r, 6),
                "others": cell(r, 7),
                "handed_over_on": cell(r, 8),
                "model": cell(r, 9),
                "imei1": imei1,
                "imei2": imei2,
                "name": cell(r, 12),
                "remark_items": cell(r, 13),
                "phone_no": cell(r, 14),
                "return_date": cell(r, 15),
                "return_remark": cell(r, 16),
                "handover2_person": cell(r, 17),
                "handover2_on": cell(r, 18),
                "handover2_remark": cell(r, 19),
                "handover2_phone": cell(r, 20),
                "handover2_return": cell(r, 21),
                "handover3_person": cell(r, 22),
                "handover3_on": cell(r, 23),
                "handover3_remark": cell(r, 24),
                "handover3_phone": cell(r, 25),
                "handover3_return": cell(r, 26),
            }
        )
        i += 2 if imei2 else 1

    OUT.write_text(json.dumps(phones, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Wrote {len(phones)} phones → {OUT}")


if __name__ == "__main__":
    main()
