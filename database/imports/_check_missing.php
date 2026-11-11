<?php
$config = require "d:/ITAMS/backend/config/config.php";
$db = $config["db"];
$pdo = new PDO(sprintf("pgsql:host=%s;port=%s;dbname=%s;sslmode=%s", $db["host"], $db["port"], $db["name"], $db["sslmode"] ?? "disable"), $db["user"], $db["pass"], [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION, PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC]);

$excel = json_decode(file_get_contents("d:/ITAMS/database/imports/_lap_xlsx_full.json"), true);
echo "Excel rows: ".count($excel)." unique SN: ".count(array_unique(array_column($excel,'serial')))."\n";

$byCo = [];
foreach ($excel as $r) {
  $c = $r['company'] ?? '?';
  $byCo[$c] = ($byCo[$c] ?? 0) + 1;
}
echo "Excel by company:\n";
foreach ($byCo as $c=>$n) echo "  $c => $n\n";

echo "\nDB laptops:\n";
foreach ($pdo->query("SELECT c.code, c.short_name, COUNT(*) n FROM laptops l JOIN companies c ON c.id=l.company_id GROUP BY c.code, c.short_name ORDER BY 1") as $r) {
  echo "  {$r['code']}/{$r['short_name']}: {$r['n']}\n";
}
echo "Total DB: ".$pdo->query("SELECT COUNT(*) FROM laptops")->fetchColumn()."\n";

// Any excel SN missing from DB?
$map = [
  'indra traders pvt ltd'=>'IT',
  'indra service park pvt ltd'=>'ISP',
  'indra motorspare pvt ltd'=>'IMS',
  'indra motor spares pvt ltd'=>'IMS',
];
$companies=[];
foreach($pdo->query("SELECT id,code FROM companies") as $c) $companies[$c['code']]=(int)$c['id'];
$missing=[];
foreach ($excel as $r) {
  $code = $map[strtolower(trim($r['company']))] ?? null;
  if (!$code) { $missing[]="NOMAP {$r['company']} {$r['serial']}"; continue; }
  $cid=$companies[$code];
  $st=$pdo->prepare("SELECT id FROM laptops WHERE company_id=? AND lower(serial_number)=lower(?)");
  $st->execute([$cid,$r['serial']]);
  if (!$st->fetch()) $missing[]="{$code} {$r['serial']} {$r['name']}";
}
echo "\nMissing from DB: ".count($missing)."\n";
foreach ($missing as $m) echo "  $m\n";

// Show raw excel sheet row count again
echo "\nAlso check if preview/full json incomplete vs xlsx...\n";
