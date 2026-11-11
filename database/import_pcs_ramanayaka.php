<?php

declare(strict_types=1);

/**
 * Import Ramanayaka branch PCs from database/imports/pcs_ramanayaka.json
 * into pcs (All Branch PC Inventory), location RAMANAYAKE.
 *
 * Usage: php database/import_pcs_ramanayaka.php
 */

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;

$pdo = Connection::make(itam_config()['db']);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

$jsonPath = __DIR__ . '/imports/pcs_ramanayaka.json';
$raw = file_get_contents($jsonPath);
if ($raw === false) {
    fwrite(STDERR, "Missing {$jsonPath}\n");
    exit(1);
}

/** @var list<array<string, mixed>> $rows */
$rows = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);

$companyId = (int) $pdo->query("SELECT id FROM companies WHERE code = 'IT'")->fetchColumn();
if ($companyId < 1) {
    fwrite(STDERR, "Company IT not found\n");
    exit(1);
}

// Ensure Ramanayaka branch is active and visible in All Branch PC Inventory
$pdo->exec(
    "UPDATE locations
     SET name = 'Ramanayaka',
         city = COALESCE(NULLIF(city, ''), 'Colombo'),
         is_active = TRUE,
         updated_at = NOW()
     WHERE company_id = {$companyId} AND code = 'RAMANAYAKE'"
);

$locationId = (int) $pdo->query(
    "SELECT id FROM locations WHERE company_id = {$companyId} AND code = 'RAMANAYAKE'"
)->fetchColumn();
if ($locationId < 1) {
    fwrite(STDERR, "Location RAMANAYAKE not found\n");
    exit(1);
}

$depts = [];
foreach ($pdo->query(
    "SELECT id, code, name FROM departments WHERE company_id = {$companyId} AND is_active = TRUE"
) as $d) {
    $depts[strtoupper((string) $d['code'])] = (int) $d['id'];
    $depts[strtoupper((string) $d['name'])] = (int) $d['id'];
}

function mapDepartmentId(array $depts, string $dep): ?int
{
    $raw = strtoupper(trim($dep));
    if ($raw === '') {
        return null;
    }
    if (isset($depts[$raw])) {
        return $depts[$raw];
    }
    $aliases = [
        'SALES AGM' => 'SALES',
        'CASHIER' => 'OTHER',
        'RMV' => 'OTHER',
        'WHARF' => 'OTHER',
        'ADMIN' => 'ADMIN',
        'MAINTENANCE' => 'MAINTENANCE',
    ];
    $key = $aliases[$raw] ?? null;
    return $key !== null && isset($depts[$key]) ? $depts[$key] : ($depts['OTHER'] ?? null);
}

function parseRamGb(string $ram): ?float
{
    if ($ram === '') {
        return null;
    }
    if (preg_match('/(\d+(?:\.\d+)?)/', $ram, $m)) {
        return (float) $m[1];
    }
    return null;
}

/** @return array{0: ?float, 1: string, 2: string} gb, type, note */
function parseStorage(string $hdd, string $ssd): array
{
    $parse = static function (string $v): ?float {
        $v = trim($v);
        if ($v === '') {
            return null;
        }
        if (preg_match('/(\d+(?:\.\d+)?)\s*tb/i', $v, $m)) {
            return (float) $m[1] * 1024;
        }
        if (preg_match('/(\d+(?:\.\d+)?)/', $v, $m)) {
            return (float) $m[1];
        }
        return null;
    };
    $hddGb = $parse($hdd);
    $ssdGb = $parse($ssd);
    $notes = [];
    if ($hddGb !== null) {
        $notes[] = 'HDD ' . (fmod($hddGb, 1.0) === 0.0 ? (string) (int) $hddGb : (string) $hddGb) . ' GB';
    }
    if ($ssdGb !== null) {
        $notes[] = 'SSD ' . (fmod($ssdGb, 1.0) === 0.0 ? (string) (int) $ssdGb : (string) $ssdGb) . ' GB';
    }
    if ($ssdGb !== null) {
        return [$ssdGb, 'ssd', implode('; ', $notes)];
    }
    if ($hddGb !== null) {
        return [$hddGb, 'hdd', implode('; ', $notes)];
    }
    return [null, 'unknown', ''];
}

function normalizeUpsBrand(string $ups): array
{
    $ups = trim($ups);
    if ($ups === '') {
        return [false, null, null];
    }
    $lower = strtolower($ups);
    $brand = $ups;
    if (str_contains($lower, 'pro')) {
        $brand = 'Prolink';
    }
    return [true, $brand, '650'];
}

function nextRamPcTag(PDO $pdo, int $companyId): string
{
    $prefix = 'ITL-RAM-PC';
    $pattern = '^' . preg_quote($prefix, '/') . '-[0-9]+$';
    $stmt = $pdo->prepare(
        "SELECT COALESCE(MAX(
            CAST(NULLIF(substring(asset_tag from '[0-9]+$'), '') AS INTEGER)
         ), 0)
         FROM pcs
         WHERE company_id = :company_id
           AND asset_tag ~ :pattern"
    );
    $stmt->execute(['company_id' => $companyId, 'pattern' => $pattern]);
    $next = ((int) $stmt->fetchColumn()) + 1;
    return sprintf('%s-%04d', $prefix, $next);
}

$existing = (int) $pdo->query(
    "SELECT COUNT(*) FROM pcs WHERE company_id = {$companyId} AND location_id = {$locationId}"
)->fetchColumn();
if ($existing > 0) {
    echo "Note: {$existing} PC(s) already at Ramanayaka — importing additional rows.\n";
}

$insert = $pdo->prepare(
    'INSERT INTO pcs (
        company_id, location_id, department_id, asset_tag, brand, model, status, pc_name,
        cpu, ram_gb, storage_gb, storage_type, purchase_amount_lkr, notes,
        monitor_brand, has_power_cable, has_vga_cable, has_keyboard, has_mouse,
        has_ups, ups_brand, ups_model, created_at, updated_at
     ) VALUES (
        :company_id, :location_id, :department_id, :asset_tag, :brand, :model, :status, :pc_name,
        :cpu, :ram_gb, :storage_gb, :storage_type, :purchase_amount_lkr, :notes,
        :monitor_brand, :has_power_cable, :has_vga_cable, :has_keyboard, :has_mouse,
        :has_ups, :ups_brand, :ups_model, NOW(), NOW()
     ) RETURNING asset_tag'
);

$pdo->beginTransaction();
$imported = 0;
try {
    foreach ($rows as $row) {
        $userName = trim((string) ($row['user_name'] ?? ''));
        $pcLabel = trim((string) ($row['pc_name'] ?? ''));
        $cpu = trim((string) ($row['cpu'] ?? ''));
        $ram = parseRamGb((string) ($row['ram'] ?? ''));
        [$storageGb, $storageType, $storageNote] = parseStorage(
            (string) ($row['hdd'] ?? ''),
            (string) ($row['ssd'] ?? '')
        );
        [$hasUps, $upsBrand, $upsModel] = normalizeUpsBrand((string) ($row['ups'] ?? ''));
        $mouse = trim((string) ($row['mouse'] ?? ''));
        $keyboard = trim((string) ($row['keyboard'] ?? ''));
        $led = trim((string) ($row['led'] ?? ''));
        $depId = mapDepartmentId($depts, (string) ($row['dep'] ?? ''));

        $noteParts = [];
        if ($storageNote !== '') {
            $noteParts[] = $storageNote;
        }
        $os = trim((string) ($row['os'] ?? ''));
        if ($os !== '') {
            $noteParts[] = 'OS Windows ' . $os;
        }
        foreach (['network' => 'Network', 'vpn' => 'VPN', 'printers' => 'Printers'] as $k => $label) {
            $v = trim((string) ($row[$k] ?? ''));
            if ($v !== '') {
                $noteParts[] = "{$label}: {$v}";
            }
        }
        if ($mouse !== '') {
            $noteParts[] = 'Mouse: ' . $mouse;
        }
        if ($keyboard !== '') {
            $noteParts[] = 'Keyboard: ' . $keyboard;
        }
        $noteParts[] = 'Import PC No ' . (string) ($row['pc_no'] ?? '');

        $brand = null;
        $model = $pcLabel !== '' ? $pcLabel : null;
        if ($pcLabel !== '' && preg_match('/^(MSI|Toshiba|Dell|HP|Acer|Samsung)\b/i', $pcLabel, $m)) {
            $brand = $m[1];
        }

        $amount = $row['price'] ?? null;
        if ($amount === '' || $amount === null) {
            $amount = null;
        } else {
            $amount = is_numeric($amount) ? (float) $amount : null;
        }

        $tag = nextRamPcTag($pdo, $companyId);
        $hasKeyboard = $keyboard !== '';
        $hasMouse = $mouse !== '';
        $insert->bindValue('company_id', $companyId, PDO::PARAM_INT);
        $insert->bindValue('location_id', $locationId, PDO::PARAM_INT);
        $insert->bindValue('department_id', $depId, $depId === null ? PDO::PARAM_NULL : PDO::PARAM_INT);
        $insert->bindValue('asset_tag', $tag);
        $insert->bindValue('brand', $brand);
        $insert->bindValue('model', $model);
        $insert->bindValue('status', $userName !== '' ? 'deployed' : 'available');
        $insert->bindValue('pc_name', $userName !== '' ? $userName : ($pcLabel !== '' ? $pcLabel : null));
        $insert->bindValue('cpu', $cpu !== '' ? $cpu : null);
        $insert->bindValue('ram_gb', $ram);
        $insert->bindValue('storage_gb', $storageGb);
        $insert->bindValue('storage_type', $storageType);
        $insert->bindValue('purchase_amount_lkr', $amount);
        $insert->bindValue('notes', implode(' | ', $noteParts));
        $insert->bindValue('monitor_brand', $led !== '' ? $led : null);
        $insert->bindValue('has_power_cable', false, PDO::PARAM_BOOL);
        $insert->bindValue('has_vga_cable', false, PDO::PARAM_BOOL);
        $insert->bindValue('has_keyboard', $hasKeyboard, PDO::PARAM_BOOL);
        $insert->bindValue('has_mouse', $hasMouse, PDO::PARAM_BOOL);
        $insert->bindValue('has_ups', $hasUps, PDO::PARAM_BOOL);
        $insert->bindValue('ups_brand', $upsBrand);
        $insert->bindValue('ups_model', $upsModel);
        $insert->execute();
        $imported++;
        echo "OK {$tag} — " . ($userName !== '' ? $userName : $pcLabel) . "\n";
    }
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, 'Import failed: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}

echo "\nImported {$imported} PC(s) to Ramanayaka (All Branch PC Inventory).\n";
echo "Open: Assets → All Branch PC Inventory → Ramanayaka\n";
