<?php

declare(strict_types=1);

namespace Indra\Itam\Controllers;

use Indra\Itam\Http\Request;
use Indra\Itam\Http\Response;
use Indra\Itam\Support\Auth;
use PDO;

/**
 * PC kit: assign / replace components (SSD, mouse, keyboard, UPS, …) with history.
 */
final class PcKitController
{
    private const KINDS = [
        'ssd', 'hdd', 'mouse', 'keyboard', 'ups', 'monitor', 'power_cable', 'vga_cable',
    ];

    public function __construct(private readonly PDO $pdo)
    {
    }

    /** GET /api/assets/pc/{id}/kit */
    public function index(Request $request, array $user, string $id): void
    {
        $this->ensureTable();
        $pc = $this->findPc((int) $id);
        if ($pc === null) {
            Response::error('PC not found', 404);
            return;
        }
        Auth::assertCompanyAccess($user, (int) $pc['company_id']);

        // Bring checklist / capacity fields on the PC into kit rows so Dispose is available
        $this->syncFromPcFlags((int) $id, $pc);

        $stmt = $this->pdo->prepare(
            'SELECT k.*,
                    cu.name AS created_by_name,
                    ru.name AS replaced_by_name
             FROM pc_kit_components k
             LEFT JOIN users cu ON cu.id = k.created_by
             LEFT JOIN users ru ON ru.id = k.replaced_by
             WHERE k.pc_id = :pc_id
             ORDER BY k.is_current DESC, k.component_kind ASC, k.created_at DESC'
        );
        $stmt->execute(['pc_id' => (int) $id]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $current = [];
        $history = [];
        foreach ($rows as $row) {
            $enriched = $this->enrich($row);
            if ($this->isTruthy($row['is_current'] ?? false)) {
                $current[] = $enriched;
            } else {
                $history[] = $enriched;
            }
        }

        Response::json([
            'data' => [
                'current' => $current,
                'history' => $history,
            ],
        ]);
    }

    /** POST /api/assets/pc/{id}/kit — install / assign (or replace if same kind already current) */
    public function store(Request $request, array $user, string $id): void
    {
        if (! $this->canManage($user)) {
            Response::error('Only IT staff can manage PC kit', 403);
            return;
        }
        $this->ensureTable();
        $pc = $this->findPc((int) $id);
        if ($pc === null) {
            Response::error('PC not found', 404);
            return;
        }
        Auth::assertCompanyAccess($user, (int) $pc['company_id']);

        $payload = $this->parsePayload($request);
        if (isset($payload['error'])) {
            Response::error($payload['error'], 422);
            return;
        }

        $uid = (int) ($user['id'] ?? 0) ?: null;
        $reason = $this->nullStr($request->input('replace_reason', $request->input('reason', null)));
        $existing = $this->findCurrent((int) $id, $payload['component_kind']);
        $newId = 0;

        $this->pdo->beginTransaction();
        try {
            if ($existing !== null) {
                $this->pdo->prepare(
                    'UPDATE pc_kit_components SET
                        is_current = FALSE,
                        disposition = \'replaced\',
                        replaced_at = NOW(),
                        replaced_by = :uid,
                        replace_reason = COALESCE(:reason, replace_reason),
                        updated_at = NOW()
                     WHERE id = :id'
                )->execute([
                    'uid' => $uid,
                    'reason' => $reason ?? 'Replaced',
                    'id' => (int) $existing['id'],
                ]);
            }

            $stmt = $this->pdo->prepare(
                'INSERT INTO pc_kit_components (
                    pc_id, component_kind, is_current,
                    brand, model, serial_number, capacity_gb,
                    invoice_no, purchase_date, purchase_amount_lkr,
                    warranty_period, warranty_expires_on, notes, created_by
                 ) VALUES (
                    :pc_id, :kind, TRUE,
                    :brand, :model, :serial_number, :capacity_gb,
                    :invoice_no, :purchase_date, :purchase_amount_lkr,
                    :warranty_period, :warranty_expires_on, :notes, :uid
                 ) RETURNING id'
            );
            $stmt->execute([
                'pc_id' => (int) $id,
                'kind' => $payload['component_kind'],
                'brand' => $payload['brand'],
                'model' => $payload['model'],
                'serial_number' => $payload['serial_number'],
                'capacity_gb' => $payload['capacity_gb'],
                'invoice_no' => $payload['invoice_no'],
                'purchase_date' => $payload['purchase_date'],
                'purchase_amount_lkr' => $payload['purchase_amount_lkr'],
                'warranty_period' => $payload['warranty_period'],
                'warranty_expires_on' => $payload['warranty_expires_on'],
                'notes' => $payload['notes'],
                'uid' => $uid,
            ]);
            $newId = (int) $stmt->fetchColumn();

            $this->mirrorPcFlags((int) $id, $payload['component_kind'], $payload, true);
            $this->pdo->commit();
        } catch (\Throwable $e) {
            $this->pdo->rollBack();
            Response::error('Could not save kit component: ' . $e->getMessage(), 500);
            return;
        }

        $row = $this->findById($newId);
        Response::json([
            'data' => $this->enrich($row ?? []),
            'message' => $existing !== null ? 'Component replaced' : 'Component assigned',
        ], 201);
    }

    /** POST /api/assets/pc/{id}/kit/{kitId}/retire — remove current without replacement */
    public function retire(Request $request, array $user, string $id, string $kitId): void
    {
        if (! $this->canManage($user)) {
            Response::error('Only IT staff can manage PC kit', 403);
            return;
        }
        $this->ensureTable();
        $pc = $this->findPc((int) $id);
        if ($pc === null) {
            Response::error('PC not found', 404);
            return;
        }
        Auth::assertCompanyAccess($user, (int) $pc['company_id']);

        $row = $this->findById((int) $kitId);
        if ($row === null || (int) $row['pc_id'] !== (int) $id) {
            Response::error('Kit component not found', 404);
            return;
        }
        $cur = $row['is_current'] ?? false;
        $isCurrent = $cur === true || $cur === 't' || $cur === 1 || $cur === '1';
        if (! $isCurrent) {
            Response::error('Component is already retired', 422);
            return;
        }

        $uid = (int) ($user['id'] ?? 0) ?: null;
        $disposition = strtolower(trim((string) $request->input('disposition', 'removed')));
        if (! in_array($disposition, ['removed', 'disposed'], true)) {
            $disposition = 'removed';
        }
        $defaultReason = $disposition === 'disposed' ? 'Disposed' : 'Removed from kit';
        $reason = $this->nullStr($request->input('replace_reason', $request->input('reason', $defaultReason)))
            ?? $defaultReason;

        $this->pdo->beginTransaction();
        try {
            $this->pdo->prepare(
                'UPDATE pc_kit_components SET
                    is_current = FALSE,
                    disposition = :disposition,
                    disposed_at = CASE WHEN :disposition2 = \'disposed\' THEN NOW() ELSE disposed_at END,
                    replaced_at = NOW(),
                    replaced_by = :uid,
                    replace_reason = :reason,
                    updated_at = NOW()
                 WHERE id = :id'
            )->execute([
                'disposition' => $disposition,
                'disposition2' => $disposition,
                'uid' => $uid,
                'reason' => $reason,
                'id' => (int) $kitId,
            ]);
            $this->mirrorPcFlags((int) $id, (string) $row['component_kind'], [], false);
            $this->pdo->commit();
        } catch (\Throwable $e) {
            $this->pdo->rollBack();
            Response::error('Could not retire component: ' . $e->getMessage(), 500);
            return;
        }

        Response::json([
            'message' => $disposition === 'disposed' ? 'Component disposed' : 'Component removed from kit',
        ]);
    }

    /** @return array<string, mixed>|null */
    private function findPc(int $id): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, company_id, monitor_brand, has_power_cable, has_vga_cable,
                    has_keyboard, has_mouse, has_ups, ups_brand, ups_model,
                    ups_purchase_date, ups_warranty_period, ups_warranty_expires_on,
                    hdd_gb, ssd_gb
             FROM pcs WHERE id = :id LIMIT 1'
        );
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row === false ? null : $row;
    }

    /**
     * Create / update / drop kit rows so they match PC checklist & capacity fields.
     * Manually assigned parts (with a serial) are not overwritten for brand/model text,
     * except SSD/HDD capacity and UPS purchase fields which mirror the PC form.
     *
     * @param array<string, mixed> $pc
     */
    private function syncFromPcFlags(int $pcId, array $pc): void
    {
        /** @var array<string, array<string, mixed>> $wanted */
        $wanted = [];

        if ($this->isTruthy($pc['has_mouse'] ?? false)) {
            $wanted['mouse'] = ['brand' => null, 'model' => null, 'capacity' => null];
        }
        if ($this->isTruthy($pc['has_keyboard'] ?? false)) {
            $wanted['keyboard'] = ['brand' => null, 'model' => null, 'capacity' => null];
        }
        if ($this->isTruthy($pc['has_power_cable'] ?? false)) {
            $wanted['power_cable'] = ['brand' => null, 'model' => null, 'capacity' => null];
        }
        if ($this->isTruthy($pc['has_vga_cable'] ?? false)) {
            $wanted['vga_cable'] = ['brand' => null, 'model' => null, 'capacity' => null];
        }

        $ssd = is_numeric($pc['ssd_gb'] ?? null) ? (float) $pc['ssd_gb'] : 0.0;
        if ($ssd > 0) {
            $wanted['ssd'] = ['brand' => null, 'model' => null, 'capacity' => $ssd];
        }
        $hdd = is_numeric($pc['hdd_gb'] ?? null) ? (float) $pc['hdd_gb'] : 0.0;
        if ($hdd > 0) {
            $wanted['hdd'] = ['brand' => null, 'model' => null, 'capacity' => $hdd];
        }

        $monitor = trim((string) ($pc['monitor_brand'] ?? ''));
        if ($monitor !== '') {
            $parts = preg_split('/\s+/', $monitor, 2) ?: [$monitor];
            $wanted['monitor'] = [
                'brand' => $parts[0] ?? $monitor,
                'model' => $parts[1] ?? null,
                'capacity' => null,
            ];
        }

        if ($this->isTruthy($pc['has_ups'] ?? false)
            || trim((string) ($pc['ups_brand'] ?? '')) !== ''
            || trim((string) ($pc['ups_model'] ?? '')) !== '') {
            $wanted['ups'] = [
                'brand' => $this->nullStr($pc['ups_brand'] ?? null),
                'model' => $this->nullStr($pc['ups_model'] ?? null) ?? '650',
                'capacity' => null,
                'purchase_date' => $this->nullDate($pc['ups_purchase_date'] ?? null),
                'warranty_period' => $this->nullStr($pc['ups_warranty_period'] ?? null),
                'warranty_expires_on' => $this->nullDate($pc['ups_warranty_expires_on'] ?? null),
            ];
        }

        $ins = $this->pdo->prepare(
            'INSERT INTO pc_kit_components (
                pc_id, component_kind, is_current, brand, model, capacity_gb,
                purchase_date, warranty_period, warranty_expires_on, notes
             ) VALUES (
                :pc_id, :kind, TRUE, :brand, :model, :capacity,
                :purchase_date, :warranty_period, :warranty_expires_on, :notes
             )'
        );
        $upd = $this->pdo->prepare(
            'UPDATE pc_kit_components SET
                brand = COALESCE(:brand, brand),
                model = COALESCE(:model, model),
                capacity_gb = COALESCE(:capacity, capacity_gb),
                purchase_date = COALESCE(:purchase_date, purchase_date),
                warranty_period = COALESCE(:warranty_period, warranty_period),
                warranty_expires_on = COALESCE(:warranty_expires_on, warranty_expires_on),
                updated_at = NOW()
             WHERE id = :id'
        );
        $updForce = $this->pdo->prepare(
            'UPDATE pc_kit_components SET
                brand = :brand,
                model = :model,
                capacity_gb = :capacity,
                purchase_date = :purchase_date,
                warranty_period = :warranty_period,
                warranty_expires_on = :warranty_expires_on,
                updated_at = NOW()
             WHERE id = :id'
        );

        foreach ($wanted as $kind => $c) {
            $existing = $this->findCurrent($pcId, $kind);
            if ($existing === null) {
                try {
                    $ins->execute([
                        'pc_id' => $pcId,
                        'kind' => $kind,
                        'brand' => $c['brand'] ?? null,
                        'model' => $c['model'] ?? null,
                        'capacity' => $c['capacity'] ?? null,
                        'purchase_date' => $c['purchase_date'] ?? null,
                        'warranty_period' => $c['warranty_period'] ?? null,
                        'warranty_expires_on' => $c['warranty_expires_on'] ?? null,
                        'notes' => 'Imported from PC accessories checklist',
                    ]);
                } catch (\Throwable) {
                    // unique current-kind race — ignore
                }
                continue;
            }

            $imported = str_contains((string) ($existing['notes'] ?? ''), 'Imported from PC');
            $noSerial = trim((string) ($existing['serial_number'] ?? '')) === '';

            // Always refresh SSD/HDD capacity from the PC form
            if (in_array($kind, ['ssd', 'hdd'], true) && ($c['capacity'] ?? null) !== null) {
                $this->pdo->prepare(
                    'UPDATE pc_kit_components SET capacity_gb = :capacity, updated_at = NOW() WHERE id = :id'
                )->execute([
                    'capacity' => $c['capacity'],
                    'id' => (int) $existing['id'],
                ]);
            }

            // Imported / no-serial rows stay in sync with Asset details
            if ($imported || $noSerial) {
                if (in_array($kind, ['monitor', 'ups'], true) || $imported) {
                    $updForce->execute([
                        'brand' => $c['brand'] ?? null,
                        'model' => $c['model'] ?? null,
                        'capacity' => $c['capacity'] ?? ($existing['capacity_gb'] ?? null),
                        'purchase_date' => $c['purchase_date'] ?? ($existing['purchase_date'] ?? null),
                        'warranty_period' => $c['warranty_period'] ?? ($existing['warranty_period'] ?? null),
                        'warranty_expires_on' => $c['warranty_expires_on'] ?? ($existing['warranty_expires_on'] ?? null),
                        'id' => (int) $existing['id'],
                    ]);
                } else {
                    $upd->execute([
                        'brand' => $c['brand'] ?? null,
                        'model' => $c['model'] ?? null,
                        'capacity' => $c['capacity'] ?? null,
                        'purchase_date' => $c['purchase_date'] ?? null,
                        'warranty_period' => $c['warranty_period'] ?? null,
                        'warranty_expires_on' => $c['warranty_expires_on'] ?? null,
                        'id' => (int) $existing['id'],
                    ]);
                }
            } elseif ($kind === 'ups') {
                // Keep UPS purchase/warranty mirrored even for manual rows
                $this->pdo->prepare(
                    'UPDATE pc_kit_components SET
                        brand = COALESCE(:brand, brand),
                        model = COALESCE(:model, model),
                        purchase_date = COALESCE(:purchase_date, purchase_date),
                        warranty_period = COALESCE(:warranty_period, warranty_period),
                        warranty_expires_on = COALESCE(:warranty_expires_on, warranty_expires_on),
                        updated_at = NOW()
                     WHERE id = :id'
                )->execute([
                    'brand' => $c['brand'] ?? null,
                    'model' => $c['model'] ?? null,
                    'purchase_date' => $c['purchase_date'] ?? null,
                    'warranty_period' => $c['warranty_period'] ?? null,
                    'warranty_expires_on' => $c['warranty_expires_on'] ?? null,
                    'id' => (int) $existing['id'],
                ]);
            }
        }

        // Drop checklist-only kit rows when the PC flag was turned off in Asset details
        foreach (['mouse', 'keyboard', 'power_cable', 'vga_cable', 'ssd', 'hdd', 'monitor', 'ups'] as $kind) {
            if (isset($wanted[$kind])) {
                continue;
            }
            $existing = $this->findCurrent($pcId, $kind);
            if ($existing === null) {
                continue;
            }
            $imported = str_contains((string) ($existing['notes'] ?? ''), 'Imported from PC');
            $noSerial = trim((string) ($existing['serial_number'] ?? '')) === '';
            if (! $imported && ! $noSerial) {
                // Manually tracked part — leave it; user should Dispose/Remove in Kit
                continue;
            }
            // For storage: only auto-remove when capacity cleared on PC
            if (in_array($kind, ['ssd', 'hdd'], true) && ! $imported && ! $noSerial) {
                continue;
            }
            $this->pdo->prepare(
                'UPDATE pc_kit_components SET
                    is_current = FALSE,
                    disposition = \'removed\',
                    replace_reason = :reason,
                    replaced_at = NOW(),
                    updated_at = NOW()
                 WHERE id = :id'
            )->execute([
                'reason' => 'Cleared on Asset details',
                'id' => (int) $existing['id'],
            ]);
        }
    }

    /** Public entry used after PC asset updates so Kit stays aligned with details. */
    public function syncPc(int $pcId): void
    {
        $this->ensureTable();
        $pc = $this->findPc($pcId);
        if ($pc === null) {
            return;
        }
        $this->syncFromPcFlags($pcId, $pc);
    }

    private function isTruthy(mixed $v): bool
    {
        return $v === true || $v === 1 || $v === '1' || $v === 't' || $v === 'true' || $v === 'yes' || $v === 'on';
    }

    /** @return array<string, mixed>|null */
    private function findCurrent(int $pcId, string $kind): ?array
    {
        $stmt = $this->pdo->prepare(
            'SELECT * FROM pc_kit_components
             WHERE pc_id = :pc_id AND component_kind = :kind AND is_current = TRUE
             LIMIT 1'
        );
        $stmt->execute(['pc_id' => $pcId, 'kind' => $kind]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row === false ? null : $row;
    }

    /** @return array<string, mixed>|null */
    private function findById(int $id): ?array
    {
        $stmt = $this->pdo->prepare('SELECT * FROM pc_kit_components WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row === false ? null : $row;
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function enrich(array $row): array
    {
        if ($row === []) {
            return $row;
        }
        $kind = (string) ($row['component_kind'] ?? '');
        $row['kind_label'] = $this->kindLabel($kind);
        $row['is_current'] = filter_var($row['is_current'] ?? false, FILTER_VALIDATE_BOOLEAN)
            || ($row['is_current'] ?? null) === 't';
        return $row;
    }

    private function kindLabel(string $kind): string
    {
        return match ($kind) {
            'ssd' => 'SSD',
            'hdd' => 'HDD',
            'mouse' => 'Mouse',
            'keyboard' => 'Keyboard',
            'ups' => 'UPS',
            'monitor' => 'Monitor',
            'power_cable' => 'Power cable',
            'vga_cable' => 'VGA / display cable',
            default => $kind,
        };
    }

    /**
     * @return array<string, mixed>
     */
    private function parsePayload(Request $request): array
    {
        $kind = strtolower(trim((string) $request->input('component_kind', $request->input('kind', ''))));
        if (! in_array($kind, self::KINDS, true)) {
            return ['error' => 'component_kind must be one of: ' . implode(', ', self::KINDS)];
        }

        $capacity = null;
        $capRaw = $request->input('capacity_gb', null);
        if ($capRaw !== null && $capRaw !== '') {
            $capacity = (float) $capRaw;
        }
        if (in_array($kind, ['ssd', 'hdd'], true) && ($capacity === null || $capacity <= 0)) {
            return ['error' => 'Capacity (GB) is required for SSD/HDD'];
        }

        $amount = null;
        $amtRaw = $request->input('purchase_amount_lkr', null);
        if ($amtRaw !== null && $amtRaw !== '') {
            $amount = (float) $amtRaw;
        }

        return [
            'component_kind' => $kind,
            'brand' => $this->nullStr($request->input('brand')),
            'model' => $this->nullStr($request->input('model')),
            'serial_number' => $this->nullStr($request->input('serial_number')),
            'capacity_gb' => $capacity,
            'invoice_no' => $this->nullStr($request->input('invoice_no')),
            'purchase_date' => $this->nullDate($request->input('purchase_date')),
            'purchase_amount_lkr' => $amount,
            'warranty_period' => $this->nullStr($request->input('warranty_period')),
            'warranty_expires_on' => $this->nullDate($request->input('warranty_expires_on')),
            'notes' => $this->nullStr($request->input('notes')),
        ];
    }

    /**
     * Keep pcs.* flags / capacities in sync for lists, handovers, and reports.
     *
     * @param array<string, mixed> $payload
     */
    private function mirrorPcFlags(int $pcId, string $kind, array $payload, bool $installed): void
    {
        $sets = [];
        $params = ['id' => $pcId];

        switch ($kind) {
            case 'mouse':
                $sets[] = 'has_mouse = :flag';
                $params['flag'] = $installed;
                break;
            case 'keyboard':
                $sets[] = 'has_keyboard = :flag';
                $params['flag'] = $installed;
                break;
            case 'power_cable':
                $sets[] = 'has_power_cable = :flag';
                $params['flag'] = $installed;
                break;
            case 'vga_cable':
                $sets[] = 'has_vga_cable = :flag';
                $params['flag'] = $installed;
                break;
            case 'ssd':
                if ($installed) {
                    $sets[] = 'ssd_gb = :cap';
                    $params['cap'] = $payload['capacity_gb'] ?? null;
                } else {
                    $sets[] = 'ssd_gb = NULL';
                }
                break;
            case 'hdd':
                if ($installed) {
                    $sets[] = 'hdd_gb = :cap';
                    $params['cap'] = $payload['capacity_gb'] ?? null;
                } else {
                    $sets[] = 'hdd_gb = NULL';
                }
                break;
            case 'ups':
                $sets[] = 'has_ups = :flag';
                $params['flag'] = $installed;
                if ($installed) {
                    $sets[] = 'ups_brand = :brand';
                    $sets[] = 'ups_model = :model';
                    $sets[] = 'ups_purchase_date = :pdate';
                    $sets[] = 'ups_warranty_period = :wperiod';
                    $sets[] = 'ups_warranty_expires_on = :wexp';
                    $params['brand'] = $payload['brand'] ?? null;
                    $params['model'] = $payload['model'] ?? '650';
                    $params['pdate'] = $payload['purchase_date'] ?? null;
                    $params['wperiod'] = $payload['warranty_period'] ?? null;
                    $params['wexp'] = $payload['warranty_expires_on'] ?? null;
                } else {
                    $sets[] = 'ups_brand = NULL';
                    $sets[] = 'ups_model = NULL';
                    $sets[] = 'ups_purchase_date = NULL';
                    $sets[] = 'ups_warranty_period = NULL';
                    $sets[] = 'ups_warranty_expires_on = NULL';
                }
                break;
            case 'monitor':
                if ($installed) {
                    $brand = trim((string) ($payload['brand'] ?? ''));
                    $model = trim((string) ($payload['model'] ?? ''));
                    $label = trim($brand . ($model !== '' ? ' ' . $model : ''));
                    $sets[] = 'monitor_brand = :monitor';
                    $params['monitor'] = $label !== '' ? $label : null;
                } else {
                    $sets[] = 'monitor_brand = NULL';
                }
                break;
        }

        if ($sets === []) {
            return;
        }

        // Refresh combined storage when HDD/SSD change
        if (in_array($kind, ['ssd', 'hdd'], true)) {
            $sets[] = 'storage_gb = COALESCE(hdd_gb, 0) + COALESCE(ssd_gb, 0)';
            $sets[] = "storage_type = CASE
                WHEN COALESCE(hdd_gb, 0) > 0 AND COALESCE(ssd_gb, 0) > 0 THEN 'hybrid'
                WHEN COALESCE(ssd_gb, 0) > 0 THEN 'ssd'
                WHEN COALESCE(hdd_gb, 0) > 0 THEN 'hdd'
                ELSE storage_type
            END";
        }

        $sets[] = 'updated_at = NOW()';
        $sql = 'UPDATE pcs SET ' . implode(', ', $sets) . ' WHERE id = :id';
        $this->pdo->prepare($sql)->execute($params);
    }

    private function nullStr(mixed $v): ?string
    {
        if ($v === null) {
            return null;
        }
        $s = trim((string) $v);
        return $s === '' ? null : $s;
    }

    private function nullDate(mixed $v): ?string
    {
        if ($v === null || $v === '') {
            return null;
        }
        $s = substr(trim((string) $v), 0, 10);
        return $s === '' ? null : $s;
    }

    private function canManage(array $user): bool
    {
        return in_array($user['role'] ?? '', ['super_admin', 'it_admin', 'it_staff'], true);
    }

    private function ensureTable(): void
    {
        static $ready = false;
        if ($ready) {
            return;
        }
        try {
            $this->pdo->query('SELECT 1 FROM pc_kit_components LIMIT 1');
        } catch (\Throwable) {
            $sql = file_get_contents(dirname(__DIR__, 3) . '/database/migrations/create_pc_kit_components.sql');
            if ($sql) {
                $this->pdo->exec($sql);
            }
        }
        try {
            $alter = file_get_contents(dirname(__DIR__, 3) . '/database/migrations/alter_pc_kit_disposition.sql');
            if ($alter) {
                $this->pdo->exec($alter);
            }
        } catch (\Throwable) {
            // columns may already exist
        }
        $ready = true;
    }
}
