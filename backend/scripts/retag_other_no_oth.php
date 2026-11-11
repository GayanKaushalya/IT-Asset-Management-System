<?php
$cfg = require "d:/ITAMS/backend/config/config.php";
$db = $cfg["db"];
$pdo = new PDO("pgsql:host={$db["host"]};port={$db["port"]};dbname={$db["name"]}", $db["user"], $db["pass"], [PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION]);

function locationTagCode(string $locationCode): string {
  $code = strtoupper(trim($locationCode));
  if (preg_match("/^BR_(\d+)$/", $code, $m)) return $m[1];
  $known = [
    "KANDY_HO"=>"KHO","KANDY"=>"KDY","CMB_BR"=>"CMB","RAMANAYAKE"=>"RAM","NEGOMBO"=>"NEG",
    "KELANI"=>"KEL","JA_ELA"=>"JAE","MATHARA"=>"MAT","ANURADHAPURA"=>"ANU","HYDEPARK"=>"HYD",
    "EMBILIPITIYA"=>"EMB","GAMPOLA"=>"GAM","FOTON_JAELA"=>"FJA","FOTON_KANDY"=>"FKD",
    "FOTON_KELANI"=>"FKE","FOTON_KELANIYA"=>"FKE","FOTON_JA_ELA"=>"FJA",
  ];
  if (isset($known[$code])) return $known[$code];
  $clean = preg_replace("/[^A-Z0-9]/", "", $code) ?: "BR";
  return substr($clean, 0, 6);
}
function companyPrefix(string $code): string {
  return match (strtoupper($code)) {
    "IT", "ITL" => "ITL",
    "IMS" => "IMS",
    "ISP" => "ISP",
    "FOTON" => "FOTON",
    "SIM" => "SIM",
    default => strtoupper($code),
  };
}

$pdo->beginTransaction();
$rows = $pdo->query("SELECT a.id, a.asset_tag, a.company_id, a.user_name, a.pc_name, c.code AS company_code, l.code AS loc_code
FROM other_assets a
JOIN companies c ON c.id = a.company_id
LEFT JOIN locations l ON l.id = a.location_id
ORDER BY a.id")->fetchAll(PDO::FETCH_ASSOC);

$updTmp = $pdo->prepare("UPDATE other_assets SET asset_tag = :t WHERE id = :id");
foreach ($rows as $r) {
  $updTmp->execute(["t" => "__tmp_" . $r["id"], "id" => $r["id"]]);
}

$groups = [];
foreach ($rows as $r) {
  $branch = $r["loc_code"] ? locationTagCode($r["loc_code"]) : "UNK";
  $prefix = companyPrefix($r["company_code"]) . "-" . $branch;
  $groups[$prefix][] = $r;
}

$upd = $pdo->prepare("UPDATE other_assets SET asset_tag = :t, user_name = COALESCE(NULLIF(trim(user_name), ''), NULLIF(trim(pc_name), ''), user_name), pc_name = COALESCE(NULLIF(trim(pc_name), ''), NULLIF(trim(user_name), ''), pc_name) WHERE id = :id");
$changed = 0;
foreach ($groups as $prefix => $items) {
  usort($items, static function ($a, $b) {
    $an = preg_match("/(\d+)$/", (string)$a["asset_tag"], $am) ? (int)$am[1] : (int)$a["id"];
    $bn = preg_match("/(\d+)$/", (string)$b["asset_tag"], $bm) ? (int)$bm[1] : (int)$b["id"];
    if ($an === $bn) return ((int)$a["id"]) <=> ((int)$b["id"]);
    return $an <=> $bn;
  });
  $n = 1;
  foreach ($items as $r) {
    $tag = sprintf("%s-%03d", $prefix, $n);
    $upd->execute(["t" => $tag, "id" => $r["id"]]);
    $changed++;
    $n++;
  }
}
$pdo->commit();
echo "Retagged $changed\n";
foreach ($pdo->query("SELECT id, asset_tag, user_name FROM other_assets ORDER BY asset_tag LIMIT 12") as $r) {
  echo "{$r["id"]}\t{$r["asset_tag"]}\t{$r["user_name"]}\n";
}
echo "---\n";
foreach ($pdo->query("SELECT substring(asset_tag from '^(.*)-[0-9]+$') p, COUNT(*) c, MIN(asset_tag), MAX(asset_tag) FROM other_assets GROUP BY 1 ORDER BY 1") as $r) {
  echo "{$r["p"]}\t{$r["c"]}\t{$r["min"]} .. {$r["max"]}\n";
}
