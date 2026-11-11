<?php

declare(strict_types=1);

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;

$pdo = Connection::make(itam_config()['db']);
$sql = file_get_contents(__DIR__ . '/migrations/add_handover_persons_1_to_4.sql');
if ($sql === false) {
    fwrite(STDERR, "Migration missing\n");
    exit(1);
}
$pdo->exec($sql);
echo "OK: handover_person_1..4 ready on laptops + mobile_phones.\n";
