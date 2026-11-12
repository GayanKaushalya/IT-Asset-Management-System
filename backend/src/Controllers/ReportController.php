<?php

declare(strict_types=1);

namespace Indra\Itam\Controllers;

use Indra\Itam\Http\Request;
use Indra\Itam\Http\Response;
use PDO;

/**
 * Asset reports — employee-centric view over live HR + asset tables.
 * Does not invent data; matches assets to employees by person-name fields already in the DB.
 */
final class ReportController
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /**
     * GET /api/reports/employees?q=&company=IT|IMS|ISP&limit=
     * Search employees (and people named on assets) from the live database.
     */
    public function employees(Request $request, array $user): void
    {
        $q = trim((string) $request->input('q', ''));
        $company = strtoupper(trim((string) $request->input('company', '')));
        if ($company === 'ITL') {
            $company = 'IT';
        }
        $limit = min(500, max(1, (int) $request->input('limit', 200)));

        $sql = "SELECT e.id, e.staff_id, e.name, e.title, e.epf_number, e.employment_status,
                       e.designation, e.work_location, e.department_name, e.company_id,
                       c.code AS company_code, c.short_name AS company_short, c.name AS company_name,
                       CASE
                         WHEN e.title IS NOT NULL AND e.title <> '' THEN e.title || '. ' || e.name
                         ELSE e.name
                       END AS display_name
                FROM employees e
                JOIN companies c ON c.id = e.company_id
                WHERE e.is_active = TRUE";
        $params = [];

        if ($company !== '' && $company !== 'ALL') {
            $sql .= ' AND c.code = :company_code';
            $params['company_code'] = $company;
        }

        if ($q !== '') {
            // Tokenize so "danushka bandara" requires each word to match somewhere on the employee.
            $tokens = preg_split('/\s+/', $q) ?: [];
            $tokens = array_values(array_filter(array_map('trim', $tokens), static fn ($t) => $t !== ''));
            if ($tokens === []) {
                $tokens = [$q];
            }

            $tokenClauses = [];
            foreach ($tokens as $i => $token) {
                $like = '%' . $token . '%';
                // Unique bind per occurrence — native pgsql PDO cannot reuse one named param.
                $fields = [
                    'e.name',
                    'e.staff_id',
                    'e.epf_number',
                    'e.designation',
                    'e.work_location',
                    'e.department_name',
                    'c.short_name',
                    'c.code',
                    "(COALESCE(e.title, '') || '. ' || e.name)",
                ];
                $ors = [];
                foreach ($fields as $j => $field) {
                    $key = 'qt' . $i . '_' . $j;
                    $ors[] = "{$field} ILIKE :{$key}";
                    $params[$key] = $like;
                }
                $tokenClauses[] = '(' . implode(' OR ', $ors) . ')';
            }
            $empMatch = '(' . implode(' AND ', $tokenClauses) . ')';

            // Also include employees linked to assets matching the full query (tag or holder text).
            // Unique bind names — PDO pgsql does not reliably reuse the same named parameter.
            $like = '%' . $q . '%';
            $params['qa1'] = $like;
            $params['qa2'] = $like;
            $params['qa3'] = $like;
            $params['qa4'] = $like;
            $params['qa5'] = $like;
            $params['qa6'] = $like;
            $assetMatch = "(
                EXISTS (
                    SELECT 1 FROM laptops l
                    WHERE (
                        l.asset_tag ILIKE :qa1
                        OR l.allocated_person ILIKE :qa2
                        OR l.original_assigned_person ILIKE :qa3
                    )
                    AND (
                        lower(regexp_replace(btrim(COALESCE(l.allocated_person, '')), '^(mr|mrs|ms|miss)\\.?\\s+', '', 'i'))
                          = lower(btrim(e.name))
                        OR l.allocated_person ILIKE ('%' || e.name || '%')
                        OR l.original_assigned_person ILIKE ('%' || e.name || '%')
                    )
                )
                OR EXISTS (
                    SELECT 1 FROM mobile_phones m
                    WHERE (
                        m.asset_tag ILIKE :qa4
                        OR m.allocated_person ILIKE :qa5
                        OR m.original_assigned_person ILIKE :qa6
                    )
                    AND (
                        lower(regexp_replace(btrim(COALESCE(m.allocated_person, '')), '^(mr|mrs|ms|miss)\\.?\\s+', '', 'i'))
                          = lower(btrim(e.name))
                        OR m.allocated_person ILIKE ('%' || e.name || '%')
                        OR m.original_assigned_person ILIKE ('%' || e.name || '%')
                    )
                )
            )";

            $sql .= ' AND (' . $empMatch . ' OR ' . $assetMatch . ')';
        }

        $sql .= ' ORDER BY CASE WHEN e.staff_id ~ \'^[0-9]+$\' THEN e.staff_id::bigint ELSE NULL END ASC NULLS LAST,
                         e.name ASC
                  LIMIT ' . $limit;

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            $rows = $stmt->fetchAll();
        } catch (\Throwable $e) {
            Response::error('Could not load employees for reports', 500);
            return;
        }

        $holderIndex = $this->buildCurrentHolderIndex();
        foreach ($rows as &$row) {
            $counts = $this->countsFromIndex($row, $holderIndex);
            $row['laptop_count'] = $counts['laptop'];
            $row['phone_count'] = $counts['mobile_phone'];
            $row['asset_count'] = $counts['total'];
        }
        unset($row);

        Response::json([
            'data' => $rows,
            'meta' => ['total' => count($rows), 'source' => 'database'],
        ]);
    }

    /**
     * GET /api/reports/employees/{id}
     * Full employee profile + all matching assets from live tables.
     */
    public function employeeShow(Request $request, array $user, string $id): void
    {
        $empId = (int) $id;
        if ($empId < 1) {
            Response::error('Employee not found', 404);
            return;
        }

        $stmt = $this->pdo->prepare(
            "SELECT e.id, e.staff_id, e.name, e.title, e.epf_number, e.employment_status,
                    e.designation, e.work_location, e.department_name, e.company_id,
                    c.code AS company_code, c.short_name AS company_short, c.name AS company_name,
                    CASE
                      WHEN e.title IS NOT NULL AND e.title <> '' THEN e.title || '. ' || e.name
                      ELSE e.name
                    END AS display_name
             FROM employees e
             JOIN companies c ON c.id = e.company_id
             WHERE e.id = :id
             LIMIT 1"
        );
        $stmt->execute(['id' => $empId]);
        $employee = $stmt->fetch();
        if (! $employee) {
            Response::error('Employee not found', 404);
            return;
        }

        $assets = $this->assetsForEmployee($employee);
        $summary = [
            'laptop' => 0,
            'mobile_phone' => 0,
            'pc' => 0,
            'printer' => 0,
            'other' => 0,
            'current' => 0,
            'related' => 0,
            'total' => count($assets),
        ];
        foreach ($assets as $a) {
            $cat = (string) ($a['category'] ?? '');
            if (array_key_exists($cat, $summary) && ! in_array($cat, ['current', 'related', 'total'], true)) {
                $summary[$cat]++;
            }
            if (($a['role'] ?? '') === 'current') {
                $summary['current']++;
            } else {
                $summary['related']++;
            }
        }

        Response::json([
            'data' => [
                'employee' => $employee,
                'assets' => $assets,
                'summary' => $summary,
            ],
            'meta' => ['source' => 'database'],
        ]);
    }

    /**
     * Build normalized allocated_person → [laptop=>n, phone=>n] from live asset tables once.
     *
     * @return array<string, array{laptop:int,mobile_phone:int}>
     */
    private function buildCurrentHolderIndex(): array
    {
        $index = [];
        foreach (
            [
                'laptops' => 'laptop',
                'mobile_phones' => 'mobile_phone',
            ] as $table => $cat
        ) {
            try {
                $rows = $this->pdo->query(
                    "SELECT allocated_person FROM {$table}
                     WHERE allocated_person IS NOT NULL AND btrim(allocated_person) <> ''"
                )->fetchAll();
            } catch (\Throwable) {
                continue;
            }
            foreach ($rows as $r) {
                $raw = trim((string) $r['allocated_person']);
                $norm = strtolower(trim(preg_replace('/^(mr|mrs|ms|miss)\.?\s+/i', '', $raw) ?? $raw));
                if ($norm === '') {
                    continue;
                }
                if (! isset($index[$norm])) {
                    $index[$norm] = ['laptop' => 0, 'mobile_phone' => 0];
                }
                $index[$norm][$cat]++;
            }
        }

        return $index;
    }

    /**
     * @param array<string, mixed> $employee
     * @param array<string, array{laptop:int,mobile_phone:int}> $index
     * @return array{laptop:int,mobile_phone:int,total:int}
     */
    private function countsFromIndex(array $employee, array $index): array
    {
        $name = strtolower(trim((string) ($employee['name'] ?? '')));
        $name = strtolower(trim(preg_replace('/^(mr|mrs|ms|miss)\.?\s+/i', '', $name) ?? $name));
        if ($name === '' || ! isset($index[$name])) {
            return ['laptop' => 0, 'mobile_phone' => 0, 'total' => 0];
        }

        $laptop = $index[$name]['laptop'];
        $phone = $index[$name]['mobile_phone'];

        return [
            'laptop' => $laptop,
            'mobile_phone' => $phone,
            'total' => $laptop + $phone,
        ];
    }

    /**
     * @param array<string, mixed> $employee
     * @return list<array<string, mixed>>
     */
    private function assetsForEmployee(array $employee): array
    {
        $patterns = $this->namePatterns($employee);
        $out = [];

        $laptopFields = [
            'allocated_person' => 'current',
            'original_assigned_person' => 'original',
            'handover_person_1' => 'handover',
            'handover_person_2' => 'handover',
            'handover_person_3' => 'handover',
            'handover_person_4' => 'handover',
        ];
        foreach ($this->fetchTableAssets('laptops', 'laptop', $laptopFields, $patterns) as $row) {
            $out[] = $row;
        }

        $phoneFields = [
            'allocated_person' => 'current',
            'original_assigned_person' => 'original',
            'first_handover_person' => 'handover',
            'handover_person_1' => 'handover',
            'handover_person_2' => 'handover',
            'handover_person_3' => 'handover',
            'handover_person_4' => 'handover',
        ];
        foreach ($this->fetchTableAssets('mobile_phones', 'mobile_phone', $phoneFields, $patterns) as $row) {
            $out[] = $row;
        }

        // Branch PCs / printers: pc_name sometimes holds a person display name
        foreach ($this->fetchTableAssets('pcs', 'pc', ['pc_name' => 'current'], $patterns) as $row) {
            $out[] = $row;
        }
        foreach ($this->fetchTableAssets('printers', 'printer', ['pc_name' => 'related'], $patterns) as $row) {
            $out[] = $row;
        }

        // Other assets: user_name is the holder
        $otherFields = [
            'user_name' => 'current',
            'pc_name' => 'related',
        ];
        foreach ($this->fetchTableAssets('other_assets', 'other', $otherFields, $patterns) as $row) {
            $out[] = $row;
        }

        // Open/closed handover history rows (any category)
        foreach ($this->fetchHandoverAssets($patterns) as $row) {
            $out[] = $row;
        }

        // Prefer current role when same asset matched multiple fields
        $byKey = [];
        foreach ($out as $row) {
            $key = $row['category'] . ':' . $row['id'];
            if (! isset($byKey[$key])) {
                $byKey[$key] = $row;
                continue;
            }
            $rank = ['current' => 3, 'original' => 2, 'handover' => 1, 'related' => 0];
            $old = $rank[$byKey[$key]['role']] ?? 0;
            $new = $rank[$row['role']] ?? 0;
            if ($new > $old) {
                $byKey[$key] = $row;
            }
        }

        $merged = array_values($byKey);
        usort($merged, static function (array $a, array $b): int {
            $roleRank = ['current' => 0, 'original' => 1, 'handover' => 2, 'related' => 3];
            $ra = $roleRank[$a['role']] ?? 9;
            $rb = $roleRank[$b['role']] ?? 9;
            if ($ra !== $rb) {
                return $ra <=> $rb;
            }
            return strcmp((string) $a['asset_tag'], (string) $b['asset_tag']);
        });

        return $merged;
    }

    /**
     * Match person names on asset_handovers across all categories.
     *
     * @param list<string> $patterns
     * @return list<array<string, mixed>>
     */
    private function fetchHandoverAssets(array $patterns): array
    {
        if ($patterns === []) {
            return [];
        }

        $ors = [];
        $params = [];
        $i = 0;
        foreach ($patterns as $p) {
            $key = 'hp' . $i++;
            $ors[] = "(
                lower(regexp_replace(btrim(COALESCE(h.assigned_person_name, '')), '^(mr|mrs|ms|miss)\\.?\\s+', '', 'i'))
                  = lower(:{$key})
                OR lower(btrim(COALESCE(h.assigned_person_name, ''))) = lower(:{$key})
                OR h.assigned_person_name ILIKE :{$key}_like
            )";
            $params[$key] = $p;
            $params[$key . '_like'] = '%' . $p . '%';
        }

        $sql = "SELECT h.asset_id AS id, h.asset_type AS category, h.is_open,
                       h.assigned_person_name AS matched_value,
                       'assigned_person_name' AS matched_field,
                       CASE WHEN h.is_open THEN 'current' ELSE 'handover' END AS role,
                       a.asset_tag, a.brand, a.model, a.status, a.company_id,
                       c.short_name AS company_short, c.code AS company_code,
                       loc.name AS location_name
                FROM asset_handovers h
                JOIN v_assets a ON a.id = h.asset_id AND a.category = h.asset_type
                JOIN companies c ON c.id = a.company_id
                LEFT JOIN locations loc ON loc.id = a.location_id
                WHERE " . implode(' OR ', $ors) . "
                ORDER BY h.id DESC
                LIMIT 200";
        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        } catch (\Throwable) {
            return [];
        }

        $out = [];
        foreach ($rows as $row) {
            $out[] = [
                'id' => (int) $row['id'],
                'category' => $row['category'],
                'asset_tag' => $row['asset_tag'],
                'brand' => $row['brand'],
                'model' => $row['model'],
                'status' => $row['status'],
                'company_id' => $row['company_id'],
                'company_short' => $row['company_short'],
                'company_code' => $row['company_code'],
                'location_id' => null,
                'location_name' => $row['location_name'],
                'role' => $row['role'],
                'matched_field' => $row['matched_field'],
                'matched_value' => $row['matched_value'],
            ];
        }
        return $out;
    }

    /**
     * @param array<string, mixed> $employee
     * @return list<string>
     */
    private function namePatterns(array $employee): array
    {
        $name = trim((string) ($employee['name'] ?? ''));
        $title = trim((string) ($employee['title'] ?? ''));
        $display = trim((string) ($employee['display_name'] ?? ''));
        if ($display === '' && $name !== '') {
            $display = $title !== '' ? $title . '. ' . $name : $name;
        }

        $patterns = [];
        foreach ([$name, $display] as $p) {
            $p = trim($p);
            if ($p !== '') {
                $patterns[] = $p;
            }
        }
        // Also bare name without dots spacing variants
        $compact = preg_replace('/\s+/', ' ', $name) ?? $name;
        if ($compact !== '' && ! in_array($compact, $patterns, true)) {
            $patterns[] = $compact;
        }

        return array_values(array_unique($patterns));
    }

    /**
     * @param array<string, string> $fieldRoles field => role
     * @param list<string> $patterns
     * @return list<array<string, mixed>>
     */
    private function fetchTableAssets(string $table, string $category, array $fieldRoles, array $patterns): array
    {
        if ($patterns === [] || $fieldRoles === []) {
            return [];
        }

        $hasLoc = (bool) $this->pdo->query(
            "SELECT 1 FROM information_schema.columns
             WHERE table_schema = 'public' AND table_name = " . $this->pdo->quote($table) . "
               AND column_name = 'location_id'"
        )->fetchColumn();

        $select = "a.id, a.asset_tag, a.brand, a.model, a.status, a.company_id,
                   c.short_name AS company_short, c.code AS company_code";
        if ($hasLoc) {
            $select .= ', a.location_id, loc.name AS location_name';
        } else {
            $select .= ', NULL::bigint AS location_id, NULL::text AS location_name';
        }

        foreach (array_keys($fieldRoles) as $f) {
            $select .= ", a.{$f}";
        }

        $join = " FROM {$table} a
                  JOIN companies c ON c.id = a.company_id";
        if ($hasLoc) {
            $join .= ' LEFT JOIN locations loc ON loc.id = a.location_id';
        }

        $ors = [];
        $params = [];
        $i = 0;
        foreach (array_keys($fieldRoles) as $field) {
            foreach ($patterns as $p) {
                $key = 'p' . $i++;
                $ors[] = "(
                    lower(regexp_replace(btrim(COALESCE(a.{$field}, '')), '^(mr|mrs|ms|miss)\\.?\\s+', '', 'i'))
                      = lower(:{$key})
                    OR lower(btrim(COALESCE(a.{$field}, ''))) = lower(:{$key})
                    OR a.{$field} ILIKE :{$key}_like
                )";
                $params[$key] = $p;
                $params[$key . '_like'] = '%' . $p . '%';
            }
        }

        $sql = "SELECT {$select}{$join} WHERE " . implode(' OR ', $ors);
        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            $rows = $stmt->fetchAll();
        } catch (\Throwable) {
            return [];
        }

        $out = [];
        foreach ($rows as $row) {
            $role = 'related';
            $matchedField = null;
            $matchedValue = null;
            foreach ($fieldRoles as $field => $fieldRole) {
                $val = trim((string) ($row[$field] ?? ''));
                if ($val === '') {
                    continue;
                }
                if ($this->personMatches($val, $patterns)) {
                    $rank = ['current' => 3, 'original' => 2, 'handover' => 1];
                    if (($rank[$fieldRole] ?? 0) >= ($rank[$role] ?? 0)) {
                        $role = $fieldRole;
                        $matchedField = $field;
                        $matchedValue = $val;
                    }
                }
            }
            $out[] = [
                'id' => (int) $row['id'],
                'category' => $category,
                'asset_tag' => $row['asset_tag'],
                'brand' => $row['brand'],
                'model' => $row['model'],
                'status' => $row['status'],
                'company_id' => $row['company_id'],
                'company_short' => $row['company_short'],
                'company_code' => $row['company_code'],
                'location_id' => $row['location_id'],
                'location_name' => $row['location_name'],
                'role' => $role,
                'matched_field' => $matchedField,
                'matched_value' => $matchedValue,
            ];
        }

        return $out;
    }

    /** @param list<string> $patterns */
    private function personMatches(string $value, array $patterns): bool
    {
        $norm = strtolower(trim(preg_replace('/^(mr|mrs|ms|miss)\.?\s+/i', '', $value) ?? $value));
        $raw = strtolower(trim($value));
        foreach ($patterns as $p) {
            $pNorm = strtolower(trim($p));
            if ($pNorm === '') {
                continue;
            }
            if ($norm === $pNorm || $raw === $pNorm) {
                return true;
            }
            if (str_contains($raw, $pNorm) || str_contains($norm, $pNorm)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Inventory rollup: by company, location, department, unassigned stock, warranties, lifecycle.
     * GET /api/reports/inventory?company=IT|IMS|ISP|ALL
     */
    public function inventory(Request $request, array $user): void
    {
        $company = strtoupper(trim((string) $request->input('company', 'ALL')));
        if ($company === 'ITL') {
            $company = 'IT';
        }
        $companyId = null;
        if (($user['role'] ?? '') !== 'super_admin') {
            $companyId = (int) $user['company_id'];
        } elseif ($company !== '' && $company !== 'ALL') {
            $stmt = $this->pdo->prepare('SELECT id FROM companies WHERE code = :c LIMIT 1');
            $stmt->execute(['c' => $company]);
            $companyId = $stmt->fetchColumn() ?: null;
            $companyId = $companyId !== false && $companyId !== null ? (int) $companyId : null;
        }

        $filter = $companyId !== null ? ' AND a.company_id = :cid' : '';
        $params = $companyId !== null ? ['cid' => $companyId] : [];

        $byCompany = $this->inventoryGroup(
            "SELECT c.code AS key, c.short_name AS label, a.category, a.status, COUNT(*) AS n
             FROM v_assets a JOIN companies c ON c.id = a.company_id
             WHERE c.code <> 'FOTON' {$filter}
             GROUP BY c.code, c.short_name, a.category, a.status
             ORDER BY c.code, a.category",
            $params
        );

        $byLocation = $this->inventoryGroup(
            "SELECT COALESCE(loc.name, 'Unassigned location') AS key,
                    COALESCE(loc.name, 'Unassigned location') AS label,
                    a.category, a.status, COUNT(*) AS n
             FROM v_assets a
             LEFT JOIN locations loc ON loc.id = a.location_id
             WHERE TRUE {$filter}
             GROUP BY loc.name, a.category, a.status
             ORDER BY label, a.category",
            $params
        );

        $byDepartment = $this->inventoryGroup(
            "SELECT COALESCE(d.name, 'Unassigned dept') AS key,
                    COALESCE(d.name, 'Unassigned dept') AS label,
                    a.category, a.status, COUNT(*) AS n
             FROM v_assets a
             LEFT JOIN departments d ON d.id = a.department_id
             WHERE TRUE {$filter}
             GROUP BY d.name, a.category, a.status
             ORDER BY label, a.category",
            $params
        );

        $stockSql = "SELECT a.id, a.asset_tag, a.category, a.brand, a.model, a.serial_number,
                            a.status, c.short_name AS company, loc.name AS location_name
                     FROM v_assets a
                     JOIN companies c ON c.id = a.company_id
                     LEFT JOIN locations loc ON loc.id = a.location_id
                     WHERE a.status = 'available' {$filter}
                     ORDER BY c.short_name, a.category, a.asset_tag
                     LIMIT 500";
        $stockStmt = $this->pdo->prepare($stockSql);
        $stockStmt->execute($params);

        $lifecycleSql = "SELECT a.status, COUNT(*) AS n
                         FROM v_assets a WHERE TRUE {$filter}
                         GROUP BY a.status ORDER BY a.status";
        $lifeStmt = $this->pdo->prepare($lifecycleSql);
        $lifeStmt->execute($params);

        $warrantySql = "SELECT a.id, a.asset_tag, a.category, a.pc_name, c.short_name AS company,
                               a.warranty_expires_on,
                               (a.warranty_expires_on - CURRENT_DATE) AS days_remaining
                        FROM v_assets a
                        JOIN companies c ON c.id = a.company_id
                        WHERE a.warranty_expires_on IS NOT NULL
                          AND a.status::text NOT IN ('disposed', 'lost')
                          AND a.warranty_expires_on <= CURRENT_DATE + INTERVAL '90 days'
                          {$filter}
                        ORDER BY a.warranty_expires_on ASC
                        LIMIT 200";
        try {
            $wStmt = $this->pdo->prepare($warrantySql);
            $wStmt->execute($params);
            $warranties = $wStmt->fetchAll(PDO::FETCH_ASSOC);
        } catch (\Throwable) {
            $warranties = [];
        }

        $handoverSql = "SELECT h.id, h.handover_date, h.return_date, h.is_open, h.asset_type,
                               h.assigned_person_name, a.asset_tag, c.short_name AS company
                        FROM asset_handovers h
                        JOIN v_assets a ON a.id = h.asset_id AND a.category = h.asset_type
                        JOIN companies c ON c.id = h.company_id
                        WHERE TRUE" . ($companyId !== null ? ' AND h.company_id = :cid' : '') . "
                        ORDER BY h.handover_date DESC NULLS LAST, h.id DESC
                        LIMIT 200";
        $hStmt = $this->pdo->prepare($handoverSql);
        $hStmt->execute($params);

        Response::json([
            'byCompany' => $byCompany,
            'byLocation' => $byLocation,
            'byDepartment' => $byDepartment,
            'unassignedStock' => $stockStmt->fetchAll(PDO::FETCH_ASSOC),
            'lifecycle' => array_map(static function (array $r): array {
                return ['status' => $r['status'], 'count' => (int) $r['n']];
            }, $lifeStmt->fetchAll(PDO::FETCH_ASSOC)),
            'warranties' => $warranties,
            'handoverHistory' => $hStmt->fetchAll(PDO::FETCH_ASSOC),
        ]);
    }

    /**
     * GET /api/reports/branch-assets?company=ALL|IT|IMS|ISP
     * Per-branch asset counts (by category) for presentation / audits.
     */
    public function branchAssets(Request $request, array $user): void
    {
        $company = strtoupper(trim((string) $request->input('company', 'ALL')));
        if ($company === 'ITL') {
            $company = 'IT';
        }
        $companyId = null;
        if (($user['role'] ?? '') !== 'super_admin') {
            $companyId = (int) $user['company_id'];
        } elseif ($company !== '' && $company !== 'ALL') {
            $stmt = $this->pdo->prepare('SELECT id FROM companies WHERE code = :c LIMIT 1');
            $stmt->execute(['c' => $company]);
            $cid = $stmt->fetchColumn();
            $companyId = $cid !== false && $cid !== null ? (int) $cid : null;
        }

        $filter = $companyId !== null ? ' AND a.company_id = :cid' : '';
        $params = $companyId !== null ? ['cid' => $companyId] : [];

        try {
            // Printers entered under Other assets (item_name = Printers) count as printer,
            // not other — the dedicated printers table is often unused.
            $sql = "SELECT loc.id AS location_id,
                           COALESCE(loc.name, 'Unassigned location') AS location_name,
                           c.code AS company_code,
                           c.short_name AS company,
                           CASE
                             WHEN a.category = 'other'
                              AND EXISTS (
                                   SELECT 1 FROM other_assets oa
                                   WHERE oa.id = a.id
                                     AND oa.item_name ILIKE 'Printer%'
                                 )
                             THEN 'printer'
                             ELSE a.category
                           END AS category,
                           COUNT(*) AS n
                    FROM v_assets a
                    JOIN companies c ON c.id = a.company_id
                    LEFT JOIN locations loc ON loc.id = a.location_id
                    WHERE a.status::text NOT IN ('disposed')
                      AND c.code <> 'FOTON'
                      {$filter}
                    GROUP BY loc.id, loc.name, c.code, c.short_name,
                             CASE
                               WHEN a.category = 'other'
                                AND EXISTS (
                                     SELECT 1 FROM other_assets oa
                                     WHERE oa.id = a.id
                                       AND oa.item_name ILIKE 'Printer%'
                                   )
                               THEN 'printer'
                               ELSE a.category
                             END
                    ORDER BY c.code, location_name, category";
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            $raw = $stmt->fetchAll(PDO::FETCH_ASSOC);
        } catch (\Throwable $e) {
            Response::error('Could not load branch asset report: ' . $e->getMessage(), 500);
            return;
        }

        $branches = [];
        foreach ($raw as $row) {
            $lid = $row['location_id'] !== null ? (int) $row['location_id'] : 0;
            $code = (string) ($row['company_code'] ?? '');
            $key = $code . ':' . $lid;
            if (! isset($branches[$key])) {
                $branches[$key] = [
                    'location_id' => $lid > 0 ? $lid : null,
                    'location_name' => (string) ($row['location_name'] ?? 'Unassigned location'),
                    'company_code' => $code,
                    'company' => (string) ($row['company'] ?? $code),
                    'total' => 0,
                    'by_category' => [
                        'laptop' => 0,
                        'mobile_phone' => 0,
                        'pc' => 0,
                        'printer' => 0,
                        'other' => 0,
                    ],
                ];
            }
            $cat = (string) ($row['category'] ?? 'other');
            if (! isset($branches[$key]['by_category'][$cat])) {
                $branches[$key]['by_category'][$cat] = 0;
            }
            $n = (int) ($row['n'] ?? 0);
            $branches[$key]['by_category'][$cat] += $n;
            $branches[$key]['total'] += $n;
        }

        $list = array_values($branches);
        usort($list, static function (array $a, array $b): int {
            $c = strcmp((string) $a['company_code'], (string) $b['company_code']);
            if ($c !== 0) {
                return $c;
            }
            return $b['total'] <=> $a['total'];
        });

        Response::json(['data' => $list, 'meta' => ['total_branches' => count($list)]]);
    }

    /**
     * GET /api/reports/branch-assets/items?location_id=&company=&category=&department_id=
     * Asset rows for one branch (click-through from branch counts).
     */
    public function branchAssetItems(Request $request, array $user): void
    {
        $locationId = (int) $request->input('location_id', 0);
        $unassigned = $request->input('unassigned') === '1' || $request->input('unassigned') === true;
        if ($locationId < 1 && ! $unassigned) {
            Response::error('location_id is required (or unassigned=1)', 422);
            return;
        }

        $company = strtoupper(trim((string) $request->input('company', 'ALL')));
        if ($company === 'ITL') {
            $company = 'IT';
        }
        $companyId = null;
        if (($user['role'] ?? '') !== 'super_admin') {
            $companyId = (int) $user['company_id'];
        } elseif ($company !== '' && $company !== 'ALL') {
            $stmt = $this->pdo->prepare('SELECT id FROM companies WHERE code = :c LIMIT 1');
            $stmt->execute(['c' => $company]);
            $cid = $stmt->fetchColumn();
            $companyId = $cid !== false && $cid !== null ? (int) $cid : null;
        }

        $where = ["a.status::text NOT IN ('disposed')", "c.code <> 'FOTON'"];
        $params = [];
        if ($unassigned || $locationId < 1) {
            $where[] = 'a.location_id IS NULL';
        } else {
            $where[] = 'a.location_id = :lid';
            $params['lid'] = $locationId;
        }
        if ($companyId !== null) {
            $where[] = 'a.company_id = :cid';
            $params['cid'] = $companyId;
        }
        $departmentId = (int) $request->input('department_id', 0);
        if ($departmentId > 0) {
            $where[] = 'a.department_id = :did';
            $params['did'] = $departmentId;
        }
        $category = trim((string) $request->input('category', ''));
        $printerFromOther = "EXISTS (
            SELECT 1 FROM other_assets oa
            WHERE oa.id = a.id AND oa.item_name ILIKE 'Printer%'
        )";
        if ($category === 'printer') {
            // Dedicated printers table OR Other-assets rows tagged as Printers
            $where[] = "(a.category = 'printer' OR (a.category = 'other' AND {$printerFromOther}))";
        } elseif ($category === 'other') {
            // Exclude printer-like other assets so they only appear under Printers
            $where[] = "a.category = 'other' AND NOT ({$printerFromOther})";
        } elseif ($category !== '' && in_array($category, ['laptop', 'mobile_phone', 'pc'], true)) {
            $where[] = 'a.category = :cat';
            $params['cat'] = $category;
        }

        try {
            // v_assets exposes pc_name (holder / device name); allocated_* live on typed tables only
            $sql = "SELECT a.id, a.asset_tag,
                           CASE
                             WHEN a.category = 'other' AND {$printerFromOther} THEN 'printer'
                             ELSE a.category
                           END AS category,
                           a.brand, a.model, a.serial_number, a.status,
                           a.pc_name,
                           a.department_id,
                           d.name AS department_name,
                           c.code AS company_code, c.short_name AS company,
                           loc.name AS location_name
                    FROM v_assets a
                    JOIN companies c ON c.id = a.company_id
                    LEFT JOIN locations loc ON loc.id = a.location_id
                    LEFT JOIN departments d ON d.id = a.department_id
                    WHERE " . implode(' AND ', $where) . '
                    ORDER BY category, a.asset_tag
                    LIMIT 3000';
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
            foreach ($rows as &$row) {
                $row['allocated_person'] = $row['pc_name'] ?? null;
                $row['original_assigned_person'] = null;
            }
            unset($row);
        } catch (\Throwable $e) {
            Response::error('Could not load branch assets: ' . $e->getMessage(), 500);
            return;
        }

        Response::json(['data' => $rows, 'meta' => ['total' => count($rows)]]);
    }

    /**
     * GET /api/reports/pc-specs
     * Maintenance inventory filter: company, location, status, warranty, asset type,
     * plus PC-only processor / Windows filters.
     *
     * Query: company, location_id, status, warranty, category, cpu, windows_version, q
     * warranty: in | expired | expiring | none
     * category: all | pc | laptop | mobile_phone | other  (default pc; warranty never widens type)
     */
    public function pcSpecs(Request $request, array $user): void
    {
        $company = strtoupper(trim((string) $request->input('company', 'ALL')));
        if ($company === 'ITL') {
            $company = 'IT';
        }
        $companyId = null;
        if (($user['role'] ?? '') !== 'super_admin') {
            $companyId = (int) $user['company_id'];
        } elseif ($company !== '' && $company !== 'ALL') {
            $stmt = $this->pdo->prepare('SELECT id FROM companies WHERE code = :c LIMIT 1');
            $stmt->execute(['c' => $company]);
            $cid = $stmt->fetchColumn();
            $companyId = $cid !== false && $cid !== null ? (int) $cid : null;
        }

        $warranty = strtolower(trim((string) $request->input('warranty', '')));
        $categoryRaw = strtolower(trim((string) $request->input('category', '')));
        if ($categoryRaw === 'desktop_pc') {
            $categoryRaw = 'pc';
        }
        // Asset type is authoritative. Warranty only filters within that type.
        // Empty → Desktop PCs; "all" → whole inventory; otherwise the selected type only.
        if ($categoryRaw === 'all') {
            $categories = ['pc', 'laptop', 'mobile_phone', 'other'];
        } elseif (in_array($categoryRaw, ['pc', 'laptop', 'mobile_phone', 'other'], true)) {
            $categories = [$categoryRaw];
        } else {
            $categories = ['pc'];
        }

        $cpu = trim((string) $request->input('cpu', $request->input('processor', '')));
        $windows = trim((string) $request->input('windows_version', ''));
        $status = trim((string) $request->input('status', ''));
        $q = trim((string) $request->input('q', ''));
        $locationId = $request->input('location_id') ? (int) $request->input('location_id') : 0;

        $defs = [
            'pc' => [
                'table' => 'pcs',
                'label' => 'Desktop PC',
                'holder' => "COALESCE(NULLIF(TRIM(a.allocated_person), ''), NULLIF(TRIM(a.pc_name), ''), NULLIF(TRIM(a.original_assigned_person), ''))",
                'cpu' => 'a.cpu',
                'ram' => 'a.ram_gb',
                'windows' => 'a.windows_version',
                'warranty' => 'a.warranty_expires_on',
                // pcs has warranty_period; laptops/printers do not
                'warranty_period' => 'a.warranty_period',
                'extra_search' => 'a.cpu ILIKE :q OR a.windows_version ILIKE :q OR a.allocated_person ILIKE :q OR a.original_assigned_person ILIKE :q',
            ],
            'laptop' => [
                'table' => 'laptops',
                'label' => 'Laptop',
                'holder' => "COALESCE(NULLIF(TRIM(a.allocated_person), ''), NULLIF(TRIM(a.pc_name), ''), NULLIF(TRIM(a.original_assigned_person), ''))",
                'cpu' => 'a.cpu',
                'ram' => 'a.ram_gb',
                'windows' => 'NULL::varchar',
                'warranty' => 'a.warranty_expires_on',
                'warranty_period' => 'NULL::varchar',
                'extra_search' => 'a.cpu ILIKE :q OR a.allocated_person ILIKE :q OR a.original_assigned_person ILIKE :q',
            ],
            'mobile_phone' => [
                'table' => 'mobile_phones',
                'label' => 'Mobile phone',
                'holder' => "COALESCE(NULLIF(TRIM(a.allocated_person), ''), NULLIF(TRIM(a.pc_name), ''), NULLIF(TRIM(a.original_assigned_person), ''), NULLIF(TRIM(a.first_handover_person), ''))",
                'cpu' => 'NULL::varchar',
                'ram' => 'NULL::numeric',
                'windows' => 'NULL::varchar',
                'warranty' => 'a.warranty_expires_on',
                'warranty_period' => 'a.warranty_period',
                'extra_search' => 'a.imei_number ILIKE :q OR a.phone_number ILIKE :q OR a.allocated_person ILIKE :q OR a.original_assigned_person ILIKE :q',
            ],
            'other' => [
                'table' => 'other_assets',
                'label' => 'Other asset',
                'holder' => "COALESCE(NULLIF(TRIM(a.user_name), ''), NULLIF(TRIM(a.pc_name), ''), NULLIF(TRIM(a.item_name), ''))",
                'cpu' => 'NULL::varchar',
                'ram' => 'NULL::numeric',
                'windows' => 'NULL::varchar',
                'warranty' => 'a.warranty_expires_on',
                'warranty_period' => 'a.warranty_period',
                'extra_search' => 'a.item_name ILIKE :q OR a.user_name ILIKE :q OR a.specification ILIKE :q',
            ],
        ];

        $rows = [];
        try {
            foreach ($categories as $cat) {
                if (! isset($defs[$cat])) {
                    continue;
                }
                $d = $defs[$cat];
                $where = ["a.status::text NOT IN ('disposed')"];
                $params = [];

                if ($companyId !== null) {
                    $where[] = 'a.company_id = :cid';
                    $params['cid'] = $companyId;
                }
                if ($locationId > 0) {
                    $where[] = 'a.location_id = :lid';
                    $params['lid'] = $locationId;
                }
                if ($status !== '') {
                    $where[] = 'a.status = :status';
                    $params['status'] = $status;
                }
                // Processor / Windows only apply to PCs (and laptop CPU when selected)
                if ($cpu !== '' && in_array($cat, ['pc', 'laptop'], true)) {
                    $where[] = 'a.cpu ILIKE :cpu';
                    $params['cpu'] = '%' . $cpu . '%';
                }
                if ($windows !== '' && $cat === 'pc') {
                    $where[] = 'a.windows_version ILIKE :win';
                    $params['win'] = '%' . $windows . '%';
                }
                if ($warranty === 'in') {
                    $where[] = "{$d['warranty']} IS NOT NULL AND {$d['warranty']} >= CURRENT_DATE";
                } elseif ($warranty === 'expired') {
                    $where[] = "{$d['warranty']} IS NOT NULL AND {$d['warranty']} < CURRENT_DATE";
                } elseif ($warranty === 'expiring') {
                    $where[] = "{$d['warranty']} IS NOT NULL
                        AND {$d['warranty']} >= CURRENT_DATE
                        AND {$d['warranty']} <= (CURRENT_DATE + INTERVAL '90 days')";
                } elseif ($warranty === 'none') {
                    $where[] = "{$d['warranty']} IS NULL";
                }
                if ($q !== '') {
                    $where[] = "(a.asset_tag ILIKE :q OR a.pc_name ILIKE :q OR a.serial_number ILIKE :q
                        OR a.brand ILIKE :q OR a.model ILIKE :q OR {$d['extra_search']})";
                    $params['q'] = '%' . $q . '%';
                }

                $sql = "SELECT a.id, a.asset_tag, a.pc_name, a.brand, a.model, a.serial_number,
                               {$d['cpu']} AS cpu, {$d['ram']} AS ram_gb, {$d['windows']} AS windows_version,
                               a.status, {$d['warranty']} AS warranty_expires_on,
                               {$d['warranty_period']} AS warranty_period,
                               {$d['holder']} AS allocated_person,
                               '{$cat}' AS category,
                               '{$d['label']}' AS category_label,
                               c.code AS company_code, c.short_name AS company,
                               loc.name AS location_name
                        FROM {$d['table']} a
                        JOIN companies c ON c.id = a.company_id
                        LEFT JOIN locations loc ON loc.id = a.location_id
                        WHERE " . implode(' AND ', $where) . '
                        ORDER BY c.code, loc.name NULLS LAST, a.asset_tag
                        LIMIT 2000';
                $stmt = $this->pdo->prepare($sql);
                $stmt->execute($params);
                foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
                    $rows[] = $row;
                }
            }

            usort($rows, static function (array $a, array $b): int {
                $ca = (string) ($a['company_code'] ?? '');
                $cb = (string) ($b['company_code'] ?? '');
                if ($ca !== $cb) {
                    return strcmp($ca, $cb);
                }
                $la = (string) ($a['location_name'] ?? '');
                $lb = (string) ($b['location_name'] ?? '');
                if ($la !== $lb) {
                    return strcmp($la, $lb);
                }
                return strcmp((string) ($a['asset_tag'] ?? ''), (string) ($b['asset_tag'] ?? ''));
            });
            if (count($rows) > 2000) {
                $rows = array_slice($rows, 0, 2000);
            }

            $facetCompany = $companyId !== null ? ' AND company_id = :cid' : '';
            $facetParams = $companyId !== null ? ['cid' => $companyId] : [];
            $cpuFacet = $this->pdo->prepare(
                "SELECT DISTINCT btrim(cpu) AS value
                 FROM pcs
                 WHERE cpu IS NOT NULL AND btrim(cpu) <> ''
                   AND status::text NOT IN ('disposed'){$facetCompany}
                 ORDER BY 1
                 LIMIT 200"
            );
            $cpuFacet->execute($facetParams);
            $winFacet = $this->pdo->prepare(
                "SELECT DISTINCT btrim(windows_version) AS value
                 FROM pcs
                 WHERE windows_version IS NOT NULL AND btrim(windows_version) <> ''
                   AND status::text NOT IN ('disposed'){$facetCompany}
                 ORDER BY 1
                 LIMIT 100"
            );
            $winFacet->execute($facetParams);
        } catch (\Throwable $e) {
            Response::error('Could not load maintenance report: ' . $e->getMessage(), 500);
            return;
        }

        Response::json([
            'data' => $rows,
            'meta' => [
                'total' => count($rows),
                'processors' => array_values(array_filter(array_map(
                    static fn ($r) => (string) ($r['value'] ?? ''),
                    $cpuFacet->fetchAll(PDO::FETCH_ASSOC)
                ))),
                'windows_versions' => array_values(array_filter(array_map(
                    static fn ($r) => (string) ($r['value'] ?? ''),
                    $winFacet->fetchAll(PDO::FETCH_ASSOC)
                ))),
            ],
        ]);
    }

    /**
     * GET /api/reports/stock
     * Available stock across all asset types (new + old/legacy).
     * Query: company, location_id, status (default available), stock=all|new|old, category, q
     */
    public function stock(Request $request, array $user): void
    {
        $company = strtoupper(trim((string) $request->input('company', 'ALL')));
        if ($company === 'ITL') {
            $company = 'IT';
        }
        $companyId = null;
        if (($user['role'] ?? '') !== 'super_admin') {
            $companyId = (int) $user['company_id'];
        } elseif ($company !== '' && $company !== 'ALL') {
            $stmt = $this->pdo->prepare('SELECT id FROM companies WHERE code = :c LIMIT 1');
            $stmt->execute(['c' => $company]);
            $cid = $stmt->fetchColumn();
            $companyId = $cid !== false && $cid !== null ? (int) $cid : null;
        }

        $status = strtolower(trim((string) $request->input('status', 'available')));
        if ($status === '' || $status === 'all') {
            $status = 'available';
        }
        $locationId = $request->input('location_id') ? (int) $request->input('location_id') : 0;
        $stockKind = strtolower(trim((string) $request->input('stock', 'all'))); // all|new|old
        $categoryFilter = strtolower(trim((string) $request->input('category', 'all')));
        if ($categoryFilter === 'others') {
            $categoryFilter = 'other';
        }
        $q = trim((string) $request->input('q', ''));

        $defs = [
            'laptop' => [
                'table' => 'laptops',
                'legacy_expr' => 'COALESCE(a.is_legacy, FALSE)',
                'holder' => "COALESCE(NULLIF(TRIM(a.allocated_person), ''), NULLIF(TRIM(a.original_assigned_person), ''), NULLIF(TRIM(a.pc_name), ''))",
                'extra' => 'a.brand, a.model, a.serial_number',
            ],
            'mobile_phone' => [
                'table' => 'mobile_phones',
                'legacy_expr' => 'COALESCE(a.is_legacy, FALSE)',
                'holder' => "COALESCE(NULLIF(TRIM(a.allocated_person), ''), NULLIF(TRIM(a.original_assigned_person), ''), NULLIF(TRIM(a.first_handover_person), ''), NULLIF(TRIM(a.pc_name), ''))",
                'extra' => 'a.brand, a.model, a.serial_number',
            ],
            'pc' => [
                'table' => 'pcs',
                // Newly purchased register vs older fleet PCs
                'legacy_expr' => 'CASE WHEN COALESCE(a.newly_purchased, FALSE) THEN FALSE ELSE TRUE END',
                'holder' => "COALESCE(NULLIF(TRIM(a.allocated_person), ''), NULLIF(TRIM(a.original_assigned_person), ''), NULLIF(TRIM(a.pc_name), ''))",
                'extra' => 'a.brand, a.model, a.serial_number',
            ],
            'other' => [
                'table' => 'other_assets',
                'legacy_expr' => 'FALSE',
                'holder' => "COALESCE(NULLIF(TRIM(a.user_name), ''), NULLIF(TRIM(a.pc_name), ''), NULLIF(TRIM(a.item_name), ''))",
                'extra' => 'a.brand, a.model, a.serial_number, a.item_name',
            ],
        ];

        $categories = array_keys($defs);
        if ($categoryFilter !== '' && $categoryFilter !== 'all' && isset($defs[$categoryFilter])) {
            $categories = [$categoryFilter];
        }

        $rows = [];
        try {
            foreach ($categories as $cat) {
                $d = $defs[$cat];
                $where = ["a.status::text = :status", "c.code <> 'FOTON'"];
                $params = ['status' => $status];
                if ($companyId !== null) {
                    $where[] = 'a.company_id = :cid';
                    $params['cid'] = $companyId;
                }
                if ($locationId > 0) {
                    $where[] = 'a.location_id = :lid';
                    $params['lid'] = $locationId;
                }
                if ($stockKind === 'new') {
                    $where[] = "({$d['legacy_expr']}) = FALSE";
                } elseif ($stockKind === 'old') {
                    $where[] = "({$d['legacy_expr']}) = TRUE";
                }
                if ($q !== '') {
                    $where[] = "(a.asset_tag ILIKE :q OR a.pc_name ILIKE :q OR a.serial_number ILIKE :q
                        OR a.brand ILIKE :q OR a.model ILIKE :q OR {$d['holder']} ILIKE :q
                        OR loc.name ILIKE :q)";
                    $params['q'] = '%' . $q . '%';
                }

                $itemSelect = $cat === 'other' ? 'a.item_name' : 'NULL::varchar AS item_name';
                $sql = "SELECT a.id, a.asset_tag, '{$cat}' AS category, a.status,
                               a.brand, a.model, a.serial_number,
                               {$itemSelect},
                               {$d['holder']} AS holder_name,
                               ({$d['legacy_expr']}) AS is_legacy,
                               c.code AS company_code, c.short_name AS company,
                               loc.name AS location_name, a.location_id
                        FROM {$d['table']} a
                        JOIN companies c ON c.id = a.company_id
                        LEFT JOIN locations loc ON loc.id = a.location_id
                        WHERE " . implode(' AND ', $where) . '
                        ORDER BY a.asset_tag
                        LIMIT 3000';
                $stmt = $this->pdo->prepare($sql);
                $stmt->execute($params);
                foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
                    $legacy = ($row['is_legacy'] ?? false) === true
                        || $row['is_legacy'] === 't'
                        || $row['is_legacy'] === '1'
                        || $row['is_legacy'] === 1;
                    $row['is_legacy'] = $legacy;
                    $row['stock_kind'] = $legacy ? 'old' : 'new';
                    $rows[] = $row;
                }
            }
        } catch (\Throwable $e) {
            Response::error('Could not load stock report: ' . $e->getMessage(), 500);
            return;
        }

        usort($rows, static function (array $a, array $b): int {
            $ka = (string) ($a['category'] ?? '');
            $kb = (string) ($b['category'] ?? '');
            if ($ka !== $kb) {
                return strcmp($ka, $kb);
            }
            return strcmp((string) ($a['asset_tag'] ?? ''), (string) ($b['asset_tag'] ?? ''));
        });

        $newCount = 0;
        $oldCount = 0;
        $byCategory = [];
        foreach ($rows as $r) {
            $cat = (string) ($r['category'] ?? 'other');
            $byCategory[$cat] = ($byCategory[$cat] ?? 0) + 1;
            if (! empty($r['is_legacy'])) {
                $oldCount++;
            } else {
                $newCount++;
            }
        }

        Response::json([
            'data' => $rows,
            'meta' => [
                'total' => count($rows),
                'new_count' => $newCount,
                'old_count' => $oldCount,
                'by_category' => $byCategory,
                'status' => $status,
            ],
        ]);
    }

    /**
     * @param array<string, mixed> $params
     * @return list<array<string, mixed>>
     */
    private function inventoryGroup(string $sql, array $params): array
    {
        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            return array_map(static function (array $r): array {
                return [
                    'key' => $r['key'],
                    'label' => $r['label'],
                    'category' => $r['category'],
                    'status' => $r['status'],
                    'count' => (int) $r['n'],
                ];
            }, $stmt->fetchAll(PDO::FETCH_ASSOC));
        } catch (\Throwable) {
            return [];
        }
    }
}
