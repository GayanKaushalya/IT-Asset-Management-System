<?php

declare(strict_types=1);

/**
 * Full data backup from configured Postgres (Supabase) → SQL file.
 * Usage: C:\xampp\php\php.exe database/backup_supabase.php
 */

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;

$cfg = itam_config()['db'];
$pdo = Connection::make($cfg);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);

$outDir = dirname(__DIR__) . DIRECTORY_SEPARATOR . 'backups';
if (! is_dir($outDir)) {
    mkdir($outDir, 0775, true);
}

$stamp = date('Ymd_His');
$outFile = $outDir . DIRECTORY_SEPARATOR . "itams_supabase_backup_{$stamp}.sql";
$fh = fopen($outFile, 'wb');
if ($fh === false) {
    fwrite(STDERR, "Cannot write {$outFile}\n");
    exit(1);
}

function w($fh, string $line): void
{
    fwrite($fh, $line);
}

$host = (string) ($cfg['host'] ?? '');
w($fh, "-- ITAMS Supabase / Postgres data backup\n");
w($fh, '-- Created: ' . date('c') . "\n");
w($fh, "-- Source host: {$host}\n");
w($fh, "-- Format: TRUNCATE + INSERT (public schema tables)\n");
w($fh, "SET session_replication_role = replica;\n");
w($fh, "SET client_encoding = 'UTF8';\n\n");

$tables = $pdo->query(
    "SELECT tablename
     FROM pg_tables
     WHERE schemaname = 'public'
     ORDER BY tablename"
)->fetchAll(PDO::FETCH_COLUMN);

if ($tables === []) {
    fwrite(STDERR, "No public tables found.\n");
    fclose($fh);
    exit(1);
}

// Disable FK checks via replica role; truncate children-safe with CASCADE list later
$totalRows = 0;
$tableCounts = [];

foreach ($tables as $table) {
    $quoted = '"' . str_replace('"', '""', (string) $table) . '"';
    $colsStmt = $pdo->query(
        "SELECT column_name, data_type, udt_name
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = " . $pdo->quote((string) $table) . "
         ORDER BY ordinal_position"
    );
    $columns = $colsStmt->fetchAll();
    if ($columns === []) {
        continue;
    }

    $colNames = array_map(static fn ($c) => (string) $c['column_name'], $columns);
    $colList = implode(', ', array_map(
        static fn ($c) => '"' . str_replace('"', '""', $c) . '"',
        $colNames
    ));

    $rows = $pdo->query("SELECT * FROM {$quoted}")->fetchAll();
    $count = count($rows);
    $tableCounts[(string) $table] = $count;
    $totalRows += $count;

    w($fh, "--\n-- Table: {$table} ({$count} rows)\n--\n");
    w($fh, "TRUNCATE TABLE {$quoted} CASCADE;\n");

    if ($count === 0) {
        w($fh, "\n");
        continue;
    }

    $batchSize = 200;
    for ($i = 0; $i < $count; $i += $batchSize) {
        $chunk = array_slice($rows, $i, $batchSize);
        $valuesSql = [];
        foreach ($chunk as $row) {
            $vals = [];
            foreach ($colNames as $col) {
                $v = $row[$col] ?? null;
                if ($v === null) {
                    $vals[] = 'NULL';
                    continue;
                }
                if (is_bool($v)) {
                    $vals[] = $v ? 'TRUE' : 'FALSE';
                    continue;
                }
                // PDO may return booleans as 't'/'f'
                if ($v === 't' || $v === 'f') {
                    $meta = null;
                    foreach ($columns as $c) {
                        if ($c['column_name'] === $col) {
                            $meta = $c;
                            break;
                        }
                    }
                    if ($meta && ($meta['data_type'] === 'boolean' || $meta['udt_name'] === 'bool')) {
                        $vals[] = $v === 't' ? 'TRUE' : 'FALSE';
                        continue;
                    }
                }
                if (is_int($v) || is_float($v)) {
                    $vals[] = (string) $v;
                    continue;
                }
                $s = (string) $v;
                $vals[] = "'" . str_replace("'", "''", $s) . "'";
            }
            $valuesSql[] = '(' . implode(', ', $vals) . ')';
        }
        w($fh, "INSERT INTO {$quoted} ({$colList}) VALUES\n");
        w($fh, implode(",\n", $valuesSql) . ";\n");
    }
    w($fh, "\n");
    echo "  {$table}: {$count} rows\n";
}

// Reset sequences to max(id) where possible
w($fh, "-- Reset sequences\n");
$seqs = $pdo->query(
    "SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename"
)->fetchAll(PDO::FETCH_COLUMN);

foreach ($seqs as $seq) {
    $seqName = (string) $seq;
    // Common pattern: tablename_id_seq
    if (preg_match('/^(.+)_id_seq$/', $seqName, $m)) {
        $table = $m[1];
        $qTable = '"' . str_replace('"', '""', $table) . '"';
        $qSeq = '"public"."' . str_replace('"', '""', $seqName) . '"';
        try {
            $max = $pdo->query("SELECT COALESCE(MAX(id), 1) FROM {$qTable}")->fetchColumn();
            w($fh, "SELECT setval('{$seqName}', " . (int) $max . ", true);\n");
        } catch (Throwable) {
            // skip
        }
    }
}

w($fh, "\nSET session_replication_role = DEFAULT;\n");
w($fh, "-- Backup complete: " . count($tables) . " tables, {$totalRows} rows\n");
fclose($fh);

$bytes = filesize($outFile);
$mb = $bytes !== false ? round($bytes / 1048576, 2) : 0;

$manifest = $outDir . DIRECTORY_SEPARATOR . "itams_supabase_backup_{$stamp}_manifest.json";
file_put_contents($manifest, json_encode([
    'created_at' => date('c'),
    'source_host' => $host,
    'file' => basename($outFile),
    'bytes' => $bytes,
    'tables' => $tableCounts,
    'total_rows' => $totalRows,
], JSON_PRETTY_PRINT));

echo "\nBackup OK\n";
echo "File: {$outFile}\n";
echo "Size: {$mb} MB\n";
echo "Tables: " . count($tables) . " | Rows: {$totalRows}\n";
echo "Manifest: {$manifest}\n";
