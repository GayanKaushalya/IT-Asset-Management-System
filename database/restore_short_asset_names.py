"""Restore laptop/phone person fields to short names from pre-match CSV snapshot."""
from __future__ import annotations

import csv
import os
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
IMPORTS = ROOT / "imports"
PSQL = r"C:\Program Files\PostgreSQL\18\bin\psql.exe"
ENV = {**os.environ, "PGPASSWORD": "itams_local"}


def esc(v: str | None) -> str:
    if v is None or v == "":
        return "NULL"
    return "'" + v.replace("'", "''") + "'"


def restore(table: str, csv_path: Path, fields: list[str]) -> int:
    rows = list(csv.DictReader(csv_path.open(encoding="utf-8")))
    lines = ["BEGIN;"]
    n = 0
    for r in rows:
        sets = []
        for f in fields:
            sets.append(f"{f} = {esc(r.get(f))}")
        lines.append(
            f"UPDATE {table} SET {', '.join(sets)}, updated_at = NOW() WHERE id = {int(r['id'])};"
        )
        n += 1
    lines.append("COMMIT;")
    sql_path = IMPORTS / f"_restore_short_{table}.sql"
    sql_path.write_text("\n".join(lines), encoding="utf-8")
    subprocess.run(
        [PSQL, "-U", "postgres", "-h", "127.0.0.1", "-d", "itams", "-v", "ON_ERROR_STOP=1", "-f", str(sql_path)],
        check=True,
        env=ENV,
    )
    return n


def main() -> None:
    n1 = restore(
        "laptops",
        IMPORTS / "_laptops_names.csv",
        [
            "allocated_person",
            "original_assigned_person",
            "handover_person_1",
            "handover_person_2",
            "handover_person_3",
            "handover_person_4",
        ],
    )
    n2 = restore(
        "mobile_phones",
        IMPORTS / "_phones_names.csv",
        [
            "allocated_person",
            "original_assigned_person",
            "first_handover_person",
            "handover_person_1",
            "handover_person_2",
            "handover_person_3",
            "handover_person_4",
        ],
    )
    print(f"Restored short names: laptops={n1}, mobile_phones={n2}")


if __name__ == "__main__":
    main()
