<?php

declare(strict_types=1);

namespace Indra\Itam\Services;

use PDO;
use RuntimeException;

final class BackupService
{
    public function __construct(
        private readonly PDO $pdo,
        private readonly string $backupDir,
        private readonly string $sourceHost = 'local',
    ) {
        if (! is_dir($this->backupDir) && ! mkdir($this->backupDir, 0775, true) && ! is_dir($this->backupDir)) {
            throw new RuntimeException('Cannot create backups directory');
        }
    }

    public function directory(): string
    {
        return $this->backupDir;
    }

    /**
     * @return array{file:string,manifest:string,bytes:int,total_rows:int,tables:array<string,int>}
     */
    public function create(): array
    {
        $stamp = date('Ymd_His');
        $base = "itams_local_backup_{$stamp}";
        $outFile = $this->backupDir . DIRECTORY_SEPARATOR . "{$base}.sql";
        $manifestFile = $this->backupDir . DIRECTORY_SEPARATOR . "{$base}_manifest.json";

        $fh = fopen($outFile, 'wb');
        if ($fh === false) {
            throw new RuntimeException('Cannot write backup file');
        }

        $write = static function ($fh, string $line): void {
            fwrite($fh, $line);
        };

        $write($fh, "-- ITAMS Postgres data backup\n");
        $write($fh, '-- Created: ' . date('c') . "\n");
        $write($fh, '-- Source host: ' . $this->sourceHost . "\n");
        $write($fh, "-- Format: TRUNCATE + INSERT (public schema tables)\n");
        $write($fh, "SET session_replication_role = replica;\n");
        $write($fh, "SET client_encoding = 'UTF8';\n\n");

        $tables = $this->pdo->query(
            "SELECT tablename
             FROM pg_tables
             WHERE schemaname = 'public'
             ORDER BY tablename"
        )->fetchAll(PDO::FETCH_COLUMN);

        if ($tables === []) {
            fclose($fh);
            @unlink($outFile);
            throw new RuntimeException('No public tables found');
        }

        $totalRows = 0;
        $tableCounts = [];

        foreach ($tables as $table) {
            $table = (string) $table;
            $quoted = '"' . str_replace('"', '""', $table) . '"';
            $colsStmt = $this->pdo->query(
                "SELECT column_name, data_type, udt_name
                 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = " . $this->pdo->quote($table) . '
                 ORDER BY ordinal_position'
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

            $rows = $this->pdo->query("SELECT * FROM {$quoted}")->fetchAll();
            $count = count($rows);
            $tableCounts[$table] = $count;
            $totalRows += $count;

            $write($fh, "--\n-- Table: {$table} ({$count} rows)\n--\n");
            $write($fh, "TRUNCATE TABLE {$quoted} CASCADE;\n");

            if ($count === 0) {
                $write($fh, "\n");
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
                        $vals[] = "'" . str_replace("'", "''", (string) $v) . "'";
                    }
                    $valuesSql[] = '(' . implode(', ', $vals) . ')';
                }
                $write($fh, "INSERT INTO {$quoted} ({$colList}) VALUES\n");
                $write($fh, implode(",\n", $valuesSql) . ";\n");
            }
            $write($fh, "\n");
        }

        $write($fh, "-- Reset sequences\n");
        $seqs = $this->pdo->query(
            "SELECT sequencename FROM pg_sequences WHERE schemaname = 'public' ORDER BY sequencename"
        )->fetchAll(PDO::FETCH_COLUMN);

        foreach ($seqs as $seq) {
            $seqName = (string) $seq;
            if (preg_match('/^(.+)_id_seq$/', $seqName, $m)) {
                $table = $m[1];
                $qTable = '"' . str_replace('"', '""', $table) . '"';
                try {
                    $max = $this->pdo->query("SELECT COALESCE(MAX(id), 1) FROM {$qTable}")->fetchColumn();
                    $write($fh, "SELECT setval('{$seqName}', " . (int) $max . ", true);\n");
                } catch (\Throwable) {
                    // skip
                }
            }
        }

        $write($fh, "\nSET session_replication_role = DEFAULT;\n");
        $write($fh, '-- Backup complete: ' . count($tables) . " tables, {$totalRows} rows\n");
        fclose($fh);

        $bytes = (int) (filesize($outFile) ?: 0);
        file_put_contents($manifestFile, json_encode([
            'created_at' => date('c'),
            'source_host' => $this->sourceHost,
            'file' => basename($outFile),
            'bytes' => $bytes,
            'tables' => $tableCounts,
            'total_rows' => $totalRows,
        ], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES));

        return [
            'file' => basename($outFile),
            'manifest' => basename($manifestFile),
            'bytes' => $bytes,
            'total_rows' => $totalRows,
            'tables' => $tableCounts,
        ];
    }

    /**
     * @return list<array{file:string,bytes:int,created_at:?string,total_rows:?int,tables:?array<string,int>}>
     */
    public function list(): array
    {
        $files = glob($this->backupDir . DIRECTORY_SEPARATOR . 'itams_*_backup_*.sql') ?: [];
        rsort($files, SORT_STRING);

        $out = [];
        foreach ($files as $path) {
            $name = basename($path);
            if (! $this->isSafeBackupName($name)) {
                continue;
            }
            $manifestPath = preg_replace('/\.sql$/', '_manifest.json', $path) ?: '';
            $meta = [
                'file' => $name,
                'bytes' => (int) (filesize($path) ?: 0),
                'created_at' => null,
                'total_rows' => null,
                'tables' => null,
            ];
            if (is_file($manifestPath)) {
                $json = json_decode((string) file_get_contents($manifestPath), true);
                if (is_array($json)) {
                    $meta['created_at'] = isset($json['created_at']) ? (string) $json['created_at'] : null;
                    $meta['total_rows'] = isset($json['total_rows']) ? (int) $json['total_rows'] : null;
                    $meta['tables'] = is_array($json['tables'] ?? null) ? $json['tables'] : null;
                    if (isset($json['bytes'])) {
                        $meta['bytes'] = (int) $json['bytes'];
                    }
                }
            }
            if ($meta['created_at'] === null) {
                $meta['created_at'] = date('c', (int) filemtime($path));
            }
            $out[] = $meta;
        }

        return $out;
    }

    public function resolvePath(string $fileName): string
    {
        $fileName = basename($fileName);
        if (! $this->isSafeBackupName($fileName)) {
            throw new RuntimeException('Invalid backup file name');
        }
        $path = $this->backupDir . DIRECTORY_SEPARATOR . $fileName;
        if (! is_file($path)) {
            throw new RuntimeException('Backup file not found');
        }
        return $path;
    }

    /**
     * Restore data from a backup SQL file (safe truncate, then inserts).
     *
     * @return array{tables_touched:int,statements:int}
     */
    public function restoreFromFile(string $path): array
    {
        if (! is_file($path)) {
            throw new RuntimeException('Backup file not found');
        }

        $raw = file_get_contents($path);
        if ($raw === false || $raw === '') {
            throw new RuntimeException('Backup file is empty');
        }

        // Remove per-table TRUNCATE CASCADE (they wipe already-loaded child data mid-restore)
        $raw = (string) preg_replace('/TRUNCATE TABLE "[^"]+" CASCADE;\s*/i', '', $raw);

        $tables = $this->pdo->query(
            "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
        )->fetchAll(PDO::FETCH_COLUMN);

        if ($tables === []) {
            throw new RuntimeException('No tables to restore into');
        }

        $quoted = array_map(
            static fn ($t) => '"' . str_replace('"', '""', (string) $t) . '"',
            $tables
        );

        $this->pdo->exec('SET session_replication_role = replica');
        $this->pdo->exec('TRUNCATE TABLE ' . implode(', ', $quoted) . ' RESTART IDENTITY CASCADE');

        // Execute remaining SQL in statement chunks
        $statements = 0;
        $buffer = '';
        $lines = preg_split("/\r\n|\n|\r/", $raw) ?: [];
        foreach ($lines as $line) {
            $trim = trim($line);
            if ($trim === '' || str_starts_with($trim, '--')) {
                continue;
            }
            // Skip session role / encoding (we set them ourselves)
            if (preg_match('/^SET\s+session_replication_role/i', $trim)
                || preg_match('/^SET\s+client_encoding/i', $trim)) {
                continue;
            }
            $buffer .= $line . "\n";
            if (str_ends_with($trim, ';')) {
                $sql = trim($buffer);
                $buffer = '';
                if ($sql === '') {
                    continue;
                }
                try {
                    $this->pdo->exec($sql);
                    $statements++;
                } catch (\Throwable $e) {
                    $this->pdo->exec('SET session_replication_role = DEFAULT');
                    throw new RuntimeException('Restore failed: ' . $e->getMessage());
                }
            }
        }

        $this->pdo->exec('SET session_replication_role = DEFAULT');

        // Fix sequences
        $seqs = $this->pdo->query(
            "SELECT c.oid::regclass::text AS seq,
                    quote_ident(n.nspname) || '.' || quote_ident(t.relname) AS tbl,
                    quote_ident(a.attname) AS col
             FROM pg_class c
             JOIN pg_depend d ON d.objid = c.oid AND d.deptype = 'a'
             JOIN pg_class t ON d.refobjid = t.oid
             JOIN pg_namespace n ON n.oid = t.relnamespace
             JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
             WHERE c.relkind = 'S' AND n.nspname = 'public'"
        )->fetchAll();

        foreach ($seqs as $r) {
            try {
                $this->pdo->exec(sprintf(
                    'SELECT setval(%s, COALESCE((SELECT MAX(%s) FROM %s), 1))',
                    $this->pdo->quote((string) $r['seq']),
                    $r['col'],
                    $r['tbl']
                ));
            } catch (\Throwable) {
                // skip
            }
        }

        return [
            'tables_touched' => count($tables),
            'statements' => $statements,
        ];
    }

    public function isSafeBackupName(string $name): bool
    {
        return (bool) preg_match('/^itams_[a-z0-9]+_backup_\d{8}_\d{6}\.sql$/i', $name);
    }
}
