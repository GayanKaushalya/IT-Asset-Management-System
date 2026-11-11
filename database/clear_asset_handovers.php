<?php

declare(strict_types=1);

/**
 * Delete ALL records from Asset Handovers tab only
 * (asset_handovers + checklist). Does not delete assets.
 *
 * Run: C:\xampp\php\php.exe database/clear_asset_handovers.php
 */

$root = dirname(__DIR__);
$config = require $root . '/backend/config/config.php';
$db = $config['db'];
$dsn = sprintf(
    'pgsql:host=%s;port=%s;dbname=%s;sslmode=%s',
    $db['host'],
    $db['port'],
    $db['name'],
    $db['sslmode'] ?? 'require'
);
$pdo = new PDO($dsn, $db['user'], $db['pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

$before = (int) $pdo->query('SELECT COUNT(*) FROM asset_handovers')->fetchColumn();

$pdo->beginTransaction();
try {
    $checklist = $pdo->exec('DELETE FROM handover_peripheral_checklist');
    $handovers = $pdo->exec('DELETE FROM asset_handovers');
    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, 'FAILED: ' . $e->getMessage() . "\n");
    exit(1);
}

echo "OK: deleted {$handovers} handover(s) and {$checklist} checklist row(s) (was {$before}).\n";
echo "Assets themselves were not deleted.\n";
