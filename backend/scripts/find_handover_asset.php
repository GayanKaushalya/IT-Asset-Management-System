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

$q = "
SELECT 'laptop' AS cat, id, asset_tag,
       handover_person_1, handover_person_2, handover_person_3, handover_person_4,
       handover_on_1, handover_on_2, handover_on_3, handover_on_4,
       allocated_person, original_assigned_person, pc_name
FROM laptops
WHERE handover_person_1 ILIKE '%Umayanga%'
   OR handover_person_1 ILIKE '%Deshan Umayanga%'
   OR handover_person_1 ILIKE '%IT Deshan%'
   OR handover_person_2 ILIKE '%Rohitha%'
   OR handover_person_2 ILIKE '%Boyagama%'
   OR handover_person_3 ILIKE '%Buddhika%'
   OR handover_person_4 ILIKE '%Buddhika%'
   OR allocated_person ILIKE '%Rohitha%'
   OR allocated_person ILIKE '%Buddhika Rajapaksha%'
   OR pc_name ILIKE '%Buddhika Rajapaksha%'
UNION ALL
SELECT 'mobile_phone', id, asset_tag,
       handover_person_1, handover_person_2, handover_person_3, handover_person_4,
       handover_on_1, handover_on_2, handover_on_3, handover_on_4,
       allocated_person, original_assigned_person, pc_name
FROM mobile_phones
WHERE handover_person_1 ILIKE '%Umayanga%'
   OR handover_person_2 ILIKE '%Rohitha%'
   OR handover_person_3 ILIKE '%Buddhika%'
   OR handover_person_4 ILIKE '%Buddhika%'
   OR allocated_person ILIKE '%Rohitha%'
   OR allocated_person ILIKE '%Buddhika%'
ORDER BY cat, id
";

foreach ($pdo->query($q) as $r) {
    echo json_encode($r, JSON_UNESCAPED_UNICODE) . "\n";
}

echo "--- handovers table ---\n";
$h = $pdo->query("
SELECT id, asset_id, asset_type, assigned_person_name, handover_date, is_open
FROM asset_handovers
WHERE assigned_person_name ILIKE '%Rohitha%'
   OR assigned_person_name ILIKE '%Boyagama%'
   OR assigned_person_name ILIKE '%Umayanga%'
   OR assigned_person_name ILIKE '%Buddhika Rajapaksha%'
ORDER BY asset_type, asset_id, id
");
foreach ($h as $r) {
    echo json_encode($r, JSON_UNESCAPED_UNICODE) . "\n";
}
