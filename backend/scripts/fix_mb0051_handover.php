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

$id = 74;
$category = 'mobile_phone';
$first = 'Mr. IT Deshan Umayanga';
$firstDate = '2026-07-26';
$second = 'Mr. Buddhika Rajapaksha';
$secondDate = '2026-10-10';

$pdo->beginTransaction();

$pdo->prepare(
    "UPDATE mobile_phones SET
        handover_person_1 = :p1,
        handover_on_1 = :d1,
        handover_person_2 = :p2,
        handover_on_2 = :d2,
        handover_person_3 = NULL,
        handover_on_3 = NULL,
        handover_person_4 = NULL,
        handover_on_4 = NULL,
        original_assigned_person = :p1,
        original_assigned_on = :d1,
        allocated_person = :p2,
        allocated_on = :d2,
        pc_name = :p2,
        updated_at = NOW()
     WHERE id = :id"
)->execute([
    'p1' => $first,
    'd1' => $firstDate,
    'p2' => $second,
    'd2' => $secondDate,
    'id' => $id,
]);

$pdo->prepare(
    'DELETE FROM asset_handovers WHERE asset_id = :id AND asset_type = :t'
)->execute(['id' => $id, 't' => $category]);

$companyId = (int) $pdo->query('SELECT company_id FROM mobile_phones WHERE id = ' . $id)->fetchColumn();

$slots = [
    ['name' => $first, 'date' => $firstDate, 'open' => false],
    ['name' => $second, 'date' => $secondDate, 'open' => true],
];

foreach ($slots as $i => $slot) {
    $isOpen = ! empty($slot['open']);
    $nextDate = $slots[$i + 1]['date'] ?? null;
    $stmt = $pdo->prepare(
        'INSERT INTO asset_handovers (
            company_id, asset_id, asset_type, handover_date, assigned_person_name,
            assigned_by_it_staff_id, checkout_condition, gate_pass_no, is_open,
            return_date, return_received_by_id, return_condition
         ) VALUES (
            :cid, :aid, :atype, :hdate, :pname,
            1, \'good\', :gp, :open,
            :rdate, :rby, :rcond
         )'
    );
    $stmt->bindValue('cid', $companyId, PDO::PARAM_INT);
    $stmt->bindValue('aid', $id, PDO::PARAM_INT);
    $stmt->bindValue('atype', $category);
    $stmt->bindValue('hdate', $slot['date']);
    $stmt->bindValue('pname', $slot['name']);
    $stmt->bindValue('gp', 'GP-FIX-' . date('Ymd') . '-' . $id . '-' . ($i + 1));
    $stmt->bindValue('open', $isOpen, PDO::PARAM_BOOL);
    if ($isOpen) {
        $stmt->bindValue('rdate', null, PDO::PARAM_NULL);
        $stmt->bindValue('rby', null, PDO::PARAM_NULL);
        $stmt->bindValue('rcond', null, PDO::PARAM_NULL);
    } else {
        $stmt->bindValue('rdate', $nextDate);
        $stmt->bindValue('rby', 1, PDO::PARAM_INT);
        $stmt->bindValue('rcond', 'good');
    }
    $stmt->execute();
}

$pdo->commit();

$row = $pdo->query(
    "SELECT asset_tag, handover_person_1, handover_person_2, handover_person_3, handover_person_4,
            handover_on_1, handover_on_2, allocated_person
     FROM mobile_phones WHERE id = {$id}"
)->fetch(PDO::FETCH_ASSOC);

echo "Updated IT-MB-0051\n";
echo json_encode($row, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";

$hist = $pdo->query(
    "SELECT id, assigned_person_name, handover_date, is_open, return_date
     FROM asset_handovers WHERE asset_id = {$id} AND asset_type = 'mobile_phone' ORDER BY id"
)->fetchAll(PDO::FETCH_ASSOC);
echo "History:\n" . json_encode($hist, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE) . "\n";
