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

$sql = "SELECT id, asset_tag,
               handover_person_1, handover_person_2, handover_person_3, handover_person_4,
               handover_on_1, handover_on_2, handover_on_3, handover_on_4,
               allocated_person, original_assigned_person
        FROM laptops
        WHERE handover_person_1 ILIKE '%Deshan%'
           OR handover_person_2 ILIKE '%Rohitha%'
           OR handover_person_3 ILIKE '%Buddhika%'
           OR handover_person_4 ILIKE '%Buddhika%'
           OR allocated_person ILIKE '%Buddhika Rajapaksha%'
        ORDER BY id";

$rows = $pdo->query($sql)->fetchAll(PDO::FETCH_ASSOC);
echo "Found " . count($rows) . " laptop(s)\n";
foreach ($rows as $r) {
    echo json_encode($r, JSON_UNESCAPED_UNICODE) . "\n";
}

if ($rows === []) {
    // Also check mobile phones
    $sql2 = str_replace('FROM laptops', 'FROM mobile_phones', $sql);
    $rows = $pdo->query($sql2)->fetchAll(PDO::FETCH_ASSOC);
    echo "Found " . count($rows) . " mobile(s)\n";
    foreach ($rows as $r) {
        echo json_encode($r, JSON_UNESCAPED_UNICODE) . "\n";
    }
    exit(0);
}

// Target: 1st stays Deshan; 2nd must be Buddhika; clear duplicate 3rd/4th if they are the same Buddhika
foreach ($rows as $r) {
    $id = (int) $r['id'];
    $p1 = trim((string) $r['handover_person_1']);
    $p2 = trim((string) $r['handover_person_2']);
    $p3 = trim((string) $r['handover_person_3']);
    $p4 = trim((string) $r['handover_person_4']);
    $d1 = $r['handover_on_1'];
    $d2 = $r['handover_on_2'];
    $d3 = $r['handover_on_3'];
    $d4 = $r['handover_on_4'];

    $looksLikeTarget =
        stripos($p1, 'Deshan') !== false
        && (stripos($p2, 'Rohitha') !== false || stripos($p3, 'Buddhika') !== false || stripos($p4, 'Buddhika') !== false);

    if (! $looksLikeTarget) {
        echo "Skip {$r['asset_tag']} — does not match screenshot pattern\n";
        continue;
    }

    $buddhika = 'Mr. Buddhika Rajapaksha';
    // Prefer date from Buddhika slot (3rd or 4th), else keep/adjust 2nd date
    $buddhikaDate = $d3 ?: ($d4 ?: $d2);
    if (! $buddhikaDate) {
        $buddhikaDate = date('Y-m-d');
    }

    echo "Fixing {$r['asset_tag']} (id={$id}): 2nd -> {$buddhika} on {$buddhikaDate}; clear 3rd/4th duplicates\n";

    $upd = $pdo->prepare(
        "UPDATE laptops SET
            handover_person_2 = :p2,
            handover_on_2 = :d2,
            handover_person_3 = NULL,
            handover_on_3 = NULL,
            handover_person_4 = NULL,
            handover_on_4 = NULL,
            allocated_person = :alloc,
            allocated_on = :alloc_on,
            pc_name = :alloc,
            updated_at = NOW()
         WHERE id = :id"
    );
    $upd->execute([
        'p2' => $buddhika,
        'd2' => $buddhikaDate,
        'alloc' => $buddhika,
        'alloc_on' => $buddhikaDate,
        'id' => $id,
    ]);

    // Rebuild asset_handovers history from corrected slots
    $pdo->prepare(
        'DELETE FROM asset_handovers WHERE asset_id = :id AND asset_type = :t'
    )->execute(['id' => $id, 't' => 'laptop']);

    $companyId = (int) $pdo->query('SELECT company_id FROM laptops WHERE id = ' . $id)->fetchColumn();
    $persons = [
        ['name' => $p1 !== '' ? $p1 : (string) $r['original_assigned_person'], 'date' => $d1 ?: date('Y-m-d'), 'open' => false],
        ['name' => $buddhika, 'date' => $buddhikaDate, 'open' => true],
    ];

    foreach ($persons as $i => $slot) {
        if (trim($slot['name']) === '') {
            continue;
        }
        $ins = $pdo->prepare(
            'INSERT INTO asset_handovers (
                company_id, asset_id, asset_type, handover_date, assigned_person_name,
                assigned_by_it_staff_id, checkout_condition, gate_pass_no, is_open,
                return_date, return_condition
             ) VALUES (
                :cid, :aid, \'laptop\', :hdate, :pname,
                1, \'good\', :gp, :open,
                :rdate, :rcond
             )'
        );
        $isOpen = ! empty($slot['open']);
        $nextDate = $persons[$i + 1]['date'] ?? null;
        $ins->execute([
            'cid' => $companyId,
            'aid' => $id,
            'hdate' => $slot['date'],
            'pname' => $slot['name'],
            'gp' => 'GP-FIX-' . date('Ymd') . '-' . $id . '-' . ($i + 1),
            'open' => $isOpen,
            'rdate' => $isOpen ? null : $nextDate,
            'rcond' => $isOpen ? null : 'good',
        ]);
    }

    echo "Done {$r['asset_tag']}\n";
}

echo "OK\n";
