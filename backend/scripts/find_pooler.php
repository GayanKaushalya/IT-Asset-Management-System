<?php

declare(strict_types=1);

/**
 * Tries common Supabase pooler regions using password from config.php
 * Run: C:\xampp\php\php.exe scripts\find_pooler.php
 */

require dirname(__DIR__) . '/bootstrap.php';
require dirname(__DIR__) . '/config/load_config.php';

$config = itam_config();
$pass = (string) ($config['db']['pass'] ?? '');
$ref = 'gviernohqccdjfiwjdjs';
$user = 'postgres.' . $ref;

$hosts = [
    'aws-0-ap-south-1.pooler.supabase.com',      // Mumbai (closest to Sri Lanka)
    'aws-0-ap-southeast-1.pooler.supabase.com',  // Singapore
    'aws-0-ap-northeast-1.pooler.supabase.com',  // Tokyo
    'aws-0-eu-west-1.pooler.supabase.com',
    'aws-0-eu-central-1.pooler.supabase.com',
    'aws-0-us-east-1.pooler.supabase.com',
];

$ports = [5432, 6543];

echo "Project: https://{$ref}.supabase.co\n";
echo "Trying pooler hosts...\n\n";

foreach ($hosts as $host) {
    foreach ($ports as $port) {
        $label = "{$host}:{$port}";
        try {
            $dsn = "pgsql:host={$host};port={$port};dbname=postgres;sslmode=require";
            $pdo = new PDO($dsn, $user, $pass, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_TIMEOUT => 6,
            ]);
            $who = $pdo->query('select current_user')->fetchColumn();
            echo "SUCCESS → {$label}\n";
            echo "Logged in as: {$who}\n";
            echo "\nUpdate config.php:\n";
            echo "  'host' => '{$host}',\n";
            echo "  'port' => '{$port}',\n";
            echo "  'user' => '{$user}',\n";
            exit(0);
        } catch (Throwable $e) {
            $msg = $e->getMessage();
            // Shorten noise
            if (str_contains($msg, 'password authentication failed')) {
                echo "AUTH FAIL {$label} (wrong password, but host is reachable)\n";
            } elseif (str_contains($msg, 'timeout') || str_contains($msg, 'timed out')) {
                echo "TIMEOUT  {$label}\n";
            } else {
                echo "FAIL     {$label} → " . substr($msg, 0, 90) . "\n";
            }
        }
    }
}

echo "\nNo pooler worked. Open Supabase → Connect → Session pooler and paste the Host here.\n";
exit(1);
