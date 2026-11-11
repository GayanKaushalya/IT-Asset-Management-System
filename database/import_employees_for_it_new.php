<?php

declare(strict_types=1);

/**
 * Upsert full HR directory from database/imports/employees_from_for_it_new.json
 * (past + present). Titles from gender; directory_tag/status = Current|Probation|Former.
 *
 * Usage: php database/import_employees_for_it_new.php
 */

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;

$jsonPath = __DIR__ . '/imports/employees_from_for_it_new.json';
if (! is_file($jsonPath)) {
    fwrite(STDERR, "Missing {$jsonPath} — run: python database/imports/_convert_for_it_new.py\n");
    exit(1);
}

$rows = json_decode((string) file_get_contents($jsonPath), true);
if (! is_array($rows) || $rows === []) {
    fwrite(STDERR, "No employee rows in JSON\n");
    exit(1);
}

$pdo = Connection::make(itam_config()['db']);

// Optional tag column for clearer filtering (mirrors employment_status for this import)
try {
    $pdo->exec(
        'ALTER TABLE employees ADD COLUMN IF NOT EXISTS directory_tag VARCHAR(40)'
    );
} catch (Throwable) {
    // ignore if no permission / already exists via other path
}

$codeToId = [];
foreach ($pdo->query('SELECT id, code FROM companies')->fetchAll(PDO::FETCH_ASSOC) as $c) {
    $codeToId[(string) $c['code']] = (int) $c['id'];
}

$findByStaff = $pdo->prepare('SELECT id, company_id FROM employees WHERE staff_id = :sid LIMIT 1');
$upd = $pdo->prepare(
    'UPDATE employees SET
        company_id = :company_id,
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
$byCompany = [];
$byTag = [];

$pdo->beginTransaction();
try {
    foreach ($rows as $r) {
        $code = (string) ($r['company_code'] ?? 'IT');
        if ($code === 'ITL' || $code === 'FOTON') {
            $code = 'IT';
        }
        if (! isset($codeToId[$code])) {
            echo "Skip unknown company {$code} staff {$r['staff_id']}\n";
            $skip++;
            continue;
        }

        $staffId = trim((string) ($r['staff_id'] ?? ''));
        $name = trim((string) ($r['name'] ?? ''));
        if ($staffId === '' || $name === '') {
            $skip++;
            continue;
        }

        $title = trim((string) ($r['title'] ?? ''));
        if (! in_array($title, ['Mr', 'Ms', 'Mrs'], true)) {
            $title = 'Mr';
        }

        $status = trim((string) ($r['employment_status'] ?? 'Current'));
        if ($status === 'ExEmployee' || $status === 'Ex-employee') {
            $status = 'Former';
        }
        $tag = trim((string) ($r['directory_tag'] ?? $status));
        if ($tag === '') {
            $tag = $status;
        }

        $bind = [
            'company_id' => $codeToId[$code],
            'name' => $name,
            'title' => $title,
            'epf_number' => ($r['epf_number'] ?? null) !== null && (string) $r['epf_number'] !== ''
                ? (string) $r['epf_number']
                : null,
            'employment_status' => $status,
            'directory_tag' => $tag,
            'designation' => ($r['designation'] ?? null) !== null && (string) $r['designation'] !== ''
                ? (string) $r['designation']
                : null,
            'work_location' => ($r['work_location'] ?? null) !== null && (string) $r['work_location'] !== ''
                ? (string) $r['work_location']
                : null,
            'department_name' => ($r['department_name'] ?? null) !== null && (string) $r['department_name'] !== ''
                ? (string) $r['department_name']
                : null,
        ];

        $findByStaff->execute(['sid' => $staffId]);
        $existing = $findByStaff->fetch(PDO::FETCH_ASSOC);
        if ($existing) {
            $upd->execute($bind + ['id' => (int) $existing['id']]);
            $updated++;
        } else {
            $ins->execute($bind + ['staff_id' => $staffId]);
            $inserted++;
        }

        $byCompany[$code] = ($byCompany[$code] ?? 0) + 1;
        $byTag[$tag] = ($byTag[$tag] ?? 0) + 1;
    }
    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fwrite(STDERR, 'Import failed: ' . $e->getMessage() . "\n");
    exit(1);
}

echo "Inserted: {$inserted}\n";
echo "Updated: {$updated}\n";
echo "Skipped: {$skip}\n";
echo "By company:\n";
foreach ($byCompany as $c => $n) {
    echo "  {$c}: {$n}\n";
}
echo "By tag:\n";
foreach ($byTag as $t => $n) {
    echo "  {$t}: {$n}\n";
}
$total = (int) $pdo->query('SELECT COUNT(*) FROM employees WHERE is_active = TRUE')->fetchColumn();
echo "Active employees total: {$total}\n";
