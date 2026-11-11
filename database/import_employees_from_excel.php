<?php

declare(strict_types=1);

/**
 * Import employees from database/imports/employees_from_excel.json
 * Usage: php database/import_employees_from_excel.php
 */

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;

$jsonPath = __DIR__ . '/imports/employees_from_excel.json';
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
$pdo->exec(file_get_contents(__DIR__ . '/migrations/create_employees.sql'));

$companies = $pdo->query('SELECT id, code FROM companies')->fetchAll(PDO::FETCH_KEY_PAIR);
// FETCH_KEY_PAIR is id=>code; flip to code=>id
$codeToId = [];
foreach ($pdo->query('SELECT id, code FROM companies')->fetchAll(PDO::FETCH_ASSOC) as $c) {
    $codeToId[(string) $c['code']] = (int) $c['id'];
}

$ins = $pdo->prepare(
    'INSERT INTO employees (
        company_id, staff_id, name, epf_number, employment_status,
        designation, work_location, department_name, is_active, updated_at
     ) VALUES (
        :company_id, :staff_id, :name, :epf_number, :employment_status,
        :designation, :work_location, :department_name, TRUE, NOW()
     )
     ON CONFLICT (company_id, staff_id) DO UPDATE SET
        name = EXCLUDED.name,
        epf_number = EXCLUDED.epf_number,
        employment_status = EXCLUDED.employment_status,
        designation = EXCLUDED.designation,
        work_location = EXCLUDED.work_location,
        department_name = EXCLUDED.department_name,
        is_active = TRUE,
        updated_at = NOW()'
);

$ok = 0;
$skip = 0;
$byCompany = [];

foreach ($rows as $r) {
    $code = (string) ($r['company_code'] ?? 'IT');
    // Foton staff belong under ITL (Indra Traders) — not a separate company
    if ($code === 'FOTON') {
        $code = 'IT';
    }
    if (! isset($codeToId[$code])) {
        echo "Skip unknown company {$code} staff {$r['staff_id']}\n";
        $skip++;
        continue;
    }
    $ins->execute([
        'company_id' => $codeToId[$code],
        'staff_id' => (string) $r['staff_id'],
        'name' => (string) $r['name'],
        'epf_number' => $r['epf_number'] !== null && $r['epf_number'] !== '' ? (string) $r['epf_number'] : null,
        'employment_status' => (string) ($r['employment_status'] ?? 'Current'),
        'designation' => $r['designation'] !== null && $r['designation'] !== '' ? (string) $r['designation'] : null,
        'work_location' => $r['work_location'] !== null && $r['work_location'] !== '' ? (string) $r['work_location'] : null,
        'department_name' => $r['department_name'] !== null && $r['department_name'] !== '' ? (string) $r['department_name'] : null,
    ]);
    $ok++;
    $byCompany[$code] = ($byCompany[$code] ?? 0) + 1;
}

echo "Imported/updated: {$ok}\n";
echo "Skipped: {$skip}\n";
foreach ($byCompany as $c => $n) {
    echo "  {$c}: {$n}\n";
}
$count = (int) $pdo->query('SELECT COUNT(*) FROM employees')->fetchColumn();
echo "employees table total: {$count}\n";
