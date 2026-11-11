"""Match short asset holder names to Organization employees; apply updates."""
from __future__ import annotations

import csv
import re
import subprocess
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent
IMPORTS = ROOT / "imports"
PSQL = r"C:\Program Files\PostgreSQL\18\bin\psql.exe"
ENV = {"PGPASSWORD": "itams_local"}

STOP = {
    "mr",
    "mrs",
    "ms",
    "miss",
    "dr",
    "byd",
    "acc",
    "sales",
    "imp",
    "itl",
    "ims",
    "isp",
    "foton",
    "colombo",
    "kandy",
    "matara",
    "mathara",
    "kelaniya",
    "negombo",
    "anuradhapura",
    "gampola",
    "embilipitiya",
    "hydepark",
    "hydpark",
    "workshop",
    "office",
    "head",
    "branch",
    "dealer",
    "accountant",
    "accounts",
    "admin",
    "operation",
    "operations",
    "support",
    "services",
    "stores",
    "and",
    "the",
    "of",
    "w",
    "a",
}


def load(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as f:
        return list(csv.DictReader(f))


def normalize_tokens(s: str) -> list[str]:
    s = (s or "").lower()
    s = s.replace(".", " ").replace("/", " ").replace("-", " ").replace("_", " ")
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return [t for t in s.split() if t and t not in STOP and not t.isdigit() and len(t) > 1]


def match_name(raw: str, company_id: str | None, by_token, by_company_token):
    raw = (raw or "").strip()
    if not raw:
        return None, 0, ""
    # Skip team / multi-person labels
    low = raw.lower()
    if "/" in raw or " team" in low or low.startswith("team ") or "&" in raw:
        return None, 0, "multi"
    toks = normalize_tokens(raw)
    if not toks:
        return None, 0, "no-tokens"

    candidates: dict[str, dict] = {}
    for t in toks:
        pool = by_company_token.get((str(company_id), t), []) if company_id else []
        if not pool:
            pool = by_token.get(t, [])
        for e in pool:
            candidates[e["id"]] = e

    if not candidates:
        return None, 0, "none"

    scored = []
    tokset = set(toks)
    for e in candidates.values():
        inter = e["_set"].intersection(tokset)
        if not inter:
            continue
        score = sum(len(t) for t in inter) + 2 * len(inter)
        if toks[-1] in e["_set"]:
            score += 5
        loc = (e.get("work_location") or "").lower()
        raw_l = raw.lower()
        for hint in [
            "colombo",
            "kandy",
            "matara",
            "mathara",
            "kelaniya",
            "negombo",
            "anuradhapura",
            "ims",
            "isp",
            "itl",
            "201",
            "140",
            "43",
            "gampola",
            "embilipitiya",
        ]:
            if hint in raw_l and hint in loc:
                score += 3
        scored.append((score, len(inter), e))

    if not scored:
        return None, 0, "no-overlap"

    scored.sort(key=lambda x: (-x[0], -x[1], x[2]["name"]))
    best = scored[0]
    second = scored[1] if len(scored) > 1 else None
    inter = best[2]["_set"].intersection(set(toks))
    strong = any(len(t) >= 4 for t in inter) or len(inter) >= 2
    if not strong:
        return None, best[0], "weak"
    if second and second[0] >= best[0] - 1 and second[2]["id"] != best[2]["id"]:
        best_only = best[2]["_set"].intersection(set(toks)) - second[2]["_set"]
        if not any(len(t) >= 5 for t in best_only):
            return None, best[0], f"ambiguous:{best[2]['name']}|{second[2]['name']}"
    return best[2], best[0], "ok"


def analyze(rows, fields, label, by_token, by_company_token):
    matched = weak = amb = unmatched = 0
    updates = []
    examples = []
    for r in rows:
        for f in fields:
            raw = (r.get(f) or "").strip()
            if not raw:
                continue
            emp, score, reason = match_name(raw, r.get("company_id"), by_token, by_company_token)
            if emp and reason == "ok":
                matched += 1
                if emp["name"] != raw:
                    updates.append(
                        {
                            "table": label,
                            "id": r["id"],
                            "field": f,
                            "old": raw,
                            "new": emp["name"],
                            "staff_id": emp["staff_id"],
                            "score": score,
                        }
                    )
                    if len(examples) < 10:
                        examples.append((raw, "=>", emp["name"], score))
            elif reason.startswith("ambiguous"):
                amb += 1
                if len(examples) < 20:
                    examples.append((raw, "AMB", reason, score))
            elif reason == "weak":
                weak += 1
            else:
                unmatched += 1
                if unmatched <= 8:
                    examples.append((raw, "??", reason, score))
    print(f"=== {label} matched={matched} weak={weak} amb={amb} unmatched={unmatched} updates={len(updates)}")
    for e in examples[:12]:
        print(" ", e)
    return updates


def main(apply: bool = False):
    emps = load(IMPORTS / "_employees_names.csv")
    laptops = load(IMPORTS / "_laptops_names.csv")
    phones = load(IMPORTS / "_phones_names.csv")

    by_token: dict[str, list] = defaultdict(list)
    by_company_token: dict[tuple, list] = defaultdict(list)
    for e in emps:
        toks = normalize_tokens(e["name"])
        e["_toks"] = toks
        e["_set"] = set(toks)
        for t in toks:
            by_token[t].append(e)
            by_company_token[(e["company_id"], t)].append(e)

    fields_l = [
        "allocated_person",
        "original_assigned_person",
        "handover_person_1",
        "handover_person_2",
        "handover_person_3",
        "handover_person_4",
    ]
    fields_p = [
        "allocated_person",
        "original_assigned_person",
        "first_handover_person",
        "handover_person_1",
        "handover_person_2",
        "handover_person_3",
        "handover_person_4",
    ]

    updates = analyze(laptops, fields_l, "laptops", by_token, by_company_token)
    updates += analyze(phones, fields_p, "mobile_phones", by_token, by_company_token)

    out = IMPORTS / "_name_match_updates.csv"
    with out.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["table", "id", "field", "old", "new", "staff_id", "score"])
        w.writeheader()
        w.writerows(updates)
    print("TOTAL updates", len(updates), "->", out)

    if not apply:
        print("Dry-run only. Re-run with --apply to update DB.")
        return

    # Apply via psql
    sql_path = IMPORTS / "_name_match_apply.sql"
    lines = ["BEGIN;"]
    for u in updates:
        table = u["table"]
        field = u["field"]
        new = u["new"].replace("'", "''")
        old = u["old"].replace("'", "''")
        lines.append(
            f"UPDATE {table} SET {field} = '{new}', updated_at = NOW() "
            f"WHERE id = {int(u['id'])} AND {field} = '{old}';"
        )
    lines.append("COMMIT;")
    sql_path.write_text("\n".join(lines), encoding="utf-8")
    print("Applying", sql_path)
    subprocess.run(
        [PSQL, "-U", "postgres", "-h", "127.0.0.1", "-d", "itams", "-v", "ON_ERROR_STOP=1", "-f", str(sql_path)],
        check=True,
        env={**dict(**__import__("os").environ), **ENV},
    )
    print("Done.")


if __name__ == "__main__":
    import sys

    main(apply="--apply" in sys.argv)
