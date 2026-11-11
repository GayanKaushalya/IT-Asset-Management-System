<?php

declare(strict_types=1);

/**
 * Clear All Branch PC Inventory data (pcs table + related handovers/peripherals).
 * Usage: php database/clear_branch_pcs.php
 */

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;

$pdo = Connection::make(itam_config()['db']);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

$before = (int) $pdo->query('SELECT COUNT(*) FROM pcs')->fetchColumn();
echo "PCs before: {$before}\n";

$pdo->beginTransaction();
try {
    // Peripheral checklist rows linked to PC handovers
    $pdo->exec(
        "DELETE FROM handover_peripheral_checklist
         WHERE handover_id IN (
            SELECT id FROM asset_handovers WHERE asset_type = 'pc'
         )"
    );

    $ho = $pdo->exec("DELETE FROM asset_handovers WHERE asset_type = 'pc'");
    echo "Deleted PC handovers: {$ho}\n";

    $per = $pdo->exec("DELETE FROM asset_peripherals WHERE asset_type = 'pc'");
    echo "Deleted PC peripherals: {$per}\n";

    $pcs = $pdo->exec('DELETE FROM pcs');
    echo "Deleted PC assets: {$pcs}\n";

    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, 'FAILED: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}

$after = (int) $pdo->query('SELECT COUNT(*) FROM pcs')->fetchColumn();
echo "PCs after: {$after}\n";
echo "OK: All Branch PC inventory (pcs) cleared.\n";
