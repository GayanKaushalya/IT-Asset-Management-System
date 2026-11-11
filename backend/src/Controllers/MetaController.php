<?php

declare(strict_types=1);

namespace Indra\Itam\Controllers;

use Indra\Itam\Http\Request;
use Indra\Itam\Http\Response;
use Indra\Itam\Support\Auth;
use PDO;

final class MetaController
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function companies(array $user): void
    {
        if (($user['role'] ?? '') === 'super_admin') {
            $rows = $this->pdo->query(
                'SELECT id, code, name, short_name FROM companies WHERE is_active = TRUE ORDER BY id'
            )->fetchAll();
        } else {
            $stmt = $this->pdo->prepare(
                'SELECT id, code, name, short_name FROM companies WHERE id = :id AND is_active = TRUE'
            );
            $stmt->execute(['id' => $user['company_id']]);
            $rows = $stmt->fetchAll();
        }
        Response::json(['data' => $rows]);
    }

    public function locations(array $user, ?Request $request = null): void
    {
        $sql = 'SELECT l.id, l.company_id, l.code, l.name, l.city,
                       c.short_name AS company_short, c.code AS company_code
                FROM locations l
                JOIN companies c ON c.id = l.company_id
                WHERE l.is_active = TRUE';
        $params = [];
        if (($user['role'] ?? '') !== 'super_admin') {
            $sql .= ' AND l.company_id = :c';
            $params['c'] = $user['company_id'];
        } elseif ($request !== null && $request->input('company_id')) {
            $sql .= ' AND l.company_id = :c';
            $params['c'] = (int) $request->input('company_id');
        }
        $sql .= ' ORDER BY l.company_id, l.name';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        Response::json(['data' => $stmt->fetchAll()]);
    }

    public function departments(array $user): void
    {
        $sql = 'SELECT d.id, d.company_id, d.location_id, d.code, d.name,
                       c.short_name AS company_short, c.code AS company_code,
                       l.name AS location_name
                FROM departments d
                JOIN companies c ON c.id = d.company_id
                LEFT JOIN locations l ON l.id = d.location_id
                WHERE d.is_active = TRUE';
        $params = [];
        if (($user['role'] ?? '') !== 'super_admin') {
            $sql .= ' AND d.company_id = :c';
            $params['c'] = $user['company_id'];
        }
        $sql .= ' ORDER BY d.company_id, d.name';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        Response::json(['data' => $stmt->fetchAll()]);
    }

    public function suppliers(array $user): void
    {
        $sql = 'SELECT s.id, s.company_id, s.name, s.contact_person, s.phone, s.email,
                       c.short_name AS company_short
                FROM suppliers s
                LEFT JOIN companies c ON c.id = s.company_id
                WHERE s.is_active = TRUE';
        $params = [];
        if (($user['role'] ?? '') !== 'super_admin') {
            $sql .= ' AND (s.company_id = :c OR s.company_id IS NULL)';
            $params['c'] = $user['company_id'];
        }
        $sql .= ' ORDER BY s.name';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        Response::json(['data' => $stmt->fetchAll()]);
    }

    public function storeLocation(Request $request, array $user): void
    {
        if (! $this->canManageOrg($user)) {
            Response::error('Not allowed to manage locations', 403);
            return;
        }

        $companyId = (int) $request->input('company_id', $user['company_id']);
        Auth::assertCompanyAccess($user, $companyId);
        $code = strtoupper(trim((string) $request->input('code', '')));
        $name = trim((string) $request->input('name', ''));
        $city = trim((string) $request->input('city', ''));

        if ($code === '' || $name === '') {
            Response::error('code and name are required', 422);
            return;
        }

        try {
            $stmt = $this->pdo->prepare(
                'INSERT INTO locations (company_id, code, name, city, is_active)
                 VALUES (:company_id, :code, :name, :city, TRUE)
                 RETURNING id, company_id, code, name, city'
            );
            $stmt->execute([
                'company_id' => $companyId,
                'code' => $code,
                'name' => $name,
                'city' => $city !== '' ? $city : null,
            ]);
        } catch (\Throwable) {
            Response::error('Could not create location (duplicate code?)', 422);
            return;
        }

        Response::json(['data' => $stmt->fetch()], 201);
    }

    public function storeDepartment(Request $request, array $user): void
    {
        if (! $this->canManageOrg($user)) {
            Response::error('Not allowed to manage departments', 403);
            return;
        }

        $companyId = (int) $request->input('company_id', $user['company_id']);
        Auth::assertCompanyAccess($user, $companyId);
        $name = trim((string) $request->input('name', ''));
        $code = strtoupper(trim((string) $request->input('code', '')));
        $locationId = (int) $request->input('location_id', 0);

        if ($name === '') {
            Response::error('Department name is required', 422);
            return;
        }

        // Easy add: code optional — derive from name (SUPPORT_SERVICES)
        if ($code === '') {
            $code = strtoupper(preg_replace('/[^A-Za-z0-9]+/', '_', $name) ?? '');
            $code = trim($code, '_');
            if ($code === '') {
                $code = 'DEPT';
            }
            if (strlen($code) > 40) {
                $code = rtrim(substr($code, 0, 40), '_');
            }
        }

        // Avoid duplicate name under same company
        $dupName = $this->pdo->prepare(
            'SELECT id FROM departments
             WHERE company_id = :cid AND lower(btrim(name)) = lower(btrim(:name))
             LIMIT 1'
        );
        $dupName->execute(['cid' => $companyId, 'name' => $name]);
        if ($dupName->fetchColumn()) {
            Response::error('A department with that name already exists for this company', 422);
            return;
        }

        $baseCode = $code;
        $n = 2;
        while (true) {
            $dupCode = $this->pdo->prepare(
                'SELECT id FROM departments WHERE company_id = :cid AND code = :code LIMIT 1'
            );
            $dupCode->execute(['cid' => $companyId, 'code' => $code]);
            if (! $dupCode->fetchColumn()) {
                break;
            }
            $suffix = '_' . $n;
            $code = substr($baseCode, 0, max(1, 40 - strlen($suffix))) . $suffix;
            $n++;
            if ($n > 50) {
                Response::error('Could not assign a unique department code', 422);
                return;
            }
        }

        try {
            $stmt = $this->pdo->prepare(
                'INSERT INTO departments (company_id, location_id, code, name, is_active)
                 VALUES (:company_id, :location_id, :code, :name, TRUE)
                 RETURNING id, company_id, location_id, code, name'
            );
            $stmt->execute([
                'company_id' => $companyId,
                'location_id' => $locationId > 0 ? $locationId : null,
                'code' => $code,
                'name' => $name,
            ]);
        } catch (\Throwable) {
            Response::error('Could not create department (duplicate code?)', 422);
            return;
        }

        Response::json(['data' => $stmt->fetch()], 201);
    }

    public function storeSupplier(Request $request, array $user): void
    {
        if (! $this->canManageOrg($user)) {
            Response::error('Not allowed to manage suppliers', 403);
            return;
        }

        $companyId = (int) $request->input('company_id', $user['company_id']);
        Auth::assertCompanyAccess($user, $companyId);
        $name = trim((string) $request->input('name', ''));
        if ($name === '') {
            Response::error('name is required', 422);
            return;
        }

        try {
            $stmt = $this->pdo->prepare(
                'INSERT INTO suppliers (company_id, name, contact_person, phone, email, is_active)
                 VALUES (:company_id, :name, :contact_person, :phone, :email, TRUE)
                 RETURNING id, company_id, name, contact_person, phone, email'
            );
            $stmt->execute([
                'company_id' => $companyId,
                'name' => $name,
                'contact_person' => $request->input('contact_person') ?: null,
                'phone' => $request->input('phone') ?: null,
                'email' => $request->input('email') ?: null,
            ]);
        } catch (\Throwable) {
            Response::error('Could not create supplier', 422);
            return;
        }

        Response::json(['data' => $stmt->fetch()], 201);
    }

    /** @param array<string, mixed> $user */
    private function canManageOrg(array $user): bool
    {
        return in_array($user['role'] ?? '', ['super_admin', 'it_admin', 'it_staff'], true);
    }

    /** Single round-trip for companies + locations + departments. */
    public function org(array $user, ?Request $request = null): void
    {
        $isSuper = ($user['role'] ?? '') === 'super_admin';
        $companyId = null;
        if (! $isSuper) {
            $companyId = (int) $user['company_id'];
        } elseif ($request !== null && $request->input('company_id')) {
            $companyId = (int) $request->input('company_id');
        }

        if ($isSuper && $companyId === null) {
            $companies = $this->pdo->query(
                'SELECT id, code, name, short_name FROM companies WHERE is_active = TRUE ORDER BY id'
            )->fetchAll();
            $locations = $this->pdo->query(
                'SELECT id, company_id, code, name, city FROM locations WHERE is_active = TRUE ORDER BY company_id, name'
            )->fetchAll();
            $departments = $this->pdo->query(
                'SELECT id, company_id, location_id, code, name FROM departments WHERE is_active = TRUE ORDER BY company_id, name'
            )->fetchAll();
        } else {
            $cStmt = $this->pdo->prepare(
                'SELECT id, code, name, short_name FROM companies WHERE is_active = TRUE'
                . ($isSuper ? '' : ' AND id = :c')
                . ' ORDER BY id'
            );
            $cStmt->execute($isSuper ? [] : ['c' => $companyId]);
            $companies = $cStmt->fetchAll();

            $lStmt = $this->pdo->prepare(
                'SELECT id, company_id, code, name, city FROM locations WHERE is_active = TRUE AND company_id = :c ORDER BY name'
            );
            $lStmt->execute(['c' => $companyId]);
            $locations = $lStmt->fetchAll();

            $dStmt = $this->pdo->prepare(
                'SELECT id, company_id, location_id, code, name FROM departments WHERE is_active = TRUE AND company_id = :c ORDER BY name'
            );
            $dStmt->execute(['c' => $companyId]);
            $departments = $dStmt->fetchAll();
        }

        Response::json([
            'companies' => $companies,
            'locations' => $locations,
            'departments' => $departments,
        ]);
    }
}
