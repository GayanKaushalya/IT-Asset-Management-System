<?php
require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';
use Indra\Itam\Database\Connection;
$pdo = Connection::make(itam_config()['db']);
$rows = $pdo->query('SELECT asset_tag, imei_number, imei_number_2, serial_number, pc_name FROM mobile_phones ORDER BY id LIMIT 15')->fetchAll(PDO::FETCH_ASSOC);
foreach ($rows as $r) {
    echo json_encode($r) . PHP_EOL;
}
echo 'COUNT=' . $pdo->query('SELECT COUNT(*) FROM mobile_phones')->fetchColumn() . PHP_EOL;
