<?php

declare(strict_types=1);

namespace Indra\Itam\Controllers;

use Indra\Itam\Http\Request;
use Indra\Itam\Http\Response;
use PDO;

final class EmployeeController
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    /** GET /api/employees?company=IT|IMS|ISP&q=&status= */
    public function index(Request $request, array $user): void
    {
        $company = strtoupper(trim((string) $request->input('company', '')));
        $q = trim((string) $request->input('q', ''));
        $status = trim((string) $request->input('status', ''));
        $limit = min(1000, max(1, (int) $request->input('limit', 500)));

        $sql = $this->selectSql() . ' WHERE e.is_active = TRUE';
        $params = [];

        if ($company === 'ITL') {
            $company = 'IT';
        }

        // Typing a name (autocomplete): prefer the selected company but still surface
        // matches from other Indra companies (staff often hold assets across ITL/IMS/ISP).
        // Directory browse without q: keep hard company filter.
        $preferCompany = '';
        if ($company !== '' && $company !== 'ALL') {
            if ($q !== '') {
                $preferCompany = $company;
            } else {
                $sql .= ' AND c.code = :company_code';
                $params['company_code'] = $company;
            }
        }

        if ($status !== '') {
            $sql .= ' AND e.employment_status = :status';
            $params['status'] = $status;
        }

        $location = trim((string) $request->input('location', ''));
        if ($location !== '') {
            $sql .= ' AND e.work_location = :work_location';
            $params['work_location'] = $location;
        }

        if ($q !== '') {
            $sql .= ' AND (
                e.name ILIKE :q OR e.staff_id ILIKE :q OR e.epf_number ILIKE :q
                OR e.designation ILIKE :q OR e.work_location ILIKE :q OR e.department_name ILIKE :q
            )';
            $params['q'] = '%' . $q . '%';
        }

        // Current / Probation first, then Former — so live staff surface before leavers
        $order = ' ORDER BY '
            . "CASE LOWER(COALESCE(e.directory_tag, e.employment_status, '')) "
            . "WHEN 'current' THEN 0 WHEN 'probation' THEN 1 WHEN 'former' THEN 2 "
            . "WHEN 'exemployee' THEN 2 WHEN 'ex-employee' THEN 2 ELSE 3 END, ";
        if ($preferCompany !== '') {
            $order .= 'CASE WHEN c.code = :prefer_company THEN 0 ELSE 1 END, ';
            $params['prefer_company'] = $preferCompany;
        }
        $order .= 'CASE WHEN e.staff_id ~ \'^[0-9]+$\' THEN e.staff_id::bigint ELSE NULL END ASC NULLS LAST, e.staff_id ASC, e.name ASC';
        $sql .= $order . ' LIMIT ' . $limit;

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            $rows = $stmt->fetchAll();
        } catch (\Throwable $e) {
            Response::error('Employees table missing — run import_employees_from_excel.php', 500);
            return;
        }

        $counts = [];
        try {
            $countRows = $this->pdo->query(
                "SELECT c.code, COUNT(*)::int AS total
                 FROM employees e
                 JOIN companies c ON c.id = e.company_id
                 WHERE e.is_active = TRUE
                 GROUP BY c.code"
            )->fetchAll();
            foreach ($countRows as $cr) {
                $counts[(string) $cr['code']] = (int) $cr['total'];
            }
        } catch (\Throwable) {
            $counts = [];
        }

        Response::json([
            'data' => $rows,
            'meta' => [
                'counts' => $counts,
                'total' => count($rows),
            ],
        ]);
    }

    /**
     * GET /api/employees/locations?company=IT|IMS|ISP
     * Distinct HR work locations from the Excel staff directory (not asset branch locations).
     */
    public function locations(Request $request, array $user): void
    {
        $company = strtoupper(trim((string) $request->input('company', '')));
        if ($company === 'ITL') {
            $company = 'IT';
        }

        $sql = "SELECT e.work_location AS name,
                       c.code AS company_code,
                       c.short_name AS company_short,
                       COUNT(*)::int AS employee_count,
                       COUNT(DISTINCT NULLIF(btrim(e.department_name), ''))::int AS department_count
                FROM employees e
                JOIN companies c ON c.id = e.company_id
                WHERE e.is_active = TRUE
                  AND e.work_location IS NOT NULL
                  AND btrim(e.work_location) <> ''";
        $params = [];

        if ($company !== '' && $company !== 'ALL') {
            $sql .= ' AND c.code = :company_code';
            $params['company_code'] = $company;
        }

        $sql .= ' GROUP BY e.work_location, c.code, c.short_name
                  ORDER BY employee_count DESC, e.work_location ASC';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            $rows = $stmt->fetchAll();
        } catch (\Throwable) {
            Response::error('Employees table missing — run import_employees_from_excel.php', 500);
            return;
        }

        $counts = [];
        try {
            $countRows = $this->pdo->query(
                "SELECT c.code, COUNT(DISTINCT e.work_location)::int AS total
                 FROM employees e
                 JOIN companies c ON c.id = e.company_id
                 WHERE e.is_active = TRUE
                   AND e.work_location IS NOT NULL
                   AND btrim(e.work_location) <> ''
                 GROUP BY c.code"
            )->fetchAll();
            foreach ($countRows as $cr) {
                $counts[(string) $cr['code']] = (int) $cr['total'];
            }
        } catch (\Throwable) {
            $counts = [];
        }

        Response::json([
            'data' => $rows,
            'meta' => [
                'counts' => $counts,
                'total' => count($rows),
            ],
        ]);
    }

    /** POST /api/employees — create (only name required; other fields optional) */
    public function store(Request $request, array $user): void
    {
        if (! $this->canManage($user)) {
            Response::error('Only IT admins can add employees', 403);
            return;
        }

        $companyCode = strtoupper(trim((string) $request->input('company', $request->input('company_code', ''))));
        if ($companyCode === 'ITL') {
            $companyCode = 'IT';
        }
        if ($companyCode === '') {
            Response::error('company is required (IT, IMS, or ISP)', 422);
            return;
        }

        $companyId = $this->resolveCompanyId($companyCode);
        if ($companyId === null) {
            Response::error('Unknown company', 422);
            return;
        }

        $parsed = $this->parseEmployeePayload($request, null);
        if ($parsed['error'] !== null) {
            Response::error($parsed['error'], 422);
            return;
        }
        $data = $parsed['data'];
        if ($data['name'] === '') {
            Response::error('Name is required', 422);
            return;
        }

        // Staff ID optional — assign a temporary unique code when unknown
        if ($data['staff_id'] === '') {
            $data['staff_id'] = $this->nextTempStaffId($companyId, $companyCode);
        }

        try {
            $stmt = $this->pdo->prepare(
                'INSERT INTO employees (
                    company_id, staff_id, name, title, epf_number, employment_status,
                    directory_tag, designation, work_location, department_name, is_active
                 ) VALUES (
                    :company_id, :staff_id, :name, :title, :epf_number, :employment_status,
                    :directory_tag, :designation, :work_location, :department_name, TRUE
                 ) RETURNING id'
            );
            $stmt->execute([
                'company_id' => $companyId,
                'staff_id' => $data['staff_id'],
                'name' => $data['name'],
                'title' => $data['title'],
                'epf_number' => $data['epf_number'],
                'employment_status' => $data['employment_status'],
                'directory_tag' => $data['employment_status'],
                'designation' => $data['designation'],
                'work_location' => $data['work_location'],
                'department_name' => $data['department_name'],
            ]);
            $newId = (int) $stmt->fetchColumn();
        } catch (\Throwable $e) {
            Response::error('Could not add employee (duplicate staff ID?)', 422);
            return;
        }

        $row = $this->find($newId);
        Response::json(['data' => $row, 'message' => 'Employee added'], 201);
    }

    /** GET /api/employees/{id} */
    public function show(Request $request, array $user, string $id): void
    {
        $row = $this->find((int) $id);
        if (! $row) {
            Response::error('Employee not found', 404);
            return;
        }
        Response::json(['data' => $row]);
    }

    /** PUT /api/employees/{id} */
    public function update(Request $request, array $user, string $id): void
    {
        if (! $this->canManage($user)) {
            Response::error('Only IT admins can update employees', 403);
            return;
        }

        $empId = (int) $id;
        $existing = $this->find($empId);
        if (! $existing) {
            Response::error('Employee not found', 404);
            return;
        }

        $parsed = $this->parseEmployeePayload($request, $existing);
        if ($parsed['error'] !== null) {
            Response::error($parsed['error'], 422);
            return;
        }
        $data = $parsed['data'];
        if ($data['name'] === '') {
            Response::error('Name is required', 422);
            return;
        }
        if ($data['staff_id'] === '') {
            Response::error('Staff ID is required when updating', 422);
            return;
        }

        try {
            $stmt = $this->pdo->prepare(
                'UPDATE employees SET
                    staff_id = :staff_id,
                    name = :name,
                    title = :title,
                    epf_number = :epf_number,
                    employment_status = :employment_status,
                    directory_tag = :directory_tag,
                    designation = :designation,
                    work_location = :work_location,
                    department_name = :department_name,
                    updated_at = NOW()
                 WHERE id = :id
                 RETURNING id'
            );
            $stmt->execute([
                'staff_id' => $data['staff_id'],
                'name' => $data['name'],
                'title' => $data['title'],
                'epf_number' => $data['epf_number'],
                'employment_status' => $data['employment_status'],
                'directory_tag' => $data['employment_status'],
                'designation' => $data['designation'],
                'work_location' => $data['work_location'],
                'department_name' => $data['department_name'],
                'id' => $empId,
            ]);
        } catch (\Throwable) {
            Response::error('Could not update employee (duplicate staff ID?)', 422);
            return;
        }

        $row = $this->find($empId);
        Response::json(['data' => $row, 'message' => 'Employee updated']);
    }

    /** DELETE /api/employees/{id} — soft delete */
    public function destroy(Request $request, array $user, string $id): void
    {
        if (! $this->canManage($user)) {
            Response::error('Only IT admins can remove employees', 403);
            return;
        }

        $empId = (int) $id;
        $existing = $this->find($empId);
        if (! $existing) {
            Response::error('Employee not found', 404);
            return;
        }

        $this->pdo->prepare(
            'UPDATE employees SET is_active = FALSE, updated_at = NOW() WHERE id = :id'
        )->execute(['id' => $empId]);

        Response::json(['message' => 'Employee removed from organization directory']);
    }

    private function selectSql(): string
    {
        return 'SELECT e.id, e.staff_id, e.name, e.title, e.epf_number, e.employment_status,
                       COALESCE(NULLIF(e.directory_tag, \'\'), e.employment_status) AS directory_tag,
                       e.designation, e.work_location, e.department_name, e.is_active,
                       e.company_id, c.code AS company_code, c.short_name AS company_short, c.name AS company_name,
                       CASE
                         WHEN e.title IS NOT NULL AND e.title <> \'\' THEN e.title || \'. \' || e.name
                         ELSE e.name
                       END AS display_name
                FROM employees e
                JOIN companies c ON c.id = e.company_id';
    }

    /** @return array<string, mixed>|null */
    private function find(int $id): ?array
    {
        if ($id < 1) {
            return null;
        }
        $stmt = $this->pdo->prepare($this->selectSql() . ' WHERE e.id = :id LIMIT 1');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    private function resolveCompanyId(string $code): ?int
    {
        $stmt = $this->pdo->prepare(
            'SELECT id FROM companies WHERE code = :c AND is_active = TRUE LIMIT 1'
        );
        $stmt->execute(['c' => $code]);
        $id = $stmt->fetchColumn();
        return $id !== false ? (int) $id : null;
    }

    /**
     * @param array<string, mixed>|null $existing
     * @return array{data: array{staff_id:string,name:string,title:?string,epf_number:?string,employment_status:string,designation:?string,work_location:?string,department_name:?string}, error:?string}
     */
    private function parseEmployeePayload(Request $request, ?array $existing): array
    {
        $name = trim((string) $request->input('name', $existing['name'] ?? ''));
        $staffId = trim((string) $request->input('staff_id', $existing['staff_id'] ?? ''));
        $title = trim((string) $request->input('title', (string) ($existing['title'] ?? '')));
        $epf = trim((string) $request->input('epf_number', (string) ($existing['epf_number'] ?? '')));
        $status = trim((string) $request->input('employment_status', (string) ($existing['employment_status'] ?? 'Current')));
        $designation = trim((string) $request->input('designation', (string) ($existing['designation'] ?? '')));
        $location = trim((string) $request->input('work_location', (string) ($existing['work_location'] ?? '')));
        $department = trim((string) $request->input('department_name', (string) ($existing['department_name'] ?? '')));

        if ($title !== '' && ! in_array($title, ['Mr', 'Ms', 'Mrs'], true)) {
            return [
                'data' => [
                    'staff_id' => '',
                    'name' => '',
                    'title' => null,
                    'epf_number' => null,
                    'employment_status' => 'Current',
                    'designation' => null,
                    'work_location' => null,
                    'department_name' => null,
                ],
                'error' => 'title must be Mr, Ms, or Mrs (or leave blank)',
            ];
        }

        if ($status === '') {
            $status = 'Current';
        }
        // Normalize legacy / HR export labels
        $statusKey = strtolower(str_replace([' ', '_', '-'], '', $status));
        if (in_array($statusKey, ['exemployee', 'former'], true)) {
            $status = 'Former';
        } elseif ($statusKey === 'probation') {
            $status = 'Probation';
        } elseif ($statusKey === 'current') {
            $status = 'Current';
        }

        return [
            'data' => [
                'staff_id' => $staffId,
                'name' => $name,
                'title' => $title !== '' ? $title : null,
                'epf_number' => $epf !== '' ? $epf : null,
                'employment_status' => $status,
                'designation' => $designation !== '' ? $designation : null,
                'work_location' => $location !== '' ? $location : null,
                'department_name' => $department !== '' ? $department : null,
            ],
            'error' => null,
        ];
    }

    private function nextTempStaffId(int $companyId, string $companyCode): string
    {
        $prefix = match ($companyCode) {
            'IT' => 'TEMP-ITL-',
            'IMS' => 'TEMP-IMS-',
            'ISP' => 'TEMP-ISP-',
            default => 'TEMP-',
        };

        $stmt = $this->pdo->prepare(
            "SELECT COALESCE(MAX(
                CAST(NULLIF(substring(staff_id from '([0-9]+)$'), '') AS INTEGER)
             ), 0)
             FROM employees
             WHERE company_id = :cid AND staff_id LIKE :pfx"
        );
        $stmt->execute(['cid' => $companyId, 'pfx' => $prefix . '%']);
        $next = ((int) $stmt->fetchColumn()) + 1;

        return $prefix . str_pad((string) $next, 4, '0', STR_PAD_LEFT);
    }

    /** @param array<string, mixed> $user */
    private function canManage(array $user): bool
    {
        return in_array($user['role'] ?? '', ['super_admin', 'it_admin', 'it_staff'], true);
    }
}
