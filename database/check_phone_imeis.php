<?php
require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';
use Indra\Itam\Database\Connection;
$pdo = Connection::make(itam_config()['db']);
foreach (['355365311920811', '865999071785981', '352284419675214'] as $i) {
    $s = $pdo->prepare('SELECT id, asset_tag, pc_name, company_id, imei_number FROM mobile_phones WHERE imei_number = :i OR imei_number_2 = :i');
    $s->execute(['i' => $i]);
    $rows = $s->fetchAll(PDO::FETCH_ASSOC);
    echo $i . ' => ' . json_encode($rows) . PHP_EOL;
}
