<?php

declare(strict_types=1);

/**
 * Backfill mobile phone warranty_expires_on = original handover date + 1 year.
 * Priority: original_assigned_on → handover_on_1 → handed_over_on → purchase_date
 *
 * Usage: C:\xampp\php\php.exe database/backfill_mobile_warranty.php
 */

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;

$pdo = Connection::make(itam_config()['db']);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

// Ensure columns exist
$pdo->exec(
    'ALTER TABLE mobile_phones ADD COLUMN IF NOT EXISTS warranty_expires_on DATE'
);
$pdo->exec(
    "ALTER TABLE mobile_phones ADD COLUMN IF NOT EXISTS warranty_period VARCHAR(100)"
);

$sql = "UPDATE mobile_phones
        SET warranty_expires_on = (
                COALESCE(original_assigned_on, handover_on_1, handed_over_on, purchase_date)
                + INTERVAL '1 year'
            )::date,
            warranty_period = COALESCE(NULLIF(warranty_period, ''), '1 year'),
            updated_at = NOW()
        WHERE COALESCE(original_assigned_on, handover_on_1, handed_over_on, purchase_date) IS NOT NULL
          AND (
            warranty_expires_on IS NULL
            OR warranty_expires_on <> (
                COALESCE(original_assigned_on, handover_on_1, handed_over_on, purchase_date)
                + INTERVAL '1 year'
            )::date
            OR warranty_period IS NULL
            OR warranty_period = ''
          )";

$n = $pdo->exec($sql);
echo "Updated {$n} mobile phone warranty date(s) to original handover + 1 year.\n";

$check = $pdo->query(
    "SELECT COUNT(*) AS total,
            COUNT(*) FILTER (WHERE warranty_expires_on IS NOT NULL) AS with_warranty,
            COUNT(*) FILTER (
                WHERE warranty_expires_on IS NULL
                  AND COALESCE(original_assigned_on, handover_on_1, handed_over_on, purchase_date) IS NOT NULL
            ) AS missing_with_date,
            COUNT(*) FILTER (
                WHERE COALESCE(original_assigned_on, handover_on_1, handed_over_on, purchase_date) IS NULL
            ) AS no_handover_date
     FROM mobile_phones"
)->fetch(PDO::FETCH_ASSOC);

echo "Total phones: {$check['total']}\n";
echo "With warranty set: {$check['with_warranty']}\n";
echo "Still missing (has date but no warranty): {$check['missing_with_date']}\n";
echo "No original handover/purchase date: {$check['no_handover_date']}\n";
