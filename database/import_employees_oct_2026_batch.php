<?php

declare(strict_types=1);

/**
 * Upsert Oct 2026 new-joiner batch into employees.
 * Usage: php database/import_employees_oct_2026_batch.php
 */

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;

$jsonPath = __DIR__ . '/imports/employees_oct_2026_batch.json';
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
$findByNameCompany = $pdo->prepare(
    'SELECT id, staff_id FROM employees
     WHERE company_id = :cid AND lower(btrim(name)) = lower(btrim(:name))
     ORDER BY id DESC LIMIT 1'
);
$upd = $pdo->prepare(
    'UPDATE employees SET
        staff_id = :staff_id,
        name = :name,
        title = :title,
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
        company_id, staff_id, name, title, employment_status,
        directory_tag, designation, work_location, department_name, is_active
     ) VALUES (
        :company_id, :staff_id, :name, :title, :employment_status,
        :directory_tag, :designation, :work_location, :department_name, TRUE
     )'
);

function nextTempStaffId(PDO $pdo, int $companyId, string $companyCode): string
{
    $prefix = match ($companyCode) {
        'IT' => 'TEMP-ITL-',
        'IMS' => 'TEMP-IMS-',
        'ISP' => 'TEMP-ISP-',
        default => 'TEMP-',
    };
    $stmt = $pdo->prepare(
        "SELECT COALESCE(MAX(
            CAST(NULLIF(substring(staff_id from '([0-9]+)$'), '') AS INTEGER)
         ), 0)
         FROM employees
         WHERE company_id = :cid AND staff_id LIKE :pfx"
    );
    $stmt->execute(['cid' => $companyId, 'pfx' => $prefix . '%']);
    $next = ((int) $stmt->fetchColumn()) + 1;

    return $prefix . str_pad((string) $next, 4, '0', STR_PAD_LEFT);
}

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
        if ($name === '') {
            $skip++;
            continue;
        }

        $staffId = trim((string) ($r['staff_id'] ?? ''));
        if ($staffId === '') {
            $staffId = nextTempStaffId($pdo, $companyId, $code);
        }

        $title = trim((string) ($r['title'] ?? ''));
        if (! in_array($title, ['Mr', 'Ms', 'Mrs'], true)) {
            $gender = strtolower(trim((string) ($r['gender'] ?? '')));
            $title = $gender === 'female' ? 'Ms' : 'Mr';
        }

        $status = trim((string) ($r['employment_status'] ?? 'Probation'));
        if ($status === '') {
            $status = 'Probation';
        }
        $tag = trim((string) ($r['directory_tag'] ?? $status));
        if ($tag === '') {
            $tag = $status;
        }

        $bind = [
            'company_id' => $companyId,
            'staff_id' => $staffId,
            'name' => $name,
            'title' => $title,
            'employment_status' => $status,
            'directory_tag' => $tag,
            'designation' => trim((string) ($r['designation'] ?? '')) ?: null,
            'work_location' => trim((string) ($r['work_location'] ?? '')) ?: null,
            'department_name' => trim((string) ($r['department_name'] ?? '')) ?: null,
        ];

        $existingId = null;
        $findByStaffCompany->execute(['cid' => $companyId, 'sid' => $staffId]);
        $byStaff = $findByStaffCompany->fetchColumn();
        if ($byStaff) {
            $existingId = (int) $byStaff;
        } else {
            $findByNameCompany->execute(['cid' => $companyId, 'name' => $name]);
            $byName = $findByNameCompany->fetch(PDO::FETCH_ASSOC);
            if ($byName) {
                $existingId = (int) $byName['id'];
                // Keep existing staff_id if the import row had none / temp would collide
                if (trim((string) ($r['staff_id'] ?? '')) === '') {
                    $bind['staff_id'] = (string) $byName['staff_id'];
                }
            }
        }

        if ($existingId) {
            $upd->execute([
                'id' => $existingId,
                'staff_id' => $bind['staff_id'],
                'name' => $bind['name'],
                'title' => $bind['title'],
                'employment_status' => $bind['employment_status'],
                'directory_tag' => $bind['directory_tag'],
                'designation' => $bind['designation'],
                'work_location' => $bind['work_location'],
                'department_name' => $bind['department_name'],
            ]);
            $updated++;
            echo "Updated [{$code}] {$bind['staff_id']} — {$name}\n";
        } else {
            $ins->execute($bind);
            $inserted++;
            echo "Inserted [{$code}] {$bind['staff_id']} — {$name}\n";
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
