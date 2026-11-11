<?php
require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';
use Indra\Itam\Database\Connection;
$p = Connection::make(itam_config()['db']);
foreach (['laptops', 'mobile_phones', 'pcs', 'printers', 'other_assets', 'assets_legacy', 'assets', 'v_assets'] as $t) {
    $n = $p->query("select to_regclass('public.{$t}')")->fetchColumn();
    echo $t . '=' . ($n ?: 'missing') . PHP_EOL;
}
