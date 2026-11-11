<?php

declare(strict_types=1);

/**
 * Extract unique departments from employees_from_for_it_new.json
 * and upsert into departments for ITL (IT), IMS, and ISP.
 *
 * Usage: php database/import_departments_from_employees.php
 */

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;

$jsonPath = __DIR__ . '/imports/employees_from_for_it_new.json';
if (! is_file($jsonPath)) {
    fwrite(STDERR, "Missing {$jsonPath}\n");
    exit(1);
}

$rows = json_decode((string) file_get_contents($jsonPath), true);
if (! is_array($rows)) {
    fwrite(STDERR, "Invalid JSON\n");
    exit(1);
}

/** @return string */
function deptCodeFromName(string $name): string
{
    $code = strtoupper(trim($name));
    $code = preg_replace('/[^A-Z0-9]+/', '_', $code) ?? '';
    $code = trim($code, '_');
    if ($code === '') {
        $code = 'DEPT';
    }
    if (strlen($code) > 40) {
        $code = substr($code, 0, 40);
        $code = rtrim($code, '_');
    }
    return $code;
}

$pdo = Connection::make(itam_config()['db']);

$codeToId = [];
foreach ($pdo->query('SELECT id, code FROM companies')->fetchAll(PDO::FETCH_ASSOC) as $c) {
    $codeToId[(string) $c['code']] = (int) $c['id'];
}

/** @var array<string, array<string, true>> $byCompany name => true */
$byCompany = [];
foreach ($rows as $r) {
    $co = (string) ($r['company_code'] ?? 'IT');
    if ($co === 'ITL') {
        $co = 'IT';
    }
    if (! in_array($co, ['IT', 'IMS', 'ISP'], true)) {
        continue;
    }
    $name = trim((string) ($r['department_name'] ?? ''));
    if ($name === '') {
        continue;
    }
    $byCompany[$co][$name] = true;
}

$findByName = $pdo->prepare(
    'SELECT id, code, is_active FROM departments
     WHERE company_id = :cid AND lower(btrim(name)) = lower(btrim(:name))
     LIMIT 1'
);
$findByCode = $pdo->prepare(
    'SELECT id FROM departments WHERE company_id = :cid AND code = :code LIMIT 1'
);
$ins = $pdo->prepare(
    'INSERT INTO departments (company_id, location_id, code, name, is_active)
     VALUES (:cid, NULL, :code, :name, TRUE)'
);
$reactivate = $pdo->prepare(
    'UPDATE departments SET is_active = TRUE, name = :name, updated_at = NOW() WHERE id = :id'
);

$inserted = 0;
$reactivated = 0;
$exists = 0;

foreach (['IT', 'IMS', 'ISP'] as $co) {
    $cid = $codeToId[$co] ?? 0;
    if ($cid < 1) {
        echo "Skip company {$co} — not found\n";
        continue;
    }
    $names = array_keys($byCompany[$co] ?? []);
    sort($names, SORT_NATURAL | SORT_FLAG_CASE);
    echo "=== {$co} (" . count($names) . " departments) ===\n";

    foreach ($names as $name) {
        $findByName->execute(['cid' => $cid, 'name' => $name]);
        $row = $findByName->fetch(PDO::FETCH_ASSOC);
        if ($row) {
            $active = $row['is_active'] === true || $row['is_active'] === 't' || $row['is_active'] === '1'
                || $row['is_active'] === 1;
            if (! $active) {
                $reactivate->execute(['name' => $name, 'id' => (int) $row['id']]);
                $reactivated++;
                echo "  reactivated: {$name}\n";
            } else {
                $exists++;
                echo "  exists: {$name}\n";
            }
            continue;
        }

        $base = deptCodeFromName($name);
        $code = $base;
        $n = 2;
        while (true) {
            $findByCode->execute(['cid' => $cid, 'code' => $code]);
            if (! $findByCode->fetchColumn()) {
                break;
            }
            $suffix = '_' . $n;
            $code = substr($base, 0, max(1, 40 - strlen($suffix))) . $suffix;
            $n++;
        }

        $ins->execute(['cid' => $cid, 'code' => $code, 'name' => $name]);
        $inserted++;
        echo "  + {$code} · {$name}\n";
    }
}

echo "\nInserted: {$inserted}\nReactivated: {$reactivated}\nAlready active: {$exists}\n";
