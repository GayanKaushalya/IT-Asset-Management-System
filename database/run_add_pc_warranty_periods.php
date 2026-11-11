<?php

declare(strict_types=1);

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;

$pdo = Connection::make(itam_config()['db']);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$sql = file_get_contents(__DIR__ . '/migrations/add_pc_warranty_periods.sql');
$pdo->exec($sql);
echo "OK: pcs warranty period columns ready.\n";
$cols = $pdo->query(
    "SELECT column_name FROM information_schema.columns
     WHERE table_name = 'pcs' AND column_name IN (
       'warranty_period', 'ups_warranty_period', 'ups_warranty_expires_on'
     ) ORDER BY column_name"
)->fetchAll(PDO::FETCH_COLUMN);
echo 'columns: ' . implode(', ', $cols) . PHP_EOL;
