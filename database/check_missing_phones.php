<?php
require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';
use Indra\Itam\Database\Connection;
$pdo = Connection::make(itam_config()['db']);

foreach (['355365311920811', '865999071785981', 'Mr Viduka', 'ISP Service Advisor Matara'] as $q) {
    $s = $pdo->prepare(
        "SELECT asset_tag, pc_name, imei_number, allocated_person
         FROM mobile_phones
         WHERE imei_number = :q OR imei_number_2 = :q OR pc_name ILIKE :like
         LIMIT 5"
    );
    $s->execute(['q' => $q, 'like' => '%' . $q . '%']);
    echo $q . ' => ' . json_encode($s->fetchAll(PDO::FETCH_ASSOC)) . PHP_EOL;
}

// Count by notes excel no
$notes = $pdo->query("SELECT notes FROM mobile_phones WHERE notes ILIKE '%Excel No:%'")->fetchAll(PDO::FETCH_COLUMN);
$nos = [];
foreach ($notes as $n) {
    if (preg_match('/Excel No:\\s*(\\d+)/', $n, $m)) {
        $nos[] = (int) $m[1];
    }
}
sort($nos);
echo 'imported excel nos count=' . count($nos) . PHP_EOL;
$missing = [];
for ($i = 1; $i <= 80; $i++) {
    if ($i === 34) continue;
    if (! in_array($i, $nos, true)) {
        $missing[] = $i;
    }
}
echo 'missing nos: ' . implode(',', $missing) . PHP_EOL;
