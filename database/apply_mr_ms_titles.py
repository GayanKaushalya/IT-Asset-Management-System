"""Assign Mr/Ms titles to employees and prefix asset person names."""
from __future__ import annotations

import csv
import os
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent
IMPORTS = ROOT / "imports"
PSQL = r"C:\Program Files\PostgreSQL\18\bin\psql.exe"
ENV = {**os.environ, "PGPASSWORD": "itams_local"}

FEMALE_RE = re.compile(
    r"\b("
    r"kumari|menike|devi|dulani|sajini|salmalee|nimesha|ashokamala|priyanka|piyadarshani|"
    r"shanika|thilini|kaveesha|sachini|madhumali|netalee|kaushalya|maduwanthi|"
    r"ayesha|madushani|madhushani|nishanthi|sewwandi|lakmali|poshini|manohari|"
    r"imesha|sandamini|pavithra|gayani|hansani|koshila|hiruni|nayana|wasana|"
    r"chandani|lakshika|dilini|nilmini|renuka|jayanthi|deepika|sanduni|chathurika|"
    r"nadeesha|nimesha|ishara|salmalee|shreen|dharma\s+kumari|"
    r"anjalee|anjali|nimasha|nipuni|rumeshika|tharushi|sithumi|sewwandi|"
    r"waruni|darshani|roshani|vinodani|sumudu|hasanthi|erandi|thushari|"
    r"chandima|samanmali|mangalika|pathmini|swarna|indrani|malini|nimali|"
    r"sumithra|geethani|rupika|sujatha|padma|seetha|kamani|damayanthi"
    r")\b",
    re.I,
)

TITLE_RE = re.compile(r"^\s*(mr\.?|mrs\.?|ms\.?|miss\.?)\s+", re.I)


def psql_file(sql: str, path: Path) -> None:
    path.write_text(sql, encoding="utf-8")
    subprocess.run(
        [PSQL, "-U", "postgres", "-h", "127.0.0.1", "-d", "itams", "-v", "ON_ERROR_STOP=1", "-f", str(path)],
        check=True,
        env=ENV,
    )


def infer_title(name: str) -> str:
    return "Ms" if FEMALE_RE.search(name or "") else "Mr"


def strip_title(name: str) -> str:
    return TITLE_RE.sub("", name or "").strip()


def with_title(name: str, title: str) -> str:
    base = strip_title(name)
    if not base:
        return name
    return f"{title}. {base}"


def main() -> None:
    # 1) Ensure title column
    psql_file(
        """
ALTER TABLE employees ADD COLUMN IF NOT EXISTS title VARCHAR(10);
""",
        IMPORTS / "_add_title_col.sql",
    )

    # 2) Export employees
    subprocess.run(
        [
            PSQL,
            "-U",
            "postgres",
            "-h",
            "127.0.0.1",
            "-d",
            "itams",
            "-c",
            rf"\copy (SELECT id, name, title FROM employees) TO '{IMPORTS.as_posix()}/_emp_titles.csv' CSV HEADER",
        ],
        check=True,
        env=ENV,
    )

    # Recover titles from previous short names in match file
    known: dict[str, str] = {}
    match_file = IMPORTS / "_name_match_updates.csv"
    if match_file.exists():
        with match_file.open(encoding="utf-8") as f:
            for row in csv.DictReader(f):
                old = row.get("old") or ""
                new = row.get("new") or ""
                m = TITLE_RE.match(old)
                if not m:
                    continue
                t = m.group(1).lower().rstrip(".")
                title = "Ms" if t in ("ms", "mrs", "miss") else "Mr"
                known[strip_title(new).lower()] = title

    rows = list(csv.DictReader((IMPORTS / "_emp_titles.csv").open(encoding="utf-8")))
    updates = []
    for r in rows:
        name = r["name"]
        key = strip_title(name).lower()
        title = known.get(key) or infer_title(name)
        updates.append((r["id"], title))

    lines = ["BEGIN;"]
    for eid, title in updates:
        lines.append(f"UPDATE employees SET title = '{title}', updated_at = NOW() WHERE id = {int(eid)};")
    lines.append("COMMIT;")
    psql_file("\n".join(lines), IMPORTS / "_set_emp_titles.sql")
    print(f"Set titles on {len(updates)} employees")
    ms = sum(1 for _, t in updates if t == "Ms")
    print(f"  Mr={len(updates)-ms} Ms={ms}")

    # 3) Prefix person fields on laptops / mobile_phones
    # Join to employees by exact name (without title) where possible; else heuristic
    sql = r"""
BEGIN;

-- Helper: strip existing title then apply employee title or heuristic via CASE
-- Laptops
UPDATE laptops l
SET allocated_person = CASE
        WHEN l.allocated_person IS NULL OR btrim(l.allocated_person) = '' THEN l.allocated_person
        ELSE COALESCE(e.title, 'Mr') || '. ' || regexp_replace(btrim(l.allocated_person), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i')
    END,
    updated_at = NOW()
FROM employees e
WHERE e.name = regexp_replace(btrim(COALESCE(l.allocated_person,'')), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i')
  AND l.allocated_person IS NOT NULL AND btrim(l.allocated_person) <> '';

UPDATE laptops l
SET original_assigned_person = CASE
        WHEN l.original_assigned_person IS NULL OR btrim(l.original_assigned_person) = '' THEN l.original_assigned_person
        ELSE COALESCE(e.title, 'Mr') || '. ' || regexp_replace(btrim(l.original_assigned_person), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i')
    END,
    updated_at = NOW()
FROM employees e
WHERE e.name = regexp_replace(btrim(COALESCE(l.original_assigned_person,'')), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i')
  AND l.original_assigned_person IS NOT NULL AND btrim(l.original_assigned_person) <> '';

UPDATE laptops l SET
  handover_person_1 = CASE WHEN handover_person_1 IS NULL OR btrim(handover_person_1)='' THEN handover_person_1
    ELSE COALESCE((SELECT title FROM employees e WHERE e.name = regexp_replace(btrim(l.handover_person_1), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') LIMIT 1), 'Mr')
      || '. ' || regexp_replace(btrim(handover_person_1), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') END,
  handover_person_2 = CASE WHEN handover_person_2 IS NULL OR btrim(handover_person_2)='' THEN handover_person_2
    ELSE COALESCE((SELECT title FROM employees e WHERE e.name = regexp_replace(btrim(l.handover_person_2), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') LIMIT 1), 'Mr')
      || '. ' || regexp_replace(btrim(handover_person_2), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') END,
  handover_person_3 = CASE WHEN handover_person_3 IS NULL OR btrim(handover_person_3)='' THEN handover_person_3
    ELSE COALESCE((SELECT title FROM employees e WHERE e.name = regexp_replace(btrim(l.handover_person_3), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') LIMIT 1), 'Mr')
      || '. ' || regexp_replace(btrim(handover_person_3), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') END,
  handover_person_4 = CASE WHEN handover_person_4 IS NULL OR btrim(handover_person_4)='' THEN handover_person_4
    ELSE COALESCE((SELECT title FROM employees e WHERE e.name = regexp_replace(btrim(l.handover_person_4), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') LIMIT 1), 'Mr')
      || '. ' || regexp_replace(btrim(handover_person_4), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') END,
  updated_at = NOW()
WHERE COALESCE(handover_person_1, handover_person_2, handover_person_3, handover_person_4) IS NOT NULL;

-- Mobile phones
UPDATE mobile_phones m
SET allocated_person = CASE
        WHEN m.allocated_person IS NULL OR btrim(m.allocated_person) = '' THEN m.allocated_person
        ELSE COALESCE(e.title, 'Mr') || '. ' || regexp_replace(btrim(m.allocated_person), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i')
    END,
    updated_at = NOW()
FROM employees e
WHERE e.name = regexp_replace(btrim(COALESCE(m.allocated_person,'')), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i')
  AND m.allocated_person IS NOT NULL AND btrim(m.allocated_person) <> '';

UPDATE mobile_phones m
SET original_assigned_person = CASE
        WHEN m.original_assigned_person IS NULL OR btrim(m.original_assigned_person) = '' THEN m.original_assigned_person
        ELSE COALESCE(e.title, 'Mr') || '. ' || regexp_replace(btrim(m.original_assigned_person), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i')
    END,
    updated_at = NOW()
FROM employees e
WHERE e.name = regexp_replace(btrim(COALESCE(m.original_assigned_person,'')), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i')
  AND m.original_assigned_person IS NOT NULL AND btrim(m.original_assigned_person) <> '';

UPDATE mobile_phones m
SET first_handover_person = CASE
        WHEN m.first_handover_person IS NULL OR btrim(m.first_handover_person) = '' THEN m.first_handover_person
        ELSE COALESCE(e.title, 'Mr') || '. ' || regexp_replace(btrim(m.first_handover_person), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i')
    END,
    updated_at = NOW()
FROM employees e
WHERE e.name = regexp_replace(btrim(COALESCE(m.first_handover_person,'')), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i')
  AND m.first_handover_person IS NOT NULL AND btrim(m.first_handover_person) <> '';

UPDATE mobile_phones m SET
  handover_person_1 = CASE WHEN handover_person_1 IS NULL OR btrim(handover_person_1)='' THEN handover_person_1
    ELSE COALESCE((SELECT title FROM employees e WHERE e.name = regexp_replace(btrim(m.handover_person_1), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') LIMIT 1), 'Mr')
      || '. ' || regexp_replace(btrim(handover_person_1), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') END,
  handover_person_2 = CASE WHEN handover_person_2 IS NULL OR btrim(handover_person_2)='' THEN handover_person_2
    ELSE COALESCE((SELECT title FROM employees e WHERE e.name = regexp_replace(btrim(m.handover_person_2), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') LIMIT 1), 'Mr')
      || '. ' || regexp_replace(btrim(handover_person_2), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') END,
  handover_person_3 = CASE WHEN handover_person_3 IS NULL OR btrim(handover_person_3)='' THEN handover_person_3
    ELSE COALESCE((SELECT title FROM employees e WHERE e.name = regexp_replace(btrim(m.handover_person_3), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') LIMIT 1), 'Mr')
      || '. ' || regexp_replace(btrim(handover_person_3), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') END,
  handover_person_4 = CASE WHEN handover_person_4 IS NULL OR btrim(handover_person_4)='' THEN handover_person_4
    ELSE COALESCE((SELECT title FROM employees e WHERE e.name = regexp_replace(btrim(m.handover_person_4), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') LIMIT 1), 'Mr')
      || '. ' || regexp_replace(btrim(handover_person_4), '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+', '', 'i') END,
  updated_at = NOW()
WHERE COALESCE(handover_person_1, handover_person_2, handover_person_3, handover_person_4) IS NOT NULL;

-- Remaining asset names without employee match: default Mr. if no title yet
UPDATE laptops SET allocated_person = 'Mr. ' || btrim(allocated_person), updated_at = NOW()
WHERE allocated_person IS NOT NULL AND btrim(allocated_person) <> ''
  AND allocated_person !~* '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+';

UPDATE laptops SET original_assigned_person = 'Mr. ' || btrim(original_assigned_person), updated_at = NOW()
WHERE original_assigned_person IS NOT NULL AND btrim(original_assigned_person) <> ''
  AND original_assigned_person !~* '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+';

UPDATE mobile_phones SET allocated_person = 'Mr. ' || btrim(allocated_person), updated_at = NOW()
WHERE allocated_person IS NOT NULL AND btrim(allocated_person) <> ''
  AND allocated_person !~* '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+';

UPDATE mobile_phones SET original_assigned_person = 'Mr. ' || btrim(original_assigned_person), updated_at = NOW()
WHERE original_assigned_person IS NOT NULL AND btrim(original_assigned_person) <> ''
  AND original_assigned_person !~* '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+';

UPDATE mobile_phones SET first_handover_person = 'Mr. ' || btrim(first_handover_person), updated_at = NOW()
WHERE first_handover_person IS NOT NULL AND btrim(first_handover_person) <> ''
  AND first_handover_person !~* '^\s*(Mr\.?|Mrs\.?|Ms\.?|Miss\.?)\s+';

COMMIT;
"""
    psql_file(sql, IMPORTS / "_apply_mr_ms_assets.sql")
    print("Prefixed asset person names with Mr./Ms.")


if __name__ == "__main__":
    main()
