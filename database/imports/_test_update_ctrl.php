<?php
require "d:/ITAMS/backend/bootstrap.php";
require "d:/ITAMS/backend/config/load_config.php";
use Indra\Itam\Database\Connection;
use Indra\Itam\Http\Request;
use Indra\Itam\Controllers\AssetController;

$pdo = Connection::make(itam_config()["db"]);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

$user = $pdo->query("SELECT id, company_id, role FROM users WHERE role='super_admin' LIMIT 1")->fetch(PDO::FETCH_ASSOC);
if (!$user) $user = $pdo->query("SELECT id, company_id, role FROM users ORDER BY id LIMIT 1")->fetch(PDO::FETCH_ASSOC);
echo "user=".json_encode($user)."\n";

$pc = $pdo->query("SELECT id, asset_tag, company_id, pc_name, windows_version, ram_gb, warranty_period FROM pcs ORDER BY id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
echo "pc=".json_encode($pc)."\n";

$body = [
  'name' => $pc['pc_name'],
  'pc_name' => $pc['pc_name'],
  'allocated_person' => $pc['pc_name'],
  'status' => 'deployed',
  'cpu' => 'Test CPU Update',
  'processor' => 'Test CPU Update',
  'ram' => 16,
  'ram_gb' => 16,
  'hdd' => 500,
  'hdd_gb' => 500,
  'ssd' => 256,
  'ssd_gb' => 256,
  'windows_version' => 'Windows 11',
  'warranty_period' => '1 year',
  'date' => '2025-01-15',
  'purchase_date' => '2025-01-15',
  'has_power_cable' => true,
  'has_vga_cable' => true,
  'has_keyboard' => true,
  'has_mouse' => true,
  'has_ups' => true,
  'ups_brand' => 'Prolink',
  'ups_model' => '650',
  'ups_purchase_date' => '2025-01-15',
  'ups_warranty_period' => 'Expired',
];

// Simulate Request
$req = new Request('PUT', '/api/assets/pc/'.$pc['id'], [], $body, []);
$ctrl = new AssetController($pdo);

ob_start();
try {
  $ctrl->update($req, $user, ['category'=>'pc','id'=>(string)$pc['id']]);
} catch (Throwable $e) {
  echo "EX: ".$e->getMessage()."\n".$e->getTraceAsString()."\n";
}
$out = ob_get_clean();
echo "response_len=".strlen($out)."\n";
echo substr($out, 0, 800)."\n";

$after = $pdo->query("SELECT pc_name, cpu, ram_gb, hdd_gb, ssd_gb, windows_version, warranty_period, warranty_expires_on, ups_warranty_period, ups_warranty_expires_on, allocated_person FROM pcs WHERE id=".(int)$pc['id'])->fetch(PDO::FETCH_ASSOC);
echo "after=".json_encode($after)."\n";
