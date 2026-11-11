<?php

declare(strict_types=1);

/**
 * Seed ITL Foton locations: Kandy / Kelaniya / Ja-ela - Foton
 * Usage: php database/run_seed_itl_foton_locations.php
 */

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;

$pdo = Connection::make(itam_config()['db']);
$sql = file_get_contents(__DIR__ . '/migrations/seed_itl_foton_locations.sql');
if ($sql === false) {
    fwrite(STDERR, "Missing migration SQL\n");
    exit(1);
}

$pdo->exec($sql);

$stmt = $pdo->query(
    "SELECT l.code, l.name, l.city
     FROM locations l
     JOIN companies c ON c.id = l.company_id
     WHERE c.code = 'IT' AND l.code LIKE 'FOTON_%'
     ORDER BY l.name"
);
$rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
echo "ITL Foton locations:\n";
foreach ($rows as $r) {
    echo "  {$r['code']} — {$r['name']} ({$r['city']})\n";
}
echo 'Done (' . count($rows) . ")\n";
