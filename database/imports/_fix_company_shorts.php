<?php
$config = require "d:/ITAMS/backend/config/config.php";
$db = $config["db"];
$dsn = sprintf("pgsql:host=%s;port=%s;dbname=%s;sslmode=%s", $db["host"], $db["port"], $db["name"], $db["sslmode"] ?? "disable");
$pdo = new PDO($dsn, $db["user"], $db["pass"], [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);

$map = [
  'IT' => 'ITL',
  'IMS' => 'IMS',
  'ISP' => 'ISP',
  'FOTON' => 'Foton',
];
foreach ($map as $code => $short) {
  $stmt = $pdo->prepare('UPDATE companies SET short_name = :s, updated_at = NOW() WHERE code = :c');
  $stmt->execute(['s' => $short, 'c' => $code]);
  echo "{$code} → {$short} ({$stmt->rowCount()} row)\n";
}
echo "\nResult:\n";
foreach ($pdo->query('SELECT code, short_name, name FROM companies ORDER BY id') as $r) {
  echo "{$r['code']}\t{$r['short_name']}\t{$r['name']}\n";
}
