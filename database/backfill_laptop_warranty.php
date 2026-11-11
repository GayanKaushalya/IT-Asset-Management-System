<?php

declare(strict_types=1);

/**
 * Backfill laptop warranty_expires_on = purchase_date + 2 years.
 * Usage: php database/backfill_laptop_warranty.php
 */

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;

$pdo = Connection::make(itam_config()['db']);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

$sql = "UPDATE laptops
        SET warranty_expires_on = (purchase_date + INTERVAL '2 years')::date,
            updated_at = NOW()
        WHERE purchase_date IS NOT NULL
          AND (
            warranty_expires_on IS NULL
            OR warranty_expires_on <> (purchase_date + INTERVAL '2 years')::date
          )";

$n = $pdo->exec($sql);
echo "Updated {$n} laptop warranty void date(s) to purchase + 2 years.\n";

$check = $pdo->query(
    "SELECT COUNT(*) AS with_warranty,
            COUNT(*) FILTER (WHERE warranty_expires_on IS NULL AND purchase_date IS NOT NULL) AS missing
     FROM laptops"
)->fetch(PDO::FETCH_ASSOC);

echo "Laptops with warranty set: {$check['with_warranty']}\n";
echo "Still missing (no purchase date): {$check['missing']}\n";
