<?php

declare(strict_types=1);

require dirname(__DIR__) . '/bootstrap.php';
require dirname(__DIR__) . '/config/load_config.php';

$c = itam_config()['db'];
$pass = (string) $c['pass'];
$host = (string) $c['host'];
$users = [(string) $c['user'], 'postgres'];

foreach ([5432, 6543] as $port) {
    foreach ($users as $user) {
        try {
            $pdo = new PDO(
                "pgsql:host={$host};port={$port};dbname=postgres;sslmode=require",
                $user,
                $pass,
                [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
            );
            echo "OK host={$host} port={$port} user={$user}\n";
            echo 'current_user=' . $pdo->query('select current_user')->fetchColumn() . "\n";
            exit(0);
        } catch (Throwable $e) {
            echo "FAIL port={$port} user={$user} => " . substr($e->getMessage(), 0, 120) . "\n";
        }
    }
}
exit(1);
