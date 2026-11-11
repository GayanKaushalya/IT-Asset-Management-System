<?php

declare(strict_types=1);

/**
 * Import old phone stock from database/imports/old_phones_book1.json (Book1.xlsx).
 * Tags: IT-MB-01 / IMS-MB-01 / ISP-MB-01 (is_legacy = true).
 *
 * Usage: php database/import_old_phones_book1.php
 */

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;

$pdo = Connection::make(itam_config()['db']);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

$jsonPath = __DIR__ . '/imports/old_phones_book1.json';
$raw = file_get_contents($jsonPath);
if ($raw === false) {
    fwrite(STDERR, "Missing {$jsonPath} — run imports/_export_book1_phones.py first\n");
    exit(1);
}

/** @var list<array<string, mixed>> $phones */
$phones = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);

$companies = [];
foreach ($pdo->query('SELECT id, code FROM companies')->fetchAll(PDO::FETCH_ASSOC) as $c) {
    $companies[strtoupper((string) $c['code'])] = (int) $c['id'];
}

$locationsByCompany = [];
foreach ($pdo->query('SELECT id, company_id, code, name FROM locations WHERE is_active = TRUE')->fetchAll(PDO::FETCH_ASSOC) as $l) {
    $locationsByCompany[(int) $l['company_id']][strtoupper((string) $l['code'])] = (int) $l['id'];
}

function mapCompanyCode(?string $locCompany): ?string
{
    if ($locCompany === null || trim($locCompany) === '') {
        return null;
    }
    $key = strtolower(trim($locCompany));
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
        if (preg_match('/\b140\b/', $d)) {
            return 'BR_140';
        }
        if (preg_match('/\b201\b/', $d) || str_contains($d, 'embilipitiya')) {
            return str_contains($d, 'embilipitiya') ? 'EMBILIPITIYA' : 'BR_201';
        }
        if (preg_match('/\b43\b/', $d)) {
            return 'BR_43';
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
        return 'KANDY';
    }
    if (str_contains($d, 'negombo')) {
        return 'NEGOMBO';
    }
    if (str_contains($d, 'kelani') || str_contains($d, 'jaela') || str_contains($d, 'ja-ela')) {
        return 'KELANI';
    }
    if (str_contains($d, 'ramanayak')) {
        return 'RAMANAYAKE';
    }
    if (str_contains($d, 'mathara') || str_contains($d, 'matara')) {
        return 'MATHARA';
    }
    return 'KANDY_HO';
}

function nextOldPhoneTag(PDO $pdo, int $companyId, string $companyCode): string
{
    $prefix = match ($companyCode) {
        'IT', 'ITL' => 'IT-MB',
        'IMS' => 'IMS-MB',
        'ISP' => 'ISP-MB',
        default => strtoupper($companyCode) . '-MB',
    };
    $pattern = '^' . preg_quote($prefix, '/') . '-[0-9]{1,2}$';
    $stmt = $pdo->prepare(
        "SELECT COALESCE(MAX(CAST(NULLIF(substring(asset_tag from '[0-9]+$'), '') AS INTEGER)), 0)
         FROM mobile_phones WHERE company_id = :cid AND asset_tag ~ :pattern"
    );
    $stmt->execute(['cid' => $companyId, 'pattern' => $pattern]);
    $next = ((int) $stmt->fetchColumn()) + 1;
    if ($next > 99) {
        throw new RuntimeException("Old stock series full for {$prefix}");
    }
    return sprintf('%s-%02d', $prefix, $next);
}

function imeiTaken(PDO $pdo, string $imei): bool
{
    $s = $pdo->prepare(
        'SELECT 1 FROM mobile_phones WHERE imei_number = :i OR imei_number_2 = :i LIMIT 1'
    );
    $s->execute(['i' => $imei]);
    return (bool) $s->fetchColumn();
}

function existsPhone(PDO $pdo, int $companyId, ?string $serial, ?string $imei): ?int
{
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
    // Only fall back to serial when IMEI is missing (Excel sometimes reuses S/N)
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

/** Normalize Excel date; clamp invalid calendar days (e.g. 2025-02-29). */
function normalizeDate(?string $d): ?string
{
    if ($d === null || trim($d) === '') {
        return null;
    }
    $d = trim($d);
    if (! preg_match('/^(\d{4})-(\d{2})-(\d{2})$/', $d, $m)) {
        return $d;
    }
    $y = (int) $m[1];
    $mo = (int) $m[2];
    $day = (int) $m[3];
    if (! checkdate($mo, $day, $y)) {
        $last = (int) date('t', mktime(0, 0, 0, $mo, 1, $y));
        $day = min($day, $last);
        $d = sprintf('%04d-%02d-%02d', $y, $mo, $day);
    }
    return $d;
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
    $gate = 'GP-MB-OLD-' . $assetId . '-' . substr(md5($person . $date), 0, 6);
    $stmt->bindValue('company_id', $companyId, PDO::PARAM_INT);
    $stmt->bindValue('asset_id', $assetId, PDO::PARAM_INT);
    $stmt->bindValue('handover_date', $date);
    $stmt->bindValue('person', $person);
    $stmt->bindValue('checkout_remarks', $remarks);
    $stmt->bindValue('return_date', $returnDate);
    $stmt->bindValue('return_by', $returnDate !== null ? 1 : null, $returnDate !== null ? PDO::PARAM_INT : PDO::PARAM_NULL);
    $stmt->bindValue('return_condition', $returnDate !== null ? 'good' : null);
    $stmt->bindValue('return_remarks', $returnDate !== null ? 'Imported from old phone list' : null);
    $stmt->bindValue('gate', $gate);
    $stmt->bindValue('is_open', $isOpen, PDO::PARAM_BOOL);
    $stmt->execute();
}

$insert = $pdo->prepare(
    'INSERT INTO mobile_phones (
        company_id, location_id, asset_tag, serial_number,
        brand, model, status, pc_name,
        imei_number, imei_number_2, phone_number, condition_code, accessories, notes,
        first_handover_person, handed_over_on, asset_return_date,
        handover_person_1, handover_person_2, handover_person_3, handover_person_4,
        handover_on_1, handover_on_2, handover_on_3, handover_on_4,
        original_assigned_person, original_assigned_on,
        allocated_person, allocated_on, is_legacy, created_by, updated_by
     ) VALUES (
        :company_id, :location_id, :asset_tag, :serial_number,
        :brand, :model, :status, :pc_name,
        :imei_number, :imei_number_2, :phone_number, :condition_code, :accessories, :notes,
        :first_handover_person, :handed_over_on, :asset_return_date,
        :handover_person_1, :handover_person_2, :handover_person_3, :handover_person_4,
        :handover_on_1, :handover_on_2, :handover_on_3, :handover_on_4,
        :original_assigned_person, :original_assigned_on,
        :allocated_person, :allocated_on, TRUE, 1, 1
     ) RETURNING id, asset_tag'
);

$inserted = 0;
$skipped = 0;
$errors = 0;
$byCompany = ['IT' => 0, 'ISP' => 0, 'IMS' => 0];

echo 'Importing ' . count($phones) . " old phones from Book1...\n";

foreach ($phones as $p) {
    $sheetNo = (string) ($p['sheet_no'] ?? $p['no'] ?? '?');
    $companyCode = mapCompanyCode(isset($p['location']) ? (string) $p['location'] : null);
    if ($companyCode === null || ! isset($companies[$companyCode])) {
        fwrite(STDERR, "SKIP no {$sheetNo}: unknown company \"{$p['location']}\"\n");
        $errors++;
        continue;
    }
    $companyId = $companies[$companyCode];
    $imei1 = isset($p['imei1']) && $p['imei1'] !== '' ? preg_replace('/\D+/', '', (string) $p['imei1']) : null;
    $imei2 = isset($p['imei2']) && $p['imei2'] !== '' ? preg_replace('/\D+/', '', (string) $p['imei2']) : null;
    if ($imei1 === '') {
        $imei1 = null;
    }
    if ($imei2 === '') {
        $imei2 = null;
    }
    $serial = isset($p['serial']) && $p['serial'] !== '' ? (string) $p['serial'] : null;

    if (($imei1 || $serial) && existsPhone($pdo, $companyId, $serial, $imei1)) {
        echo "SKIP existing no={$sheetNo} imei={$imei1}\n";
        $skipped++;
        continue;
    }
    // Excel sometimes repeats IMEIs across rows — keep the phone, leave IMEI blank for later edit
    if ($imei1 !== null && imeiTaken($pdo, $imei1)) {
        echo "WARN no={$sheetNo}: IMEI1 {$imei1} already used — importing without IMEI\n";
        $imei1 = null;
        $imei2 = null;
    } elseif ($imei2 !== null && imeiTaken($pdo, $imei2)) {
        echo "WARN no={$sheetNo}: IMEI2 {$imei2} already used — clearing IMEI2\n";
        $imei2 = null;
    }

    $name = trim((string) ($p['name'] ?? ''));
    $h2 = trim((string) ($p['handover2_person'] ?? ''));
    $h3 = trim((string) ($p['handover3_person'] ?? ''));
    $on1 = normalizeDate(is_string($p['handed_over_on'] ?? null) ? (string) $p['handed_over_on'] : null);
    $on2 = normalizeDate(is_string($p['handover2_on'] ?? null) ? (string) $p['handover2_on'] : null);
    $on3 = normalizeDate(is_string($p['handover3_on'] ?? null) ? (string) $p['handover3_on'] : null);
    $ret1 = normalizeDate(is_string($p['return_date'] ?? null) ? (string) $p['return_date'] : null);
    $ret2 = normalizeDate(is_string($p['handover2_return'] ?? null) ? (string) $p['handover2_return'] : null);
    $ret3 = normalizeDate(is_string($p['handover3_return'] ?? null) ? (string) $p['handover3_return'] : null);

    $locCode = inferLocationCode($companyCode, $name, $h2 . ' ' . $h3);
    $locationId = $locationsByCompany[$companyId][$locCode]
        ?? (array_values($locationsByCompany[$companyId] ?? [])[0] ?? null);

    // Current holder = last person still open (no return)
    $allocated = null;
    $allocatedOn = null;
    $phoneNo = isset($p['phone_no']) && $p['phone_no'] !== '' ? (string) $p['phone_no'] : null;
    if ($name !== '' && $ret1 === null) {
        $allocated = $name;
        $allocatedOn = $on1;
    }
    if ($h2 !== '') {
        if ($ret2 === null) {
            $allocated = $h2;
            $allocatedOn = $on2 ?? $allocatedOn;
            if (! empty($p['handover2_phone'])) {
                $phoneNo = (string) $p['handover2_phone'];
            }
        } elseif ($allocated === $name) {
            // first returned into h2 who also returned — clear unless h3 open
            $allocated = null;
            $allocatedOn = null;
        }
    }
    if ($h3 !== '') {
        if ($ret3 === null) {
            $allocated = $h3;
            $allocatedOn = $on3 ?? $allocatedOn;
            if (! empty($p['handover3_phone'])) {
                $phoneNo = (string) $p['handover3_phone'];
            }
        }
    }

    $status = $allocated ? 'deployed' : 'available';
    $accessories = trim((string) ($p['remark_items'] ?? $p['others'] ?? ''));
    $notesParts = array_filter([
        ! empty($p['code']) ? 'Condition: ' . $p['code'] : null,
        ! empty($p['return_remark']) ? 'Return remark: ' . $p['return_remark'] : null,
        ! empty($p['handover2_remark']) ? 'H2 remark: ' . $p['handover2_remark'] : null,
        ! empty($p['handover3_remark']) ? 'H3 remark: ' . $p['handover3_remark'] : null,
        ! empty($p['location']) ? 'Excel company: ' . $p['location'] : null,
        'Excel Book1 No: ' . $sheetNo,
        'Old stock import',
    ]);
    $notes = implode("\n", $notesParts);

    $brand = isset($p['brand']) ? (string) $p['brand'] : null;
    if ($brand !== null) {
        $brand = ucwords(strtolower($brand));
    }

    try {
        $assetTag = nextOldPhoneTag($pdo, $companyId, $companyCode);
        $pdo->beginTransaction();
        $insert->execute([
            'company_id' => $companyId,
            'location_id' => $locationId,
            'asset_tag' => $assetTag,
            'serial_number' => $serial,
            'brand' => $brand,
            'model' => isset($p['model']) ? trim((string) $p['model']) : null,
            'status' => $status,
            'pc_name' => $allocated ?: ($name !== '' ? $name : $assetTag),
            'imei_number' => $imei1,
            'imei_number_2' => $imei2,
            'phone_number' => $phoneNo,
            'condition_code' => isset($p['code']) ? (string) $p['code'] : 'Used',
            'accessories' => $accessories !== '' ? $accessories : null,
            'notes' => $notes !== '' ? $notes : null,
            'first_handover_person' => $name !== '' ? $name : null,
            'handed_over_on' => $on1,
            'asset_return_date' => $ret1,
            'handover_person_1' => $name !== '' ? $name : null,
            'handover_person_2' => $h2 !== '' ? $h2 : null,
            'handover_person_3' => $h3 !== '' ? $h3 : null,
            'handover_person_4' => null,
            'handover_on_1' => $on1,
            'handover_on_2' => $on2,
            'handover_on_3' => $on3,
            'handover_on_4' => null,
            'original_assigned_person' => $name !== '' ? $name : null,
            'original_assigned_on' => $on1,
            'allocated_person' => $allocated,
            'allocated_on' => $allocatedOn,
        ]);
        $row = $insert->fetch(PDO::FETCH_ASSOC);
        $assetId = (int) $row['id'];

        $chain = [];
        if ($name !== '' && $on1) {
            $chain[] = [
                'person' => $name,
                'date' => $on1,
                'return' => $ret1,
                'remarks' => $accessories !== '' ? $accessories : null,
            ];
        }
        if ($h2 !== '' && $on2) {
            $chain[] = [
                'person' => $h2,
                'date' => $on2,
                'return' => $ret2,
                'remarks' => isset($p['handover2_remark']) ? (string) $p['handover2_remark'] : null,
            ];
        }
        if ($h3 !== '' && $on3) {
            $chain[] = [
                'person' => $h3,
                'date' => $on3,
                'return' => $ret3,
                'remarks' => isset($p['handover3_remark']) ? (string) $p['handover3_remark'] : null,
            ];
        }

        $last = count($chain) - 1;
        foreach ($chain as $i => $h) {
            $isOpen = $i === $last && ($h['return'] === null) && $allocated !== null;
            $ret = $h['return'];
            if (! $isOpen && $ret === null && isset($chain[$i + 1])) {
                $ret = date('Y-m-d', strtotime($chain[$i + 1]['date'] . ' -1 day'));
            }
            insertHandover(
                $pdo,
                $companyId,
                $assetId,
                $h['person'],
                $h['date'],
                $isOpen,
                $isOpen ? null : $ret,
                $h['remarks']
            );
        }

        $pdo->commit();
        echo "OK {$companyCode} {$row['asset_tag']} no={$sheetNo} → " . ($allocated ?? 'available') . "\n";
        $inserted++;
        $byCompany[$companyCode]++;
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        fwrite(STDERR, "ERR no={$sheetNo}: {$e->getMessage()}\n");
        $errors++;
    }
}

echo "\nDone. inserted={$inserted} skipped={$skipped} errors={$errors}\n";
echo "By company: ITL={$byCompany['IT']} ISP={$byCompany['ISP']} IMS={$byCompany['IMS']}\n";

$check = $pdo->query(
    "SELECT asset_tag, brand, model, allocated_person, status, is_legacy
     FROM mobile_phones
     WHERE is_legacy = TRUE
     ORDER BY asset_tag"
);
echo "\nOld stock phones now in DB:\n";
foreach ($check->fetchAll(PDO::FETCH_ASSOC) as $r) {
    echo '  ' . json_encode($r, JSON_UNESCAPED_UNICODE) . "\n";
}
