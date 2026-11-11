<?php

declare(strict_types=1);

/**
 * Quick DB connection test (local Postgres or Supabase).
 * Run: .\run.ps1 test
 */

require dirname(__DIR__) . '/bootstrap.php';
require dirname(__DIR__) . '/config/load_config.php';

use Indra\Itam\Database\Connection;

$config = itam_config();

echo "Connecting to database...\n";

try {
    $pdo = Connection::make($config['db']);
    $version = $pdo->query('SELECT version()')->fetchColumn();
    echo "OK — connected.\n";
    echo "Server: " . substr((string) $version, 0, 80) . "...\n";

    $companies = $pdo->query('SELECT code, name FROM companies ORDER BY id')->fetchAll();
    echo "Companies: " . count($companies) . "\n";
    foreach ($companies as $c) {
        echo "  - {$c['code']}: {$c['name']}\n";
    }

    $users = $pdo->query('SELECT id, email, role FROM users ORDER BY id')->fetchAll();
    echo "Users: " . count($users) . "\n";
    foreach ($users as $u) {
        echo "  - id={$u['id']} {$u['email']} ({$u['role']})\n";
    }

    echo "\nDatabase is connected to the system.\n";
} catch (Throwable $e) {
    echo "FAILED: " . $e->getMessage() . "\n";
    echo "\nCheck:\n";
    echo "1. PostgreSQL service is running (postgresql-x64-18)\n";
    echo "2. backend/config/config.php host/user/pass/name are correct\n";
    echo "3. Database 'itams' exists and schema was applied\n";
    echo "4. PHP has pdo_pgsql enabled\n";
    exit(1);
}
