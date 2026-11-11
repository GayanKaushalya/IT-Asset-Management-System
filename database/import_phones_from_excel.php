<?php

declare(strict_types=1);

/**
 * Import mobile phones from database/imports/phones_from_excel.json
 * Matches Excel fields including multi-person handovers.
 *
 * Usage: php database/import_phones_from_excel.php
 */

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;

$pdo = Connection::make(itam_config()['db']);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

// Schema extensions
$pdo->exec(file_get_contents(__DIR__ . '/migrations/extend_mobile_phones_for_excel.sql'));
echo "Schema ready.\n";

$jsonPath = __DIR__ . '/imports/phones_from_excel.json';
$raw = file_get_contents($jsonPath);
if ($raw === false) {
    fwrite(STDERR, "Missing {$jsonPath}\n");
    exit(1);
}
/** @var list<array<string, mixed>> $phones */
$phones = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);

$companyMap = [
    'indra traders pvt ltd' => 'IT',
    'indra traders' => 'IT',
    'indra service park pvt ltd' => 'ISP',
    'indra sevice parck' => 'ISP',
    'indra service park' => 'ISP',
    'indra motorspares pvt ltd' => 'IMS',
    'indra motorspare pvt ltd' => 'IMS',
    'indra motor spares pvt ltd' => 'IMS',
];

$companies = [];
foreach ($pdo->query('SELECT id, code FROM companies')->fetchAll(PDO::FETCH_ASSOC) as $c) {
    $companies[$c['code']] = (int) $c['id'];
}

$locationsByCompany = [];
foreach ($pdo->query('SELECT id, company_id, code, name FROM locations WHERE is_active = TRUE')->fetchAll(PDO::FETCH_ASSOC) as $l) {
    $locationsByCompany[(int) $l['company_id']][strtoupper((string) $l['code'])] = (int) $l['id'];
}

function mapCompanyCode(?string $locCompany): ?string
{
    global $companyMap;
    if ($locCompany === null || trim($locCompany) === '') {
        return null;
    }
    $key = strtolower(trim($locCompany));
    if (isset($companyMap[$key])) {
        return $companyMap[$key];
    }
    if (str_contains($key, 'trader')) {
        return 'IT';
    }
    if (str_contains($key, 'service') || str_contains($key, 'sevice')) {
        return 'ISP';
    }
    if (str_contains($key, 'motor')) {
        return 'IMS';
    }
    return null;
}

function inferLocationCode(string $companyCode, string $name, string $person2 = ''): string
{
    $d = strtolower($name . ' ' . $person2);
    if ($companyCode === 'IMS') {
        if (str_contains($d, 'embilipitiya')) {
            return 'EMBILIPITIYA';
        }
        if (str_contains($d, '201')) {
            return 'BR_201';
        }
        return 'BR_201';
    }
    if ($companyCode === 'ISP') {
        if (str_contains($d, 'kelani')) {
            return 'KELANI';
        }
        if (str_contains($d, 'kandy')) {
            return 'KANDY';
        }
        return 'KANDY';
    }
    // IT
    if (str_contains($d, 'negombo')) {
        return 'NEGOMBO';
    }
    if (str_contains($d, 'kelani') || str_contains($d, 'jaela')) {
        return 'KELANI';
    }
    if (str_contains($d, 'ramanayak')) {
        return 'RAMANAYAKE';
    }
    if (str_contains($d, 'colombo')) {
        return 'CMB_BR';
    }
    if (str_contains($d, 'kandy')) {
        return 'KANDY_HO';
    }
    return 'KANDY_HO';
}

function resolveSupplier(PDO $pdo, int $companyId, ?string $name): ?int
{
    $name = trim((string) $name);
    if ($name === '') {
        return null;
    }
    $find = $pdo->prepare('SELECT id FROM suppliers WHERE company_id = :c AND lower(name) = lower(:n) LIMIT 1');
    $find->execute(['c' => $companyId, 'n' => $name]);
    $id = $find->fetchColumn();
    if ($id) {
        return (int) $id;
    }
    $ins = $pdo->prepare('INSERT INTO suppliers (company_id, name, is_active) VALUES (:c, :n, TRUE) RETURNING id');
    $ins->execute(['c' => $companyId, 'n' => $name]);
    return (int) $ins->fetchColumn();
}

function nextMobileTag(PDO $pdo, int $companyId, string $companyCode): string
{
    $prefix = match ($companyCode) {
        'IT' => 'IT-MB-',
        'ISP' => 'ISP-MB-',
        'IMS' => 'IMS-MB-',
        default => 'MB-',
    };
    $pattern = '^' . preg_quote($prefix, '/') . '[0-9]+$';
    $stmt = $pdo->prepare(
        "SELECT COALESCE(MAX(CAST(NULLIF(substring(asset_tag from '[0-9]+$'), '') AS INTEGER)), 0)
         FROM mobile_phones WHERE company_id = :cid AND asset_tag ~ :pattern"
    );
    $stmt->execute(['cid' => $companyId, 'pattern' => $pattern]);
    $next = ((int) $stmt->fetchColumn()) + 1;
    return $prefix . str_pad((string) $next, 4, '0', STR_PAD_LEFT);
}

function existsPhone(PDO $pdo, int $companyId, ?string $serial, ?string $imei): ?int
{
    // Prefer IMEI — Excel serials often repeat across identical handset models
    if ($imei) {
        $s = $pdo->prepare(
            'SELECT id FROM mobile_phones
             WHERE company_id = :c AND (imei_number = :i OR imei_number_2 = :i)
             LIMIT 1'
        );
        $s->execute(['c' => $companyId, 'i' => $imei]);
        $id = $s->fetchColumn();
        if ($id) {
            return (int) $id;
        }
    }
    if ($serial && $imei === null) {
        $s = $pdo->prepare(
            'SELECT id FROM mobile_phones
             WHERE company_id = :c AND lower(serial_number) = lower(:s)
             LIMIT 1'
        );
        $s->execute(['c' => $companyId, 's' => $serial]);
        $id = $s->fetchColumn();
        if ($id) {
            return (int) $id;
        }
    }
    return null;
}

function insertHandover(
    PDO $pdo,
    int $companyId,
    int $assetId,
    string $person,
    string $date,
    bool $isOpen,
    ?string $returnDate,
    ?string $remarks
): void {
    $stmt = $pdo->prepare(
        'INSERT INTO asset_handovers (
            company_id, asset_id, asset_type, handover_date, assigned_person_name,
            assigned_by_it_staff_id, checkout_condition, checkout_remarks,
            return_date, return_received_by_id, return_condition, return_remarks,
            gate_pass_no, is_open
         ) VALUES (
            :company_id, :asset_id, \'mobile_phone\', :handover_date, :person,
            1, \'good\', :checkout_remarks,
            :return_date, :return_by, :return_condition, :return_remarks,
            :gate, :is_open
         )'
    );
    $gate = 'GP-MB-' . $assetId . '-' . substr(md5($person . $date), 0, 6);
    $stmt->bindValue('company_id', $companyId, PDO::PARAM_INT);
    $stmt->bindValue('asset_id', $assetId, PDO::PARAM_INT);
    $stmt->bindValue('handover_date', $date);
    $stmt->bindValue('person', $person);
    $stmt->bindValue('checkout_remarks', $remarks);
    $stmt->bindValue('return_date', $returnDate);
    $stmt->bindValue('return_by', $returnDate !== null ? 1 : null, $returnDate !== null ? PDO::PARAM_INT : PDO::PARAM_NULL);
    $stmt->bindValue('return_condition', $returnDate !== null ? 'good' : null);
    $stmt->bindValue('return_remarks', $returnDate !== null ? 'Imported from Excel' : null);
    $stmt->bindValue('gate', $gate);
    $stmt->bindValue('is_open', $isOpen, PDO::PARAM_BOOL);
    $stmt->execute();
}

$insert = $pdo->prepare(
    'INSERT INTO mobile_phones (
        company_id, location_id, supplier_id, asset_tag, serial_number,
        brand, model, status, pc_name, invoice_no, purchase_amount_lkr, purchase_date,
        imei_number, imei_number_2, phone_number, condition_code, accessories, notes,
        first_handover_person, handed_over_on, asset_return_date,
        handover_person_1, handover_person_2, handover_person_3, handover_person_4,
        handover_on_1, handover_on_2, handover_on_3, handover_on_4,
        original_assigned_person, original_assigned_on,
        allocated_person, allocated_on, created_by, updated_by
     ) VALUES (
        :company_id, :location_id, :supplier_id, :asset_tag, :serial_number,
        :brand, :model, :status, :pc_name, :invoice_no, :purchase_amount_lkr, :purchase_date,
        :imei_number, :imei_number_2, :phone_number, :condition_code, :accessories, :notes,
        :first_handover_person, :handed_over_on, :asset_return_date,
        :handover_person_1, :handover_person_2, :handover_person_3, :handover_person_4,
        :handover_on_1, :handover_on_2, :handover_on_3, :handover_on_4,
        :original_assigned_person, :original_assigned_on,
        :allocated_person, :allocated_on, 1, 1
     ) RETURNING id, asset_tag'
);

$inserted = 0;
$skipped = 0;
$errors = 0;
$byCompany = ['IT' => 0, 'ISP' => 0, 'IMS' => 0];

echo 'Importing ' . count($phones) . " phones...\n";

foreach ($phones as $p) {
    $companyCode = mapCompanyCode(isset($p['location_company']) ? (string) $p['location_company'] : null);
    if ($companyCode === null || ! isset($companies[$companyCode])) {
        fwrite(STDERR, "SKIP no {$p['no']}: unknown company \"{$p['location_company']}\"\n");
        $errors++;
        continue;
    }
    $companyId = $companies[$companyCode];
    $imeis = array_values(array_filter(array_map('strval', $p['imeis'] ?? [])));
    $imei1 = $imeis[0] ?? null;
    $imei2 = $imeis[1] ?? null;
    $serial = isset($p['serial']) && $p['serial'] !== '' ? (string) $p['serial'] : null;

    if (existsPhone($pdo, $companyId, $serial, $imei1)) {
        echo "SKIP existing no={$p['no']} imei={$imei1}\n";
        $skipped++;
        continue;
    }

    $name = trim((string) ($p['name'] ?? ''));
    $h2 = trim((string) ($p['handover2_person'] ?? ''));
    $h3 = trim((string) ($p['handover3_person'] ?? ''));
    $on1 = $p['handed_over_on'] ?? null;
    $on2 = $p['handover2_on'] ?? null;
    $on3 = $p['handover3_on'] ?? null;
    $returnDate = $p['return_date'] ?? null;

    $locCode = inferLocationCode($companyCode, $name, $h2);
    $locationId = $locationsByCompany[$companyId][$locCode] ?? null;
    $supplierId = resolveSupplier($pdo, $companyId, isset($p['vendor']) ? (string) $p['vendor'] : null);
    $assetTag = nextMobileTag($pdo, $companyId, $companyCode);

    // Current holder = last person in chain
    $allocated = $name !== '' ? $name : null;
    $allocatedOn = is_string($on1) ? $on1 : null;
    $phoneNo = isset($p['phone_no']) ? (string) $p['phone_no'] : null;
    if ($h2 !== '') {
        $allocated = $h2;
        $allocatedOn = is_string($on2) ? $on2 : $allocatedOn;
        if (! empty($p['handover2_phone'])) {
            $phoneNo = (string) $p['handover2_phone'];
        }
    }
    if ($h3 !== '') {
        $allocated = $h3;
        $allocatedOn = is_string($on3) ? $on3 : $allocatedOn;
        if (! empty($p['handover3_phone'])) {
            $phoneNo = (string) $p['handover3_phone'];
        }
    }

    $status = $allocated ? 'deployed' : 'available';
    $others = is_array($p['others'] ?? null) ? implode(', ', $p['others']) : '';
    $accessories = trim(implode(' | ', array_filter([
        $others,
        isset($p['items']) ? (string) $p['items'] : '',
    ])));
    $notesParts = array_filter([
        $p['code'] ? 'Condition: ' . $p['code'] : null,
        $p['remark'] ? 'Remark: ' . $p['remark'] : null,
        $p['handover2_remark'] ? 'H2 remark: ' . $p['handover2_remark'] : null,
        $p['handover3_remark'] ? 'H3 remark: ' . $p['handover3_remark'] : null,
        $p['handover2_items'] ? 'H2 items: ' . $p['handover2_items'] : null,
        $p['location_company'] ? 'Excel company/location: ' . $p['location_company'] : null,
        'Excel No: ' . ($p['no'] ?? ''),
    ]);
    $notes = implode("\n", $notesParts);

    $brand = isset($p['brand']) ? (string) $p['brand'] : null;
    if ($brand !== null) {
        $brand = ucwords(strtolower($brand));
        if (strtoupper($brand) === 'Honer') {
            $brand = 'Honor';
        }
    }

    try {
        $pdo->beginTransaction();
        $insert->execute([
            'company_id' => $companyId,
            'location_id' => $locationId,
            'supplier_id' => $supplierId,
            'asset_tag' => $assetTag,
            'serial_number' => $serial,
            'brand' => $brand,
            'model' => isset($p['model']) ? (string) $p['model'] : null,
            'status' => $status,
            'pc_name' => $name !== '' ? $name : $assetTag,
            'invoice_no' => isset($p['invoice']) ? (string) $p['invoice'] : null,
            'purchase_amount_lkr' => is_numeric($p['price'] ?? null) ? (float) $p['price'] : null,
            'purchase_date' => is_string($on1) ? $on1 : null,
            'imei_number' => $imei1,
            'imei_number_2' => $imei2,
            'phone_number' => $phoneNo,
            'condition_code' => isset($p['code']) ? (string) $p['code'] : null,
            'accessories' => $accessories !== '' ? $accessories : null,
            'notes' => $notes !== '' ? $notes : null,
            'first_handover_person' => $name !== '' ? $name : null,
            'handed_over_on' => is_string($on1) ? $on1 : null,
            'asset_return_date' => is_string($returnDate) ? $returnDate : null,
            'handover_person_1' => $name !== '' ? $name : null,
            'handover_person_2' => $h2 !== '' ? $h2 : null,
            'handover_person_3' => $h3 !== '' ? $h3 : null,
            'handover_person_4' => null,
            'handover_on_1' => is_string($on1) ? $on1 : null,
            'handover_on_2' => is_string($on2) ? $on2 : null,
            'handover_on_3' => is_string($on3) ? $on3 : null,
            'handover_on_4' => null,
            'original_assigned_person' => $name !== '' ? $name : null,
            'original_assigned_on' => is_string($on1) ? $on1 : null,
            'allocated_person' => $allocated,
            'allocated_on' => $allocatedOn,
        ]);
        $row = $insert->fetch(PDO::FETCH_ASSOC);
        $assetId = (int) $row['id'];

        // Handover history from Excel chain
        $chain = [];
        if ($name !== '' && is_string($on1)) {
            $chain[] = [
                'person' => $name,
                'date' => $on1,
                'remarks' => isset($p['items']) ? (string) $p['items'] : null,
            ];
        }
        if ($h2 !== '' && is_string($on2)) {
            $chain[] = [
                'person' => $h2,
                'date' => $on2,
                'remarks' => isset($p['handover2_items']) ? (string) $p['handover2_items'] : null,
            ];
        }
        if ($h3 !== '' && is_string($on3)) {
            $chain[] = [
                'person' => $h3,
                'date' => $on3,
                'remarks' => isset($p['handover3_items']) ? (string) $p['handover3_items'] : null,
            ];
        }

        $last = count($chain) - 1;
        foreach ($chain as $i => $h) {
            $isOpen = $i === $last;
            $ret = null;
            if (! $isOpen) {
                // Close prior handover: use excel return_date for first hop when sensible, else day before next
                if ($i === 0 && is_string($returnDate)) {
                    $ret = $returnDate;
                } elseif (isset($chain[$i + 1])) {
                    $nextDate = $chain[$i + 1]['date'];
                    $ret = date('Y-m-d', strtotime($nextDate . ' -1 day'));
                }
            }
            insertHandover(
                $pdo,
                $companyId,
                $assetId,
                $h['person'],
                $h['date'],
                $isOpen,
                $ret,
                $h['remarks']
            );
        }

        $pdo->commit();
        echo "OK {$companyCode} {$row['asset_tag']} no={$p['no']} {$name} → " . ($allocated ?? '—') . "\n";
        $inserted++;
        $byCompany[$companyCode]++;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        fwrite(STDERR, "ERR no={$p['no']}: {$e->getMessage()}\n");
        $errors++;
    }
}

echo "\nDone. inserted={$inserted} skipped={$skipped} errors={$errors}\n";
echo "By company: ITL={$byCompany['IT']} ISP={$byCompany['ISP']} IMS={$byCompany['IMS']}\n";

$check = $pdo->query(
    "SELECT c.code, COUNT(*) AS n
     FROM mobile_phones m JOIN companies c ON c.id = m.company_id
     GROUP BY c.code ORDER BY c.code"
);
echo "\nMobile phones in DB:\n";
foreach ($check->fetchAll(PDO::FETCH_ASSOC) as $r) {
    echo "  {$r['code']}: {$r['n']}\n";
}
