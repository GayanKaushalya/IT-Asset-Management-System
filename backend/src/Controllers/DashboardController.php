<?php

declare(strict_types=1);

namespace Indra\Itam\Controllers;

use Indra\Itam\Http\Request;
use Indra\Itam\Http\Response;
use PDO;

final class DashboardController
{
    public function __construct(private readonly PDO $pdo)
    {
    }

    public function index(Request $request, array $user): void
    {
        $companyId = $request->input('company_id');
        $companyId = $companyId !== null && $companyId !== '' ? (int) $companyId : null;

        if (($user['role'] ?? '') !== 'super_admin') {
            $companyId = (int) $user['company_id'];
        }

        // One pass over base tables instead of many v_assets scans
        $companyFilter = $companyId !== null ? ' AND company_id = :company_id' : '';
        $params = $companyId !== null ? ['company_id' => $companyId] : [];

        $summarySql = "SELECT
            COUNT(*) FILTER (WHERE status <> 'disposed') AS total_assets,
            COALESCE(SUM(purchase_amount_lkr) FILTER (WHERE status <> 'disposed'), 0) AS total_value,
            COUNT(*) FILTER (WHERE status = 'deployed') AS assigned,
            COUNT(*) FILTER (WHERE status = 'available') AS available,
            COUNT(*) FILTER (WHERE status = 'under_repair') AS maintenance,
            COUNT(*) FILTER (WHERE status = 'lost') AS lost,
            COUNT(*) FILTER (WHERE category = 'laptop' AND status <> 'disposed') AS laptops,
            COUNT(*) FILTER (WHERE category = 'mobile_phone' AND status <> 'disposed') AS mobiles,
            COUNT(*) FILTER (WHERE category = 'pc' AND status <> 'disposed') AS pcs,
            COUNT(*) FILTER (WHERE category = 'other' AND status <> 'disposed') AS others
         FROM (
            SELECT company_id, status, purchase_amount_lkr, 'laptop'::text AS category FROM laptops
            UNION ALL
            SELECT company_id, status, purchase_amount_lkr, 'mobile_phone' FROM mobile_phones
            UNION ALL
            SELECT company_id, status, purchase_amount_lkr, 'pc' FROM pcs
            UNION ALL
            SELECT company_id, status, purchase_amount_lkr, 'printer' FROM printers
            UNION ALL
            SELECT company_id, status, purchase_amount_lkr, 'other' FROM other_assets
         ) a
         WHERE TRUE {$companyFilter}";
        $summaryStmt = $this->pdo->prepare($summarySql);
        $summaryStmt->execute($params);
        $summary = $summaryStmt->fetch() ?: [];

        $warrantyDays = (int) ($request->input('warranty_days') ?: 90);
        $warrantyDue = $this->countWarrantyDue($companyId, $warrantyDays);

        $byCompanySql = "SELECT * FROM v_dashboard_assets_by_company WHERE code <> 'FOTON'";
        $byCompanyParams = [];
        if ($companyId !== null) {
            $byCompanySql .= ' AND company_id = :company_id';
            $byCompanyParams['company_id'] = $companyId;
        }
        $byCompanyStmt = $this->pdo->prepare($byCompanySql);
        $byCompanyStmt->execute($byCompanyParams);

        $byStatusSql = 'SELECT status, SUM(asset_count) AS asset_count
                        FROM v_dashboard_assets_by_status';
        $byStatusParams = [];
        if ($companyId !== null) {
            $byStatusSql .= ' WHERE company_id = :company_id';
            $byStatusParams['company_id'] = $companyId;
        }
        $byStatusSql .= ' GROUP BY status ORDER BY status';
        $byStatusStmt = $this->pdo->prepare($byStatusSql);
        $byStatusStmt->execute($byStatusParams);

        $laptops = (int) ($summary['laptops'] ?? 0);
        $mobiles = (int) ($summary['mobiles'] ?? 0);
        $pcs = (int) ($summary['pcs'] ?? 0);
        $others = (int) ($summary['others'] ?? 0);

        Response::json([
            'stats' => [
                'totalAssets' => (int) ($summary['total_assets'] ?? 0),
                'totalValueLkr' => (float) ($summary['total_value'] ?? 0),
                'assignedAssets' => (int) ($summary['assigned'] ?? 0),
                'availableAssets' => (int) ($summary['available'] ?? 0),
                'maintenanceAssets' => (int) ($summary['maintenance'] ?? 0),
                'lostAssets' => (int) ($summary['lost'] ?? 0),
                'totalLaptops' => $laptops,
                'totalMobilePhones' => $mobiles,
                'totalPcs' => $pcs,
                'totalOtherAssets' => $others,
                'warrantyDueCount' => $warrantyDue,
                'totalUsers' => 0,
                'totalLocations' => 0,
                'totalSuppliers' => 0,
                'totalCredentials' => 0,
            ],
            'assetsByCompany' => $byCompanyStmt->fetchAll(),
            'assetsByStatus' => array_map(static function (array $row): array {
                return [
                    'status' => $row['status'],
                    'label' => match ((string) $row['status']) {
                        'available' => 'Available',
                        'deployed' => 'Deployed',
                        'under_repair' => 'Under repair',
                        'lost' => 'Lost / stolen',
                        'disposed' => 'Disposed',
                        default => (string) $row['status'],
                    },
                    'count' => (int) ($row['asset_count'] ?? $row['count'] ?? 0),
                    'asset_count' => (int) ($row['asset_count'] ?? $row['count'] ?? 0),
                ];
            }, $byStatusStmt->fetchAll()),
            'assetsByType' => [
                ['category' => 'laptop', 'label' => 'Laptops', 'count' => $laptops],
                ['category' => 'mobile_phone', 'label' => 'Mobile Phones', 'count' => $mobiles],
                ['category' => 'pc', 'label' => 'Desktop PCs', 'count' => $pcs],
                ['category' => 'other', 'label' => 'Other assets', 'count' => $others],
            ],
            'upcomingWarranties' => $this->upcomingWarranties($companyId, $warrantyDays),
            'recentActivity' => $this->recentStatusActivity($companyId),
            'warrantyDays' => $warrantyDays,
        ]);
    }

    private function countWarrantyDue(?int $companyId, int $days): int
    {
        $days = max(7, min(365, $days));
        $sql = "SELECT COUNT(*) FROM v_assets a
                WHERE a.warranty_expires_on IS NOT NULL
                  AND a.status::text NOT IN ('disposed', 'lost')
                  AND a.warranty_expires_on <= CURRENT_DATE + (:days * INTERVAL '1 day')";
        $params = ['days' => $days];
        if ($companyId !== null) {
            $sql .= ' AND a.company_id = :company_id';
            $params['company_id'] = $companyId;
        }
        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            return (int) $stmt->fetchColumn();
        } catch (\Throwable) {
            return 0;
        }
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function upcomingWarranties(?int $companyId, int $days): array
    {
        $days = max(7, min(365, $days));
        $sql = "SELECT a.id, a.asset_tag, a.pc_name, a.category,
                       c.short_name AS company,
                       a.warranty_expires_on,
                       (a.warranty_expires_on - CURRENT_DATE) AS days_remaining
                FROM v_assets a
                JOIN companies c ON c.id = a.company_id
                WHERE a.warranty_expires_on IS NOT NULL
                  AND a.status::text NOT IN ('disposed', 'lost')
                  AND a.warranty_expires_on <= CURRENT_DATE + (:days * INTERVAL '1 day')
                ORDER BY a.warranty_expires_on ASC
                LIMIT 40";
        $params = ['days' => $days];
        if ($companyId !== null) {
            $sql = str_replace(
                'WHERE a.warranty_expires_on IS NOT NULL',
                'WHERE a.company_id = :company_id AND a.warranty_expires_on IS NOT NULL',
                $sql
            );
            $params['company_id'] = $companyId;
        }
        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
            return array_map(static function (array $row): array {
                return [
                    'id' => (int) $row['id'],
                    'asset_tag' => $row['asset_tag'],
                    'pc_name' => $row['pc_name'],
                    'company' => $row['company'],
                    'category' => $row['category'],
                    'warranty_expires_on' => $row['warranty_expires_on'],
                    'days_remaining' => (int) $row['days_remaining'],
                ];
            }, $stmt->fetchAll(PDO::FETCH_ASSOC));
        } catch (\Throwable) {
            return [];
        }
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function recentStatusActivity(?int $companyId): array
    {
        $sql = 'SELECT id, asset_type, asset_id, from_status, to_status, note, created_at
                FROM asset_status_history';
        $params = [];
        if ($companyId !== null) {
            $sql .= ' WHERE company_id = :cid';
            $params['cid'] = $companyId;
        }
        $sql .= ' ORDER BY created_at DESC LIMIT 12';
        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute($params);
        } catch (\Throwable) {
            return [];
        }
        $out = [];
        foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
            $to = (string) $row['to_status'];
            $out[] = [
                'id' => 'ash-' . $row['id'],
                'title' => 'Status → ' . str_replace('_', ' ', $to),
                'description' => trim(($row['asset_type'] ?? '') . ' #' . ($row['asset_id'] ?? '') . ' ' . ($row['note'] ?? '')),
                'time' => $row['created_at'],
                'tone' => match ($to) {
                    'available' => 'success',
                    'under_repair', 'lost' => 'warning',
                    'disposed' => 'security',
                    default => 'primary',
                },
            ];
        }
        return $out;
    }

    /**
     * @return array<string, int>
     */
    private function statusCounts(?int $companyId): array
    {
        $sql = 'SELECT status, COUNT(*) AS n FROM v_assets';
        $params = [];
        if ($companyId !== null) {
            $sql .= ' WHERE company_id = :c';
            $params['c'] = $companyId;
        }
        $sql .= ' GROUP BY status';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $out = [];
        foreach ($stmt->fetchAll() as $row) {
            $out[(string) $row['status']] = (int) $row['n'];
        }
        return $out;
    }

    private function countTable(string $table, ?int $companyId): int
    {
        $allowed = ['users', 'locations', 'credentials', 'email_accounts'];
        if (! in_array($table, $allowed, true)) {
            return 0;
        }
        $sql = "SELECT COUNT(*) FROM {$table}";
        $params = [];
        if ($companyId !== null && $table !== 'users') {
            $sql .= ' WHERE company_id = :c';
            $params['c'] = $companyId;
        } elseif ($companyId !== null && $table === 'users') {
            $sql .= ' WHERE company_id = :c AND is_active = TRUE';
            $params['c'] = $companyId;
        } elseif ($table === 'users') {
            $sql .= ' WHERE is_active = TRUE';
        }
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        return (int) $stmt->fetchColumn();
    }

    private function countSuppliers(?int $companyId): int
    {
        $sql = 'SELECT COUNT(*) FROM suppliers WHERE is_active = TRUE';
        $params = [];
        if ($companyId !== null) {
            $sql .= ' AND (company_id = :c OR company_id IS NULL)';
            $params['c'] = $companyId;
        }
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        return (int) $stmt->fetchColumn();
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function recentActivity(?int $companyId): array
    {
        $items = [];

        $hSql = 'SELECT h.id, h.assigned_person_name, h.handover_date, h.asset_type, h.asset_id, h.is_open, h.created_at
                 FROM asset_handovers h';
        $hParams = [];
        if ($companyId !== null) {
            $hSql .= ' WHERE h.company_id = :c';
            $hParams['c'] = $companyId;
        }
        $hSql .= ' ORDER BY h.created_at DESC LIMIT 8';
        $hStmt = $this->pdo->prepare($hSql);
        $hStmt->execute($hParams);
        foreach ($hStmt->fetchAll() as $row) {
            $open = (bool) $row['is_open'];
            $items[] = [
                'id' => 'h-' . $row['id'],
                'title' => $open ? 'Asset assigned' : 'Asset returned',
                'description' => sprintf(
                    '%s · %s #%s',
                    (string) ($row['assigned_person_name'] ?? 'Unknown'),
                    (string) $row['asset_type'],
                    (string) $row['asset_id']
                ),
                'user' => (string) ($row['assigned_person_name'] ?? ''),
                'time' => (string) ($row['created_at'] ?? $row['handover_date'] ?? ''),
                'tone' => $open ? 'success' : 'primary',
                'sort' => strtotime((string) ($row['created_at'] ?? 'now')) ?: 0,
            ];
        }

        try {
            $cSql = 'SELECT l.id, l.action, l.created_at, u.name AS user_name
                     FROM credential_access_logs l
                     JOIN credentials c ON c.id = l.credential_id
                     LEFT JOIN users u ON u.id = l.accessed_by';
            $cParams = [];
            if ($companyId !== null) {
                $cSql .= ' WHERE c.company_id = :c';
                $cParams['c'] = $companyId;
            }
            $cSql .= ' ORDER BY l.created_at DESC LIMIT 5';
            $cStmt = $this->pdo->prepare($cSql);
            $cStmt->execute($cParams);
            foreach ($cStmt->fetchAll() as $row) {
                $items[] = [
                    'id' => 'c-' . $row['id'],
                    'title' => 'Credential accessed',
                    'description' => (string) ($row['action'] ?? 'reveal'),
                    'user' => (string) ($row['user_name'] ?? 'IT Staff'),
                    'time' => (string) ($row['created_at'] ?? ''),
                    'tone' => 'security',
                    'sort' => strtotime((string) ($row['created_at'] ?? 'now')) ?: 0,
                ];
            }
        } catch (\Throwable) {
            // Table may be empty / unavailable — keep handover activity only.
        }

        usort($items, static fn ($a, $b) => ($b['sort'] ?? 0) <=> ($a['sort'] ?? 0));
        $items = array_slice($items, 0, 10);
        foreach ($items as &$item) {
            unset($item['sort']);
        }
        unset($item);

        return $items;
    }
}
