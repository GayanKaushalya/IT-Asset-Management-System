<?php

declare(strict_types=1);

/**
 * Import laptops from database/imports/laptops_from_excel.json into the laptops table.
 * Maps Excel companies → IT / ISP / IMS and best-effort branch locations.
 *
 * Usage: php database/import_laptops_from_excel.php
 */

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;

$pdo = Connection::make(itam_config()['db']);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

$jsonPath = __DIR__ . '/imports/laptops_from_excel.json';
$raw = file_get_contents($jsonPath);
if ($raw === false) {
    fwrite(STDERR, "Missing {$jsonPath}\n");
    exit(1);
}

/** @var list<array<string, mixed>> $rows */
$rows = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);

$companyMap = [
    'indra traders pvt ltd' => 'IT',
    'indra service park pvt ltd' => 'ISP',
    'indra motorspare pvt ltd' => 'IMS',
    'indra motor spares pvt ltd' => 'IMS',
];

$companies = [];
$stmt = $pdo->query('SELECT id, code FROM companies');
foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $c) {
    $companies[$c['code']] = (int) $c['id'];
}

$locationsByCompany = [];
$stmt = $pdo->query('SELECT id, company_id, code, name FROM locations WHERE is_active = TRUE');
foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $l) {
    $locationsByCompany[(int) $l['company_id']][strtoupper((string) $l['code'])] = (int) $l['id'];
}

function excelDateToYmd(mixed $value): ?string
{
    if ($value === null || $value === '') {
        return null;
    }
    if (is_numeric($value)) {
        $unix = ((float) $value - 25569) * 86400;
        return gmdate('Y-m-d', (int) $unix);
    }
    $ts = strtotime((string) $value);
    return $ts ? date('Y-m-d', $ts) : null;
}

function parseRamGb(?string $ram): ?float
{
    if ($ram === null || trim($ram) === '') {
        return null;
    }
    if (preg_match('/(\d+(?:\.\d+)?)\s*gb/i', $ram, $m)) {
        return (float) $m[1];
    }
    return null;
}

/** @return array{0: ?float, 1: string} storage_gb, storage_type */
function parseStorage(?string $capacity): array
{
    if ($capacity === null || trim($capacity) === '') {
        return [null, 'unknown'];
    }
    $gb = null;
    if (preg_match('/(\d+(?:\.\d+)?)\s*gb/i', $capacity, $m)) {
        $gb = (float) $m[1];
    } elseif (preg_match('/(\d+(?:\.\d+)?)\s*tb/i', $capacity, $m)) {
        $gb = (float) $m[1] * 1024;
    }
    $lower = strtolower($capacity);
    $type = 'unknown';
    if (str_contains($lower, 'nvme') || str_contains($lower, 'ssd')) {
        $type = 'ssd';
    } elseif (str_contains($lower, 'hdd')) {
        $type = 'hdd';
    } elseif (str_contains($lower, 'hybrid')) {
        $type = 'hybrid';
    }
    return [$gb, $type];
}

function inferLocationCode(string $companyCode, string $department): ?string
{
    $d = strtolower($department);
    $d = str_replace(['\\', '/'], ' ', $d);

    if ($companyCode === 'IMS') {
        if (str_contains($d, 'embilipitiya')) {
            return 'EMBILIPITIYA';
        }
        if (str_contains($d, 'gampola')) {
            return 'GAMPOLA';
        }
        if (str_contains($d, 'mathara') || str_contains($d, 'matara')) {
            return 'MATHARA';
        }
        if (str_contains($d, '201') || str_contains($d, 'ims')) {
            return 'BR_201';
        }
        return 'BR_201';
    }

    if ($companyCode === 'ISP') {
        if (str_contains($d, 'kelani')) {
            return 'KELANI';
        }
        if (str_contains($d, 'mathara') || str_contains($d, 'matara')) {
            return 'MATHARA';
        }
        if (str_contains($d, 'anuradhapura')) {
            return 'ANURADHAPURA';
        }
        if (str_contains($d, 'kandy')) {
            return 'KANDY';
        }
        return 'KANDY';
    }

    // ITL (IT)
    if (str_contains($d, 'negombo')) {
        return 'NEGOMBO';
    }
    if (str_contains($d, 'kelani') || str_contains($d, 'kelamiya')) {
        return 'KELANI';
    }
    if (str_contains($d, 'ramanayak')) {
        return 'RAMANAYAKE';
    }
    if (str_contains($d, 'hydepark')) {
        return 'HYDEPARK';
    }
    if (str_contains($d, 'mathara') || str_contains($d, 'matara')) {
        return 'MATHARA';
    }
    if (str_contains($d, 'anuradhapura')) {
        return 'ANURADHAPURA';
    }
    if (str_contains($d, 'kandy') || preg_match('/\bh\s*o\b/', $d) || str_contains($d, 'indra h')) {
        return 'KANDY_HO';
    }
    if (str_contains($d, 'colombo') || str_contains($d, 'acc col') || str_contains($d, 'co-sales') || str_contains($d, 'sales-colombo')) {
        return 'CMB_BR';
    }
    return 'KANDY_HO';
}

function resolveOrCreateSupplier(PDO $pdo, int $companyId, ?string $name): ?int
{
    $name = trim((string) $name);
    if ($name === '') {
        return null;
    }
    $find = $pdo->prepare(
        'SELECT id FROM suppliers WHERE company_id = :cid AND lower(name) = lower(:name) LIMIT 1'
    );
    $find->execute(['cid' => $companyId, 'name' => $name]);
    $id = $find->fetchColumn();
    if ($id !== false) {
        return (int) $id;
    }

    $ins = $pdo->prepare(
        'INSERT INTO suppliers (company_id, name, is_active)
         VALUES (:cid, :name, TRUE)
         RETURNING id'
    );
    $ins->execute(['cid' => $companyId, 'name' => $name]);
    return (int) $ins->fetchColumn();
}

function nextLaptopTag(PDO $pdo, int $companyId, string $companyCode): string
{
    $prefix = match ($companyCode) {
        'IT' => 'IT-LAP-',
        'ISP' => 'ISP-LAP-',
        'IMS' => 'IMS-LAP-',
        default => 'LAP-',
    };
    $pattern = '^' . preg_quote($prefix, '/') . '[0-9]+$';
    $stmt = $pdo->prepare(
        "SELECT COALESCE(MAX(CAST(NULLIF(substring(asset_tag from '[0-9]+$'), '') AS INTEGER)), 0)
         FROM laptops
         WHERE company_id = :cid AND asset_tag ~ :pattern"
    );
    $stmt->execute(['cid' => $companyId, 'pattern' => $pattern]);
    $next = ((int) $stmt->fetchColumn()) + 1;
    return $prefix . str_pad((string) $next, 4, '0', STR_PAD_LEFT);
}

$insert = $pdo->prepare(
    'INSERT INTO laptops (
        company_id, location_id, supplier_id, asset_tag, serial_number,
        brand, model, status, pc_name, cpu, ram_gb, storage_gb, storage_type,
        invoice_no, purchase_amount_lkr, purchase_date, notes,
        handover_person_1, handover_on_1,
        original_assigned_person, original_assigned_on,
        allocated_person, allocated_on, created_by, updated_by
     ) VALUES (
        :company_id, :location_id, :supplier_id, :asset_tag, :serial_number,
        :brand, :model, :status, :pc_name, :cpu, :ram_gb, :storage_gb, :storage_type,
        :invoice_no, :purchase_amount_lkr, :purchase_date, :notes,
        :handover_person_1, :handover_on_1,
        :original_assigned_person, :original_assigned_on,
        :allocated_person, :allocated_on, :created_by, :updated_by
     ) RETURNING id, asset_tag'
);

$exists = $pdo->prepare(
    'SELECT id, asset_tag FROM laptops
     WHERE company_id = :cid AND serial_number IS NOT NULL AND lower(serial_number) = lower(:sn)
     LIMIT 1'
);

$inserted = 0;
$skipped = 0;
$errors = 0;
$byCompany = ['IT' => 0, 'ISP' => 0, 'IMS' => 0];

echo "Importing " . count($rows) . " laptop rows...\n";

foreach ($rows as $row) {
    $companyRaw = trim((string) ($row['company'] ?? ''));
    $companyCode = $companyMap[strtolower($companyRaw)] ?? null;
    if ($companyCode === null || !isset($companies[$companyCode])) {
        fwrite(STDERR, "SKIP row {$row['row']}: unknown company \"{$companyRaw}\"\n");
        $errors++;
        continue;
    }

    $companyId = $companies[$companyCode];
    $serial = trim((string) ($row['serial'] ?? ''));
    if ($serial === '') {
        fwrite(STDERR, "SKIP row {$row['row']}: missing serial\n");
        $errors++;
        continue;
    }

    $exists->execute(['cid' => $companyId, 'sn' => $serial]);
    $existing = $exists->fetch(PDO::FETCH_ASSOC);
    if ($existing) {
        echo "SKIP existing {$companyCode} SN={$serial} ({$existing['asset_tag']})\n";
        $skipped++;
        continue;
    }

    $department = trim((string) ($row['department'] ?? ''));
    $locCode = inferLocationCode($companyCode, $department);
    $locationId = $locationsByCompany[$companyId][$locCode] ?? null;

    $person = trim((string) ($row['name'] ?? ''));
    $purchaseDate = excelDateToYmd($row['date'] ?? null);
    [$storageGb, $storageType] = parseStorage(isset($row['capacity']) ? (string) $row['capacity'] : null);
    $ramGb = parseRamGb(isset($row['ram']) ? (string) $row['ram'] : null);
    $brand = trim((string) ($row['brand'] ?? ''));
    $model = trim((string) ($row['model'] ?? ''));
    $cpu = trim((string) ($row['processor'] ?? ''));
    $invoice = trim((string) ($row['invoice_no'] ?? ''));
    $amount = $row['amount'] ?? null;
    $amount = is_numeric($amount) ? (float) $amount : null;

    $status = $person !== '' ? 'deployed' : 'available';
    $notes = $department !== '' ? 'Excel dept: ' . $department : null;
    if ($companyRaw !== '') {
        $notes = trim(($notes ? $notes . ' | ' : '') . 'Source company: ' . $companyRaw);
    }

    $supplierId = resolveOrCreateSupplier($pdo, $companyId, isset($row['supplier']) ? (string) $row['supplier'] : null);
    $assetTag = nextLaptopTag($pdo, $companyId, $companyCode);

    $pcName = $person !== '' ? $person : ($brand !== '' || $model !== '' ? trim("{$brand} {$model}") : $assetTag);

    try {
        $insert->execute([
            'company_id' => $companyId,
            'location_id' => $locationId,
            'supplier_id' => $supplierId,
            'asset_tag' => $assetTag,
            'serial_number' => $serial,
            'brand' => $brand !== '' ? $brand : null,
            'model' => $model !== '' ? $model : null,
            'status' => $status,
            'pc_name' => $pcName,
            'cpu' => $cpu !== '' ? $cpu : null,
            'ram_gb' => $ramGb,
            'storage_gb' => $storageGb,
            'storage_type' => $storageType,
            'invoice_no' => $invoice !== '' ? $invoice : null,
            'purchase_amount_lkr' => $amount,
            'purchase_date' => $purchaseDate,
            'notes' => $notes,
            'handover_person_1' => $person !== '' ? $person : null,
            'handover_on_1' => $person !== '' ? $purchaseDate : null,
            'original_assigned_person' => $person !== '' ? $person : null,
            'original_assigned_on' => $person !== '' ? $purchaseDate : null,
            'allocated_person' => $person !== '' ? $person : null,
            'allocated_on' => $person !== '' ? $purchaseDate : null,
            'created_by' => 1,
            'updated_by' => 1,
        ]);
        $created = $insert->fetch(PDO::FETCH_ASSOC);
        echo "OK {$companyCode} {$created['asset_tag']} SN={$serial} loc={$locCode}\n";
        $inserted++;
        $byCompany[$companyCode]++;
    } catch (Throwable $e) {
        fwrite(STDERR, "ERR row {$row['row']} SN={$serial}: {$e->getMessage()}\n");
        $errors++;
    }
}

echo "\nDone. inserted={$inserted} skipped={$skipped} errors={$errors}\n";
echo "By company: ITL={$byCompany['IT']} ISP={$byCompany['ISP']} IMS={$byCompany['IMS']}\n";

$check = $pdo->query(
    "SELECT c.code, COUNT(*) AS n
     FROM laptops l
     JOIN companies c ON c.id = l.company_id
     GROUP BY c.code
     ORDER BY c.code"
);
echo "\nCurrent laptops in DB:\n";
foreach ($check->fetchAll(PDO::FETCH_ASSOC) as $r) {
    echo "  {$r['code']}: {$r['n']}\n";
}
