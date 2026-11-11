<?php

declare(strict_types=1);

/**
 * Seed branch locations for ITL / ISP / IMS.
 * Usage: php database/run_seed_branch_locations.php
 */

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;

$pdo = Connection::make(itam_config()['db']);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

$sqlFile = __DIR__ . '/migrations/seed_branch_locations.sql';
$sql = file_get_contents($sqlFile);
if ($sql === false) {
    fwrite(STDERR, "Missing migration: {$sqlFile}\n");
    exit(1);
}

echo "Seeding branch locations...\n";
$pdo->exec($sql);
echo "OK: locations seeded.\n\n";

$stmt = $pdo->query(
    "SELECT c.code AS company, l.code AS loc_code, l.name, l.city
     FROM locations l
     JOIN companies c ON c.id = l.company_id
     WHERE c.code IN ('IT', 'ISP', 'IMS')
     ORDER BY c.code, l.name"
);

echo "Locations by company:\n";
$current = '';
foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) as $row) {
    if ($current !== $row['company']) {
        $current = $row['company'];
        $label = $current === 'IT' ? 'ITL (IT)' : $current;
        echo "\n  {$label}\n";
    }
    echo "    - {$row['name']}" . ($row['city'] ? " ({$row['city']})" : '') . "\n";
}

echo "\nDone.\n";
