<?php

declare(strict_types=1);

$config = require dirname(__DIR__) . '/config/config.php';
$db = $config['db'];
$pdo = new PDO(
    sprintf('pgsql:host=%s;port=%s;dbname=%s', $db['host'], $db['port'], $db['name']),
    $db['user'],
    $db['pass'],
    [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]
);

$n = $pdo->exec('DELETE FROM notifications');
echo "Cleared {$n} notification row(s)\n";
