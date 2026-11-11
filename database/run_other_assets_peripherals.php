<?php

declare(strict_types=1);

/**
 * Apply other_assets + peripherals migration.
 * Run: php database/run_other_assets_peripherals.php
 */

$root = dirname(__DIR__);
$config = require $root . '/backend/config/config.php';
$sqlFile = $root . '/database/migrations/other_assets_and_peripherals.sql';

$db = $config['db'];
$dsn = sprintf(
    'pgsql:host=%s;port=%s;dbname=%s;sslmode=%s',
    $db['host'],
    $db['port'],
    $db['name'],
    $db['sslmode'] ?? 'require'
);

$pdo = new PDO($dsn, $db['user'], $db['pass'], [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
]);

$sql = file_get_contents($sqlFile);
if ($sql === false) {
    fwrite(STDERR, "Cannot read migration file\n");
    exit(1);
}

$pdo->exec($sql);
echo "OK: other_assets columns + peripherals table + departments seeded.\n";
