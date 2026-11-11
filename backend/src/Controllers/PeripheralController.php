<?php

declare(strict_types=1);

namespace Indra\Itam\Controllers;

use Indra\Itam\Http\Request;
use Indra\Itam\Http\Response;
use Indra\Itam\Support\Auth;
use PDO;

/**
 * Peripherals inventory — keyboards, mice, cables, adapters only.
 */
final class PeripheralController
{
    private const KINDS = ['keyboard', 'mouse', 'cable', 'adapter'];

    private const COLUMNS = [
        'company_id', 'location_id', 'department_id', 'supplier_id', 'asset_tag', 'peripheral_kind',
        'user_name', 'item_name', 'serial_number', 'brand', 'model', 'status',
        'invoice_no', 'purchase_amount_lkr', 'purchase_date', 'warranty_period', 'warranty_expires_on',
        'specification', 'notes', 'handover_date', 'created_by', 'updated_by',
    ];

    public function __construct(private readonly PDO $pdo)
    {
    }

    public function index(Request $request, array $user): void
    {
        $where = ['1=1'];
        $params = [];

        if (($user['role'] ?? '') !== 'super_admin') {
            $where[] = 'p.company_id = :company_id';
            $params['company_id'] = (int) $user['company_id'];
        } elseif ($request->input('company_id')) {
            $where[] = 'p.company_id = :company_id';
            $params['company_id'] = (int) $request->input('company_id');
        } elseif ($request->input('company_code')) {
            $where[] = 'c.code = :company_code';
            $params['company_code'] = strtoupper((string) $request->input('company_code'));
        }

        if ($kind = trim((string) $request->input('kind', ''))) {
            if (! in_array($kind, self::KINDS, true)) {
                Response::error('Invalid peripheral kind', 422);
                return;
            }
            $where[] = 'p.peripheral_kind = :kind';
            $params['kind'] = $kind;
        }

        if ($request->input('location_id')) {
            $where[] = 'p.location_id = :location_id';
            $params['location_id'] = (int) $request->input('location_id');
        }

        if ($q = trim((string) $request->input('q', ''))) {
            $where[] = '(p.asset_tag ILIKE :q OR p.user_name ILIKE :q OR p.item_name ILIKE :q
                       OR p.serial_number ILIKE :q OR p.brand ILIKE :q OR p.model ILIKE :q)';
            $params['q'] = '%' . $q . '%';
        }

        $allowedLimits = [10, 20, 50, 100, 500];
        $limit = (int) $request->input('limit', 50);
        if (! in_array($limit, $allowedLimits, true)) {
            $limit = 50;
        }
        $page = max(1, (int) $request->input('page', 1));
        $offset = ($page - 1) * $limit;
        $whereSql = implode(' AND ', $where);

        $sql = "SELECT filtered.*, COUNT(*) OVER() AS _total_count
                FROM (
                    SELECT p.id, p.asset_tag, p.peripheral_kind, p.user_name, p.item_name,
                           p.serial_number, p.brand, p.model, p.status, p.invoice_no,
                           p.purchase_amount_lkr, p.purchase_date, p.warranty_period,
                           p.warranty_expires_on, p.specification, p.notes, p.handover_date,
                           p.company_id, p.location_id, p.department_id, p.supplier_id,
                           c.code AS company_code, c.short_name AS company_short,
                           d.name AS department_name, l.name AS location_name, s.name AS supplier_name
                    FROM peripherals p
                    JOIN companies c ON c.id = p.company_id
                    LEFT JOIN departments d ON d.id = p.department_id
                    LEFT JOIN locations l ON l.id = p.location_id
                    LEFT JOIN suppliers s ON s.id = p.supplier_id
                    WHERE {$whereSql}
                ) AS filtered
                ORDER BY filtered.id ASC
                LIMIT {$limit} OFFSET {$offset}";

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        $total = $rows === [] ? 0 : (int) ($rows[0]['_total_count'] ?? 0);
        foreach ($rows as &$row) {
            unset($row['_total_count']);
        }
        unset($row);

        $pages = $total === 0 ? 1 : max(1, (int) ceil($total / $limit));
        if ($total > 0 && $page > $pages) {
            $page = $pages;
            $offset = ($page - 1) * $limit;
            $sql = preg_replace('/OFFSET \d+/', 'OFFSET ' . $offset, $sql) ?? $sql;
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            $rows = $stmt->fetchAll();
            $total = $rows === [] ? 0 : (int) ($rows[0]['_total_count'] ?? 0);
            foreach ($rows as &$row) {
                unset($row['_total_count']);
            }
            unset($row);
            $pages = max(1, (int) ceil($total / $limit));
        }

        Response::json([
            'data' => $rows,
            'meta' => [
                'total' => $total,
                'page' => $page,
                'limit' => $limit,
                'pages' => $pages,
            ],
        ]);
    }

    public function show(Request $request, array $user, array $params): void
    {
        $id = (int) ($params['id'] ?? 0);
        $row = $this->find($id);
        if ($row === null) {
            Response::error('Peripheral not found', 404);
            return;
        }
        Auth::assertCompanyAccess($user, (int) $row['company_id']);
        Response::json(['data' => $row]);
    }

    public function store(Request $request, array $user): void
    {
        $companyId = (int) $request->input('company_id', $user['company_id']);
        Auth::assertCompanyAccess($user, $companyId);

        $kind = strtolower(trim((string) $request->input('peripheral_kind', $request->input('kind', ''))));
        if (! in_array($kind, self::KINDS, true)) {
            Response::error('peripheral_kind must be keyboard, mouse, cable, or adapter', 422);
            return;
        }

        $supplierId = $this->resolveSupplierId($companyId, $request);
        $tag = $this->nextTag($companyId);
        $payload = $this->buildPayload($request, $user, $companyId, $supplierId, $tag, $kind);

        $columns = array_values(array_filter(
            self::COLUMNS,
            static fn (string $col) => array_key_exists($col, $payload)
        ));
        $sql = sprintf(
            'INSERT INTO peripherals (%s) VALUES (%s) RETURNING *',
            implode(', ', $columns),
            implode(', ', array_map(static fn (string $c) => ':' . $c, $columns))
        );
        $bind = [];
        foreach ($columns as $col) {
            $bind[$col] = $payload[$col];
        }

        $stmt = $this->pdo->prepare($sql);
        try {
            $stmt->execute($bind);
        } catch (\Throwable) {
            $bind['asset_tag'] = $this->nextTag($companyId);
            $stmt->execute($bind);
        }
        $row = $stmt->fetch();
        Response::json(['data' => $row], 201);
    }

    public function update(Request $request, array $user, array $params): void
    {
        $id = (int) ($params['id'] ?? 0);
        $row = $this->find($id);
        if ($row === null) {
            Response::error('Peripheral not found', 404);
            return;
        }
        Auth::assertCompanyAccess($user, (int) $row['company_id']);

        $body = $request->body;
        if (array_key_exists('name', $body) && ! array_key_exists('user_name', $body)) {
            $body['user_name'] = $body['name'];
        }
        if (array_key_exists('item', $body) && ! array_key_exists('item_name', $body)) {
            $body['item_name'] = $body['item'];
        }
        if (array_key_exists('remark', $body) && ! array_key_exists('notes', $body)) {
            $body['notes'] = $body['remark'];
        }
        if (array_key_exists('amount', $body) && ! array_key_exists('purchase_amount_lkr', $body)) {
            $body['purchase_amount_lkr'] = $body['amount'];
        }
        if (array_key_exists('kind', $body) && ! array_key_exists('peripheral_kind', $body)) {
            $body['peripheral_kind'] = $body['kind'];
        }
        if (array_key_exists('supplier', $body) || array_key_exists('supplier_name', $body)) {
            $body['supplier_id'] = $this->resolveSupplierId((int) $row['company_id'], $request);
        }

        $sets = ['updated_by = :updated_by', 'updated_at = NOW()'];
        $bind = ['id' => $id, 'updated_by' => $user['id']];
        $skip = ['created_by', 'asset_tag', 'company_id'];

        foreach (self::COLUMNS as $f) {
            if (in_array($f, $skip, true) || ! array_key_exists($f, $body)) {
                continue;
            }
            if ($f === 'peripheral_kind') {
                $kind = strtolower(trim((string) $body[$f]));
                if (! in_array($kind, self::KINDS, true)) {
                    Response::error('peripheral_kind must be keyboard, mouse, cable, or adapter', 422);
                    return;
                }
                $body[$f] = $kind;
            }
            $sets[] = "{$f} = :{$f}";
            $val = $body[$f];
            if (in_array($f, ['location_id', 'department_id', 'supplier_id', 'purchase_amount_lkr'], true)) {
                $val = ($val === '' || $val === null) ? null : $val;
            }
            $bind[$f] = $val === '' ? null : $val;
        }

        try {
            $stmt = $this->pdo->prepare(
                'UPDATE peripherals SET ' . implode(', ', $sets) . ' WHERE id = :id RETURNING *'
            );
            $stmt->execute($bind);
            $updated = $stmt->fetch();
        } catch (\Throwable $e) {
            Response::error('Could not update peripheral: ' . $e->getMessage(), 422);
            return;
        }

        Response::json(['data' => $updated ?: $this->find($id)]);
    }

    public function destroy(Request $request, array $user, array $params): void
    {
        $id = (int) ($params['id'] ?? 0);
        $row = $this->find($id);
        if ($row === null) {
            Response::error('Peripheral not found', 404);
            return;
        }
        Auth::assertCompanyAccess($user, (int) $row['company_id']);
        $this->pdo->prepare('DELETE FROM peripherals WHERE id = :id')->execute(['id' => $id]);
        Response::json(['ok' => true]);
    }

    /** @return array<string, mixed>|null */
    private function find(int $id): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT p.*, c.code AS company_code, c.short_name AS company_short,
                    d.name AS department_name, l.name AS location_name, s.name AS supplier_name
             FROM peripherals p
             JOIN companies c ON c.id = p.company_id
             LEFT JOIN departments d ON d.id = p.department_id
             LEFT JOIN locations l ON l.id = p.location_id
             LEFT JOIN suppliers s ON s.id = p.supplier_id
             WHERE p.id = :id
             LIMIT 1'
        );
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    private function nextTag(int $companyId): string
    {
        $maxStmt = $this->pdo->prepare(
            "SELECT COALESCE(MAX(
                CAST(NULLIF(substring(asset_tag from '([0-9]+)$'), '') AS INTEGER)
             ), 0)
             FROM peripherals
             WHERE company_id = :company_id"
        );
        $maxStmt->execute(['company_id' => $companyId]);
        return sprintf('%03d', ((int) $maxStmt->fetchColumn()) + 1);
    }

    private function resolveSupplierId(int $companyId, Request $request): ?int
    {
        if ($request->input('supplier_id')) {
            return (int) $request->input('supplier_id');
        }
        $name = trim((string) ($request->input('supplier_name') ?: $request->input('supplier') ?: ''));
        if ($name === '') {
            return null;
        }
        $find = $this->pdo->prepare(
            'SELECT id FROM suppliers WHERE company_id = :c AND lower(name) = lower(:n) LIMIT 1'
        );
        $find->execute(['c' => $companyId, 'n' => $name]);
        $id = $find->fetchColumn();
        if ($id) {
            return (int) $id;
        }
        $ins = $this->pdo->prepare(
            'INSERT INTO suppliers (company_id, name, is_active) VALUES (:c, :n, TRUE) RETURNING id'
        );
        $ins->execute(['c' => $companyId, 'n' => $name]);
        return (int) $ins->fetchColumn();
    }

    /**
     * @param array<string, mixed> $user
     * @return array<string, mixed>
     */
    private function buildPayload(
        Request $request,
        array $user,
        int $companyId,
        ?int $supplierId,
        string $tag,
        string $kind
    ): array {
        $userName = $request->input('user_name') ?: $request->input('name') ?: null;
        return [
            'company_id' => $companyId,
            'location_id' => $request->input('location_id') ?: null,
            'department_id' => $request->input('department_id') ?: null,
            'supplier_id' => $supplierId,
            'asset_tag' => $tag,
            'peripheral_kind' => $kind,
            'user_name' => $userName,
            'item_name' => $request->input('item_name') ?: $request->input('item') ?: null,
            'serial_number' => $request->input('serial_number') ?: null,
            'brand' => $request->input('brand') ?: null,
            'model' => $request->input('model') ?: null,
            'status' => $request->input('status') ?: 'available',
            'invoice_no' => $request->input('invoice_no') ?: null,
            'purchase_amount_lkr' => $request->input('purchase_amount_lkr') ?: $request->input('amount') ?: null,
            'purchase_date' => $request->input('purchase_date') ?: $request->input('date') ?: null,
            'warranty_period' => $request->input('warranty_period') ?: null,
            'warranty_expires_on' => $request->input('warranty_expires_on') ?: $request->input('warranty') ?: null,
            'specification' => $request->input('specification') ?: null,
            'notes' => $request->input('notes') ?: $request->input('other') ?: $request->input('remark') ?: null,
            'handover_date' => $request->input('handover_date') ?: null,
            'created_by' => $user['id'],
            'updated_by' => $user['id'],
        ];
    }
}
