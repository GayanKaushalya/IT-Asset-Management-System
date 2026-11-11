"""Convert Desktop\\For IT NEW.xlsx → employees_from_for_it_new.json"""

from __future__ import annotations

import json
import re
from collections import Counter
from datetime import date, datetime
from pathlib import Path

SRC = Path(r"c:\Users\Server\Desktop\For IT NEW.xlsx")
OUT = Path(__file__).resolve().parent / "employees_from_for_it_new.json"


def strip_title(name: str) -> str:
    return re.sub(r"^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+", "", name.strip(), flags=re.I).strip()


def map_company(sbu: str | None, location: str | None, branch: str | None) -> str:
    s = (sbu or "").strip().upper()
    loc = f"{location or ''} {branch or ''}".upper()
    if s in ("ITL", "IT"):
        return "IT"
    if s == "IMS":
        return "IMS"
    if s == "ISP":
        return "ISP"
    if "ISP" in loc:
        return "ISP"
    if "IMS" in loc:
        return "IMS"
    # Shared Services / IPD / blank → ITL
    return "IT"


def map_status(st: str) -> str:
    s = (st or "").strip().lower().replace(" ", "").replace("-", "")
    if s in ("exemployee", "former"):
        return "Former"
    if s == "probation":
        return "Probation"
    if s == "current":
        return "Current"
    return (st or "Current").strip() or "Current"


def map_title(gender: str) -> str:
    g = (gender or "").strip().lower()
    if g.startswith("f"):
        return "Ms"
    return "Mr"


def main() -> None:
    import openpyxl

    wb = openpyxl.load_workbook(SRC, read_only=True, data_only=True)
    ws = wb["_Table1"]
    rows = list(ws.iter_rows(values_only=True))
    hdr_i = next(i for i, r in enumerate(rows) if r and r[0] == "Staff Id")
    data = rows[hdr_i + 1 :]

    out_rows: list[dict] = []
    for r in data:
        if not r or (not r[0] and not r[1]):
            continue
        staff_id = str(r[0]).strip()
        name = strip_title(str(r[1] or "").strip())
        if not staff_id or not name:
            continue
        gender = str(r[2] or "")
        epf = r[3]
        epf_s = str(epf).strip() if epf is not None and str(epf).strip() != "" else None
        doj = r[4]
        if isinstance(doj, datetime):
            doj_s = doj.date().isoformat()
        elif isinstance(doj, date):
            doj_s = doj.isoformat()
        else:
            doj_s = str(doj).strip()[:10] if doj else None
        category = str(r[5] or "").strip() or None
        status = map_status(str(r[6] or ""))
        designation = str(r[7] or "").strip() or None
        location = str(r[8] or "").strip() or None
        sbu = str(r[9] or "").strip() or None
        branch = str(r[10] or "").strip() or None
        dept = str(r[11] or "").strip() or None
        work_location = branch or location
        company = map_company(sbu, location, branch)
        title = map_title(gender)
        out_rows.append(
            {
                "staff_id": staff_id,
                "name": name,
                "title": title,
                "gender": gender.strip(),
                "epf_number": epf_s,
                "date_of_joining": doj_s,
                "category": category,
                "employment_status": status,
                "directory_tag": status,
                "designation": designation,
                "work_location": work_location,
                "department_name": dept,
                "company_code": company,
                "sbu": sbu,
                "source": "For IT NEW.xlsx",
            }
        )

    OUT.write_text(json.dumps(out_rows, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Wrote {len(out_rows)} -> {OUT}")
    print("company", Counter(r["company_code"] for r in out_rows))
    print("status", Counter(r["employment_status"] for r in out_rows))
    print("title", Counter(r["title"] for r in out_rows))


if __name__ == "__main__":
    main()
