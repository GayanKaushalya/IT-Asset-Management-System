<?php

declare(strict_types=1);

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;

$pdo = Connection::make(itam_config()['db']);
$sql = file_get_contents(__DIR__ . '/migrations/add_mobile_phone_fields.sql');
if ($sql === false) {
    fwrite(STDERR, "Migration file missing\n");
    exit(1);
}
$pdo->exec($sql);
echo "OK: mobile phone fields added.\n";
