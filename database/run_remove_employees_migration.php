<?php

declare(strict_types=1);

/**
 * Apply remove_employee_requirement migration.
 * Run: C:\xampp\php\php.exe database\run_remove_employees_migration.php
 */

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;

$config = itam_config();
$pdo = Connection::make($config['db']);

$sql = file_get_contents(__DIR__ . '/migrations/remove_employee_requirement.sql');
if ($sql === false) {
    fwrite(STDERR, "Migration file missing\n");
    exit(1);
}

$pdo->exec($sql);
echo "OK: assigned_person_name added; assigned_employee_id is nullable.\n";
