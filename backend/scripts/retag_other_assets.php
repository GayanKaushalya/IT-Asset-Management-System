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

// Delete test asset created earlier
$pdo->exec("DELETE FROM other_assets WHERE id = 36 AND asset_tag = 'ITL-KHO-OTH-001'");

$rows = $pdo->query("SELECT a.id, a.asset_tag, a.company_id, c.code AS company_code, l.code AS loc_code
FROM other_assets a
JOIN companies c ON c.id = a.company_id
LEFT JOIN locations l ON l.id = a.location_id
ORDER BY a.company_id, a.location_id NULLS LAST, a.id")->fetchAll(PDO::FETCH_ASSOC);

// Phase 1: temp tags to free unique (company_id, asset_tag)
$updTmp = $pdo->prepare("UPDATE other_assets SET asset_tag = :t WHERE id = :id");
foreach ($rows as $r) {
  $updTmp->execute(["t" => "__tmp_" . $r["id"], "id" => $r["id"]]);
}

// Phase 2: assign branch tags; per company+branch sequence starting at 001
$groups = [];
foreach ($rows as $r) {
  if (!$r["loc_code"]) {
    // keep a safe company-only fallback so tag still shows
    $prefix = companyPrefix($r["company_code"]) . "-UNK-OTH";
  } else {
    $prefix = companyPrefix($r["company_code"]) . "-" . locationTagCode($r["loc_code"]) . "-OTH";
  }
  $groups[$prefix][] = $r;
}

$upd = $pdo->prepare("UPDATE other_assets SET asset_tag = :t WHERE id = :id");
$changed = 0;
foreach ($groups as $prefix => $items) {
  // Preserve previous numeric order when old tag was digits-only
  usort($items, static function ($a, $b) {
    $an = preg_match("/^[0-9]+$/", (string)$a["asset_tag"]) ? (int)$a["asset_tag"] : (int)$a["id"];
    $bn = preg_match("/^[0-9]+$/", (string)$b["asset_tag"]) ? (int)$b["asset_tag"] : (int)$b["id"];
    if ($an === $bn) return ((int)$a["id"]) <=> ((int)$b["id"]);
    return $an <=> $bn;
  });
  $n = 1;
  foreach ($items as $r) {
    // Prefer keep old number if it was a pure integer and unused in this loop order
    $tag = sprintf("%s-%03d", $prefix, $n);
    $upd->execute(["t" => $tag, "id" => $r["id"]]);
    $changed++;
    $n++;
  }
}

$pdo->commit();
echo "Retagged $changed other assets\n";
foreach ($pdo->query("SELECT id, asset_tag, location_id FROM other_assets ORDER BY id DESC LIMIT 12") as $r) {
  echo "{$r["id"]}\t{$r["asset_tag"]}\tloc={$r["location_id"]}\n";
}
