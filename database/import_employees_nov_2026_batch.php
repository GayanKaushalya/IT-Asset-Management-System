<?php

declare(strict_types=1);

/**
 * Upsert Nov 2026 new-joiner batch into employees.
 * Gender/title and EPF left blank as provided.
 * Usage: php database/import_employees_nov_2026_batch.php
 */

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;

$jsonPath = __DIR__ . '/imports/employees_nov_2026_batch.json';
if (! is_file($jsonPath)) {
    fwrite(STDERR, "Missing {$jsonPath}\n");
    exit(1);
}

$rows = json_decode((string) file_get_contents($jsonPath), true);
if (! is_array($rows) || $rows === []) {
    fwrite(STDERR, "No employee rows in JSON\n");
    exit(1);
}

$pdo = Connection::make(itam_config()['db']);

$codeToId = [];
foreach ($pdo->query('SELECT id, code FROM companies')->fetchAll(PDO::FETCH_ASSOC) as $c) {
    $codeToId[(string) $c['code']] = (int) $c['id'];
}

$findByStaffCompany = $pdo->prepare(
    'SELECT id FROM employees WHERE company_id = :cid AND staff_id = :sid LIMIT 1'
);
$upd = $pdo->prepare(
    'UPDATE employees SET
        name = :name,
        title = :title,
        epf_number = :epf_number,
        employment_status = :employment_status,
        directory_tag = :directory_tag,
        designation = :designation,
        work_location = :work_location,
        department_name = :department_name,
        is_active = TRUE,
        updated_at = NOW()
     WHERE id = :id'
);
$ins = $pdo->prepare(
    'INSERT INTO employees (
        company_id, staff_id, name, title, epf_number, employment_status,
        directory_tag, designation, work_location, department_name, is_active
     ) VALUES (
        :company_id, :staff_id, :name, :title, :epf_number, :employment_status,
        :directory_tag, :designation, :work_location, :department_name, TRUE
     )'
);

$inserted = 0;
$updated = 0;
$skip = 0;

$pdo->beginTransaction();
try {
    foreach ($rows as $r) {
        $code = strtoupper(trim((string) ($r['company_code'] ?? 'IT')));
        if ($code === 'ITL' || $code === 'FOTON') {
            $code = 'IT';
        }
        if (! isset($codeToId[$code])) {
            echo "Skip unknown company {$code}: {$r['name']}\n";
            $skip++;
            continue;
        }

        $companyId = $codeToId[$code];
        $name = trim((string) ($r['name'] ?? ''));
        $staffId = trim((string) ($r['staff_id'] ?? ''));
        if ($name === '' || $staffId === '') {
            $skip++;
            continue;
        }

        $status = trim((string) ($r['employment_status'] ?? 'Probation')) ?: 'Probation';
        $titleRaw = $r['title'] ?? null;
        $title = is_string($titleRaw) ? trim($titleRaw) : '';
        $title = $title !== '' ? $title : null;

        $epfRaw = $r['epf_number'] ?? null;
        $epf = is_string($epfRaw) || is_numeric($epfRaw) ? trim((string) $epfRaw) : '';
        $epf = $epf !== '' ? $epf : null;

        $bind = [
            'company_id' => $companyId,
            'staff_id' => $staffId,
            'name' => $name,
            'title' => $title,
            'epf_number' => $epf,
            'employment_status' => $status,
            'directory_tag' => $status,
            'designation' => trim((string) ($r['designation'] ?? '')) ?: null,
            'work_location' => trim((string) ($r['work_location'] ?? '')) ?: null,
            'department_name' => trim((string) ($r['department_name'] ?? '')) ?: null,
        ];

        $findByStaffCompany->execute(['cid' => $companyId, 'sid' => $staffId]);
        $existingId = $findByStaffCompany->fetchColumn();

        if ($existingId) {
            $upd->execute([
                'id' => (int) $existingId,
                'name' => $bind['name'],
                'title' => $bind['title'],
                'epf_number' => $bind['epf_number'],
                'employment_status' => $bind['employment_status'],
                'directory_tag' => $bind['directory_tag'],
                'designation' => $bind['designation'],
                'work_location' => $bind['work_location'],
                'department_name' => $bind['department_name'],
            ]);
            $updated++;
            echo "Updated [{$code}] {$staffId} — {$name}\n";
        } else {
            $ins->execute($bind);
            $inserted++;
            echo "Inserted [{$code}] {$staffId} — {$name}\n";
        }
    }
    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fwrite(STDERR, 'Import failed: ' . $e->getMessage() . "\n");
    exit(1);
}

echo "\nDone. inserted={$inserted} updated={$updated} skipped={$skip}\n";
