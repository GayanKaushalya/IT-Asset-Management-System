<?php
$config = require "d:/ITAMS/backend/config/config.php";
$db = $config["db"];
$dsn = sprintf("pgsql:host=%s;port=%s;dbname=%s;sslmode=%s", $db["host"], $db["port"], $db["name"], $db["sslmode"] ?? "disable");
$pdo = new PDO($dsn, $db["user"], $db["pass"], [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);

$foton = $pdo->query("SELECT id FROM companies WHERE code='FOTON'")->fetchColumn();
$it = $pdo->query("SELECT id FROM companies WHERE code='IT'")->fetchColumn();
echo "FOTON id=$foton IT id=$it\n";

$before = $pdo->query("SELECT c.code, COUNT(*)::int n FROM employees e JOIN companies c ON c.id=e.company_id WHERE e.is_active GROUP BY c.code ORDER BY 1")->fetchAll();
echo "Before:\n"; foreach ($before as $r) echo " {$r['code']} {$r['n']}\n";

$n = $pdo->exec("UPDATE employees SET company_id = $it, updated_at = NOW() WHERE company_id = $foton");
echo "Moved $n employees FOTON → IT\n";

$after = $pdo->query("SELECT c.code, e.work_location, COUNT(*)::int n FROM employees e JOIN companies c ON c.id=e.company_id WHERE e.is_active AND e.work_location IS NOT NULL GROUP BY c.code, e.work_location ORDER BY c.code, n DESC")->fetchAll();
echo "After locations:\n"; foreach ($after as $r) echo " {$r['code']}\t{$r['n']}\t{$r['work_location']}\n";
