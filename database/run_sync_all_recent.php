<?php

declare(strict_types=1);

/**
 * Apply all recent ITAMS schema changes to the configured database
 * and print a verification report.
 *
 * Usage: php database/run_sync_all_recent.php
 */

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;

$pdo = Connection::make(itam_config()['db']);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

$sqlFile = __DIR__ . '/migrations/sync_all_recent_changes.sql';
$sql = file_get_contents($sqlFile);
if ($sql === false) {
    fwrite(STDERR, "Missing migration: {$sqlFile}\n");
    exit(1);
}

echo "Applying sync_all_recent_changes.sql...\n";
$pdo->exec($sql);
echo "OK: migration applied.\n\n";

function colExists(PDO $pdo, string $table, string $column): bool
{
    $stmt = $pdo->prepare(
        'SELECT 1 FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = :t AND column_name = :c
         LIMIT 1'
    );
    $stmt->execute(['t' => $table, 'c' => $column]);
    return (bool) $stmt->fetchColumn();
}

function tableExists(PDO $pdo, string $table): bool
{
    $stmt = $pdo->prepare(
        'SELECT 1 FROM information_schema.tables
         WHERE table_schema = current_schema() AND table_name = :t
         LIMIT 1'
    );
    $stmt->execute(['t' => $table]);
    return (bool) $stmt->fetchColumn();
}

$checks = [
    'companies has FOTON' => (bool) $pdo->query("SELECT 1 FROM companies WHERE code = 'FOTON' LIMIT 1")->fetchColumn(),
    'credential_type has wifi' => (bool) $pdo->query(
        "SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
         WHERE t.typname = 'credential_type' AND e.enumlabel = 'wifi' LIMIT 1"
    )->fetchColumn(),
    'email_accounts table' => tableExists($pdo, 'email_accounts'),
    'email_account_users table' => tableExists($pdo, 'email_account_users'),
];

$laptopCols = [
    'handover_person_1', 'handover_person_2', 'handover_person_3', 'handover_person_4',
    'handover_on_1', 'handover_on_2', 'handover_on_3', 'handover_on_4',
    'original_assigned_person', 'original_assigned_on', 'allocated_person', 'allocated_on',
];
$mobileCols = $laptopCols;

foreach ($laptopCols as $c) {
    $checks["laptops.{$c}"] = colExists($pdo, 'laptops', $c);
}
foreach ($mobileCols as $c) {
    $checks["mobile_phones.{$c}"] = colExists($pdo, 'mobile_phones', $c);
}

$checks['laptops.status column'] = colExists($pdo, 'laptops', 'status');
$checks['mobile_phones.status column'] = colExists($pdo, 'mobile_phones', 'status');
$checks['asset_status enum'] = (bool) $pdo->query(
    "SELECT 1 FROM pg_type WHERE typname = 'asset_status' LIMIT 1"
)->fetchColumn();

$ok = true;
echo "Verification:\n";
foreach ($checks as $label => $pass) {
    $mark = $pass ? 'OK' : 'MISSING';
    if (! $pass) {
        $ok = false;
    }
    echo "  [{$mark}] {$label}\n";
}

echo "\nStatus counts (laptops):\n";
foreach ($pdo->query('SELECT status, COUNT(*) AS n FROM laptops GROUP BY status ORDER BY status') as $row) {
    echo "  {$row['status']}: {$row['n']}\n";
}
echo "Status counts (mobile_phones):\n";
foreach ($pdo->query('SELECT status, COUNT(*) AS n FROM mobile_phones GROUP BY status ORDER BY status') as $row) {
    echo "  {$row['status']}: {$row['n']}\n";
}

if (! $ok) {
    fwrite(STDERR, "\nSome checks failed.\n");
    exit(1);
}

echo "\nDatabase is up to date with recent changes.\n";
