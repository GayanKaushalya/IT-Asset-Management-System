<?php
require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';
use Indra\Itam\Database\Connection;
$pdo = Connection::make(itam_config()['db']);

echo "IMS phones:\n";
foreach ($pdo->query(
    "SELECT m.asset_tag, m.serial_number, m.imei_number, m.imei_number_2, m.pc_name
     FROM mobile_phones m JOIN companies c ON c.id = m.company_id
     WHERE c.code = 'IMS' ORDER BY m.id"
)->fetchAll(PDO::FETCH_ASSOC) as $r) {
    echo json_encode($r) . PHP_EOL;
}

$companyId = (int) $pdo->query("SELECT id FROM companies WHERE code = 'IMS'")->fetchColumn();
echo "IMS id=$companyId\n";

foreach ([['355365311920811', '105 TA-1557 DS'], ['865999071785981', '64290/W5TU02650']] as [$imei, $serial]) {
    $s = $pdo->prepare(
        'SELECT id, asset_tag, company_id, imei_number, serial_number FROM mobile_phones
         WHERE (company_id = :c AND (imei_number = :i OR imei_number_2 = :i))
            OR (company_id = :c2 AND lower(serial_number) = lower(:s))'
    );
    $s->execute(['c' => $companyId, 'i' => $imei, 'c2' => $companyId, 's' => $serial]);
    echo "lookup $imei / $serial => " . json_encode($s->fetchAll(PDO::FETCH_ASSOC)) . PHP_EOL;

    // ISP company for 47
    $isp = (int) $pdo->query("SELECT id FROM companies WHERE code = 'ISP'")->fetchColumn();
    $s2 = $pdo->prepare(
        'SELECT id, asset_tag, company_id, imei_number, serial_number, pc_name FROM mobile_phones
         WHERE company_id = :c AND (imei_number = :i OR imei_number_2 = :i OR lower(coalesce(serial_number,\'\')) = lower(:s))'
    );
    $s2->execute(['c' => $isp, 'i' => $imei, 's' => $serial]);
    echo "ISP lookup $imei => " . json_encode($s2->fetchAll(PDO::FETCH_ASSOC)) . PHP_EOL;
}
