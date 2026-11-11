<?php

declare(strict_types=1);

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;

$pdo = Connection::make(itam_config()['db']);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$sql = file_get_contents(__DIR__ . '/migrations/add_pc_newly_purchased.sql');
$pdo->exec($sql);
echo "OK: pcs.newly_purchased column ready.\n";
$counts = $pdo->query(
    "SELECT newly_purchased, COUNT(*)::int AS n FROM pcs GROUP BY newly_purchased ORDER BY newly_purchased"
)->fetchAll(PDO::FETCH_ASSOC);
echo 'counts: ' . json_encode($counts) . PHP_EOL;
