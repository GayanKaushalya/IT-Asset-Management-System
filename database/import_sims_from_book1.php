<?php

declare(strict_types=1);

/**
 * Import Dialog SIM / mobile numbers from Book1.xlsx (via book1_sims.json)
 * into mobile_phones under the SIM company tab.
 * Does not modify the Excel file. Skips phones that already exist.
 *
 * Usage:
 *   python database/imports/_export_book1_sims.py
 *   php database/import_sims_from_book1.php
 */

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;

$pdo = Connection::make(itam_config()['db']);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

// Ensure SIM company + locations exist
$sqlFile = __DIR__ . '/migrations/add_sim_company.sql';
$pdo->exec(file_get_contents($sqlFile));
echo "SIM company ready.\n";

$jsonPath = __DIR__ . '/imports/book1_sims.json';
$raw = file_get_contents($jsonPath);
if ($raw === false) {
    fwrite(STDERR, "Missing {$jsonPath} — run imports/_export_book1_sims.py first\n");
    exit(1);
}

/** @var list<array<string, mixed>> $rows */
$rows = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);

$sim = $pdo->query("SELECT id FROM companies WHERE code = 'SIM' LIMIT 1")->fetch(PDO::FETCH_ASSOC);
if (! $sim) {
    fwrite(STDERR, "SIM company missing after migration\n");
    exit(1);
}
$companyId = (int) $sim['id'];

$loc = $pdo->prepare(
    'SELECT id FROM locations WHERE company_id = :c AND code = :code LIMIT 1'
);
$loc->execute(['c' => $companyId, 'code' => 'SIM_POOL']);
$locationId = (int) ($loc->fetchColumn() ?: 0);
if ($locationId < 1) {
    $loc->execute(['c' => $companyId, 'code' => 'KANDY_HO']);
    $locationId = (int) ($loc->fetchColumn() ?: 0);
}
if ($locationId < 1) {
    fwrite(STDERR, "No SIM location found\n");
    exit(1);
}

$dept = $pdo->prepare(
    'SELECT id FROM departments WHERE company_id = :c AND code = :code LIMIT 1'
);
$dept->execute(['c' => $companyId, 'code' => 'IT']);
$departmentId = ($dept->fetchColumn() ?: null);
$departmentId = $departmentId !== null ? (int) $departmentId : null;

$adminId = (int) ($pdo->query(
    "SELECT id FROM users WHERE role IN ('super_admin','it_admin') ORDER BY id ASC LIMIT 1"
)->fetchColumn() ?: 0);
if ($adminId < 1) {
    $adminId = (int) ($pdo->query('SELECT id FROM users ORDER BY id ASC LIMIT 1')->fetchColumn() ?: 1);
}

function normalizePhone(?string $p): string
{
    if ($p === null) {
        return '';
    }
    $digits = preg_replace('/\D+/', '', $p) ?? '';
    if (strlen($digits) === 9 && str_starts_with($digits, '7')) {
        return '0' . $digits;
    }
    if (strlen($digits) === 10 && str_starts_with($digits, '0')) {
        return $digits;
    }
    return $digits;
}

function parseDate(?string $v): ?string
{
    if ($v === null || trim($v) === '') {
        return null;
    }
    $v = trim($v);
    if (preg_match('/^no\s*invent/i', $v)) {
        return null;
    }
    if (preg_match('/^\d{4}-\d{2}-\d{2}/', $v)) {
        return substr($v, 0, 10);
    }
    $ts = strtotime($v);
    return $ts ? date('Y-m-d', $ts) : null;
}

function nextSimTag(PDO $pdo, int $companyId): string
{
    $stmt = $pdo->prepare(
        "SELECT COALESCE(MAX(
            CAST(NULLIF(substring(asset_tag from '[0-9]+$'), '') AS INTEGER)
         ), 0)
         FROM mobile_phones
         WHERE company_id = :company_id
           AND asset_tag ~ '^SIM-MB-[0-9]+$'"
    );
    $stmt->execute(['company_id' => $companyId]);
    $next = ((int) $stmt->fetchColumn()) + 1;
    return sprintf('SIM-MB-%04d', $next);
}

$existsStmt = $pdo->prepare(
    "SELECT id FROM mobile_phones
     WHERE company_id = :c
       AND regexp_replace(COALESCE(phone_number, ''), '\\D', '', 'g') = :digits
     LIMIT 1"
);

$insertAsset = $pdo->prepare(
    'INSERT INTO mobile_phones (
        company_id, location_id, department_id, asset_tag, serial_number,
        brand, model, status, pc_name, phone_number, accessories,
        has_charger, has_data_cable, has_back_cover,
        purchase_date, first_handover_person, handed_over_on,
        original_assigned_person, original_assigned_on,
        allocated_person, allocated_on,
        handover_person_1, handover_on_1,
        handover_person_2, handover_on_2,
        notes, created_by, updated_by, created_at, updated_at
     ) VALUES (
        :company_id, :location_id, :department_id, :asset_tag, :serial_number,
        :brand, :model, :status, :pc_name, :phone_number, :accessories,
        TRUE, TRUE, TRUE,
        :purchase_date, :first_person, :handed_on,
        :original_person, :original_on,
        :allocated_person, :allocated_on,
        :hp1, :ho1,
        :hp2, :ho2,
        :notes, :created_by, :updated_by, NOW(), NOW()
     ) RETURNING id'
);

$insertHandover = $pdo->prepare(
    'INSERT INTO asset_handovers (
        company_id, asset_id, asset_type, handover_date, assigned_person_name,
        assigned_by_it_staff_id, checkout_condition, checkout_remarks, is_open,
        return_date, return_received_by_id, return_condition, return_remarks,
        created_at, updated_at
     ) VALUES (
        :company_id, :asset_id, \'mobile_phone\', :handover_date, :person,
        :assigned_by, \'good\', :remarks, :is_open,
        :return_date, :return_received_by, :return_condition, :return_remarks,
        NOW(), NOW()
     )'
);

$inserted = 0;
$skipped = 0;
$errors = 0;

foreach ($rows as $row) {
    $phoneRaw = isset($row['phone_no']) ? (string) $row['phone_no'] : '';
    $phone = normalizePhone($phoneRaw);
    $person = trim((string) ($row['name'] ?? ''));
    if ($phone === '' && $person === '') {
        $skipped++;
        continue;
    }

    $digits = preg_replace('/\D+/', '', $phone) ?? '';
    if ($digits !== '') {
        $existsStmt->execute(['c' => $companyId, 'digits' => $digits]);
        if ($existsStmt->fetchColumn()) {
            echo "Skip existing phone {$phone}\n";
            $skipped++;
            continue;
        }
    }

    $issueDate = parseDate(isset($row['issue_date']) ? (string) $row['issue_date'] : null);
    $returnDate = parseDate(isset($row['return_date']) ? (string) $row['return_date'] : null);
    $h1 = trim((string) ($row['handover_1'] ?? ''));
    $h1Date = parseDate(isset($row['handover_1_date']) ? (string) $row['handover_1_date'] : null) ?: $issueDate;
    $h2 = trim((string) ($row['handover_2'] ?? ''));
    $h2Date = parseDate(isset($row['handover_2_date']) ? (string) $row['handover_2_date'] : null);

    $vendor = trim((string) ($row['vendor'] ?? 'Dialog')) ?: 'Dialog';
    $excelLoc = trim((string) ($row['location'] ?? ''));
    $remark = trim((string) ($row['remark'] ?? ''));

    $noteParts = [];
    if ($excelLoc !== '') {
        $noteParts[] = 'Excel location: ' . $excelLoc;
    }
    if ($remark !== '') {
        $noteParts[] = $remark;
    }
    if (! empty($row['package'])) {
        $noteParts[] = 'Package: ' . $row['package'];
    }
    if (! empty($row['rental'])) {
        $noteParts[] = 'Rental: ' . $row['rental'];
    }
    $notes = $noteParts !== [] ? implode(' | ', $noteParts) : null;

    // Currently assigned unless returned with no further open holder
    $currentPerson = $person;
    $currentOn = $issueDate;
    if ($h2 !== '') {
        $currentPerson = $h2;
        $currentOn = $h2Date ?: $h1Date ?: $issueDate;
    } elseif ($h1 !== '') {
        $currentPerson = $h1;
        $currentOn = $h1Date ?: $issueDate;
    }

    // Excel return date with no later custodian → Available / IT Department custody
    $isReturned = $returnDate !== null && $h1 === '' && $h2 === '';
    $status = $isReturned || $currentPerson === '' ? 'available' : 'deployed';
    $allocated = $status === 'available' ? 'IT Department' : $currentPerson;
    $original = $person !== '' ? $person : ($currentPerson !== '' ? $currentPerson : null);

    $tag = nextSimTag($pdo, $companyId);
    $serial = $phone !== '' ? ('SIM-' . $phone) : ('SIM-ROW-' . ($row['row_no'] ?? uniqid()));

    $bindHandover = static function (
        PDOStatement $stmt,
        int $companyId,
        int $assetId,
        string $handoverDate,
        string $person,
        int $assignedBy,
        ?string $remarks,
        bool $isOpen,
        ?string $retDate,
    ): void {
        $stmt->bindValue('company_id', $companyId, PDO::PARAM_INT);
        $stmt->bindValue('asset_id', $assetId, PDO::PARAM_INT);
        $stmt->bindValue('handover_date', $handoverDate);
        $stmt->bindValue('person', $person);
        $stmt->bindValue('assigned_by', $assignedBy, PDO::PARAM_INT);
        if ($remarks === null || $remarks === '') {
            $stmt->bindValue('remarks', null, PDO::PARAM_NULL);
        } else {
            $stmt->bindValue('remarks', $remarks);
        }
        $stmt->bindValue('is_open', $isOpen, PDO::PARAM_BOOL);
        if ($retDate === null || $retDate === '') {
            $stmt->bindValue('return_date', null, PDO::PARAM_NULL);
            $stmt->bindValue('return_received_by', null, PDO::PARAM_NULL);
            $stmt->bindValue('return_condition', null, PDO::PARAM_NULL);
            $stmt->bindValue('return_remarks', null, PDO::PARAM_NULL);
        } else {
            $stmt->bindValue('return_date', $retDate);
            $stmt->bindValue('return_received_by', $assignedBy, PDO::PARAM_INT);
            $stmt->bindValue('return_condition', 'good');
            $stmt->bindValue('return_remarks', 'Imported return from Book1');
        }
        $stmt->execute();
    };

    try {
        $pdo->beginTransaction();
        $insertAsset->execute([
            'company_id' => $companyId,
            'location_id' => $locationId,
            'department_id' => $departmentId,
            'asset_tag' => $tag,
            'serial_number' => $serial,
            'brand' => $vendor,
            'model' => 'SIM',
            'status' => $status,
            'pc_name' => $allocated,
            'phone_number' => $phone !== '' ? $phone : null,
            'accessories' => 'SIM card',
            'purchase_date' => $issueDate,
            'first_person' => $original,
            'handed_on' => $issueDate,
            'original_person' => $original,
            'original_on' => $issueDate,
            'allocated_person' => $allocated,
            'allocated_on' => $status === 'available' ? ($returnDate ?: $issueDate) : $currentOn,
            'hp1' => $original,
            'ho1' => $issueDate,
            'hp2' => $h1 !== '' ? $h1 : ($h2 !== '' ? $h2 : null),
            'ho2' => $h1 !== '' ? ($h1Date ?: $issueDate) : ($h2 !== '' ? ($h2Date ?: $issueDate) : null),
            'notes' => $notes,
            'created_by' => $adminId,
            'updated_by' => $adminId,
        ]);
        $assetId = (int) $insertAsset->fetchColumn();

        // Primary issue handover
        if ($original !== null && $original !== '') {
            $stillOpen = $status === 'deployed' && strcasecmp($allocated, $original) === 0;
            $bindHandover(
                $insertHandover,
                $companyId,
                $assetId,
                $issueDate ?: date('Y-m-d'),
                $original,
                $adminId,
                $remark !== '' ? $remark : null,
                $stillOpen,
                $stillOpen ? null : ($returnDate ?: ($h1Date ?: null)),
            );
        }

        if ($h1 !== '') {
            $h1Open = $status === 'deployed' && strcasecmp($allocated, $h1) === 0;
            $bindHandover(
                $insertHandover,
                $companyId,
                $assetId,
                $h1Date ?: ($issueDate ?: date('Y-m-d')),
                $h1,
                $adminId,
                null,
                $h1Open,
                $h1Open ? null : ($h2Date ?: $returnDate),
            );
        }

        if ($h2 !== '') {
            $h2Open = $status === 'deployed' && strcasecmp($allocated, $h2) === 0;
            $bindHandover(
                $insertHandover,
                $companyId,
                $assetId,
                $h2Date ?: ($h1Date ?: date('Y-m-d')),
                $h2,
                $adminId,
                null,
                $h2Open,
                $h2Open ? null : $returnDate,
            );
        }

        $pdo->commit();
        $inserted++;
        echo "OK {$tag} {$phone} -> {$allocated} ({$status})\n";
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        $errors++;
        fwrite(STDERR, "ERR phone={$phone}: {$e->getMessage()}\n");
    }
}

echo "Done. inserted={$inserted} skipped={$skipped} errors={$errors}\n";
