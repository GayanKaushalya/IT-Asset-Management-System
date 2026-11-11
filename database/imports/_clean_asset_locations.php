<?php

declare(strict_types=1);

/**
 * Align asset location labels with Organization-style place names:
 * - Kandy Head Office → Head Office - Kandy
 * - Colombo Branch → Colombo
 * - Ramanayake → Colombo (Ramanayaka is the Colombo branch)
 * - Kelani → Kelaniya
 * Merge duplicate Colombo (Ramanayake → Colombo Branch) per company.
 */

$config = require dirname(__DIR__, 2) . '/backend/config/config.php';
$db = $config['db'];
$dsn = sprintf(
    'pgsql:host=%s;port=%s;dbname=%s;sslmode=%s',
    $db['host'],
    $db['port'],
    $db['name'],
    $db['sslmode'] ?? 'disable'
);
$pdo = new PDO($dsn, $db['user'], $db['pass'], [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);

$assetTables = ['laptops', 'mobile_phones', 'pcs', 'other_assets', 'peripherals', 'printers', 'users', 'departments', 'email_account_users'];

echo "=== Before ===\n";
$before = $pdo->query(
    "SELECT c.code AS company, l.id, l.code, l.name, l.city
     FROM locations l JOIN companies c ON c.id = l.company_id
     ORDER BY c.code, l.name"
)->fetchAll();
foreach ($before as $r) {
    echo "{$r['company']}\t{$r['id']}\t{$r['code']}\t{$r['name']}\n";
}

$pdo->beginTransaction();
try {
    // 1) Display-name cleanup (keep Head Office - Kandy wording)
    $pdo->exec(
        "UPDATE locations SET name = 'Head Office - Kandy', updated_at = NOW()
         WHERE name ILIKE 'Kandy Head Office' OR (code = 'KANDY_HO' AND name ILIKE '%head%office%')"
    );

    $pdo->exec(
        "UPDATE locations SET name = 'Kelaniya', city = COALESCE(NULLIF(city, ''), 'Kelaniya'), updated_at = NOW()
         WHERE code = 'KELANI' OR name ILIKE 'Kelani'"
    );

    $pdo->exec(
        "UPDATE locations SET name = 'Colombo', city = 'Colombo', updated_at = NOW()
         WHERE code = 'CMB_BR' OR name ILIKE 'Colombo Branch'"
    );

    // Ramanayake / Ramanayaka = Colombo branch — keep that meaning via display name
    $pdo->exec(
        "UPDATE locations SET name = 'Colombo', city = 'Colombo', updated_at = NOW()
         WHERE code ILIKE 'RAMANAYAKE' OR name ILIKE 'Ramanayake' OR name ILIKE 'Ramanayaka'"
    );

    // 2) Merge Ramanayake into Colombo Branch when both exist for same company
    $dupes = $pdo->query(
        "SELECT c.id AS company_id,
                cmb.id AS colombo_id,
                ram.id AS raman_id
         FROM companies c
         JOIN locations cmb ON cmb.company_id = c.id AND cmb.code = 'CMB_BR'
         JOIN locations ram ON ram.company_id = c.id AND ram.code ILIKE 'RAMANAYAKE'
         WHERE cmb.is_active = TRUE AND ram.is_active = TRUE"
    )->fetchAll();

    foreach ($dupes as $d) {
        $from = (int) $d['raman_id'];
        $to = (int) $d['colombo_id'];
        echo "Merging Ramanayake #{$from} → Colombo #{$to} (company {$d['company_id']})\n";

        foreach ($assetTables as $table) {
            $exists = $pdo->query("SELECT to_regclass('public.{$table}')")->fetchColumn();
            if (! $exists) {
                continue;
            }
            $hasCol = $pdo->query(
                "SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = " . $pdo->quote($table) . "
                   AND column_name = 'location_id'"
            )->fetchColumn();
            if (! $hasCol) {
                continue;
            }
            $stmt = $pdo->prepare("UPDATE {$table} SET location_id = :to WHERE location_id = :from");
            $stmt->execute(['to' => $to, 'from' => $from]);
            $n = $stmt->rowCount();
            if ($n > 0) {
                echo "  {$table}: {$n} row(s)\n";
            }
        }

        $pdo->prepare(
            'UPDATE locations SET is_active = FALSE, name = :name, updated_at = NOW() WHERE id = :id'
        )->execute([
            'name' => 'Colombo (merged → CMB_BR)',
            'id' => $from,
        ]);
    }

    // Ensure Colombo Branch stays labeled Colombo
    $pdo->exec(
        "UPDATE locations SET name = 'Colombo', city = 'Colombo', updated_at = NOW()
         WHERE code = 'CMB_BR' AND is_active = TRUE"
    );

    $pdo->commit();
} catch (Throwable $e) {
    $pdo->rollBack();
    fwrite(STDERR, 'FAILED: ' . $e->getMessage() . "\n");
    exit(1);
}

echo "\n=== After (active) ===\n";
$after = $pdo->query(
    "SELECT c.code AS company, l.id, l.code, l.name, l.city,
            (SELECT COUNT(*) FROM laptops WHERE location_id = l.id)
          + (SELECT COUNT(*) FROM mobile_phones WHERE location_id = l.id)
          + (SELECT COUNT(*) FROM pcs WHERE location_id = l.id) AS assets
     FROM locations l
     JOIN companies c ON c.id = l.company_id
     WHERE l.is_active = TRUE
     ORDER BY c.code, CASE WHEN l.code IN ('KANDY_HO','KANDY','BR_201') THEN 0 ELSE 1 END, l.name"
)->fetchAll();
foreach ($after as $r) {
    echo "{$r['company']}\t{$r['name']}\t({$r['code']})\tassets={$r['assets']}\n";
}

echo "\nDone.\n";
