<?php

declare(strict_types=1);

$root = dirname(__DIR__);
$config = require $root . '/backend/config/config.php';
$db = $config['db'];
$dsn = sprintf(
    'pgsql:host=%s;port=%s;dbname=%s;sslmode=%s',
    $db['host'],
    $db['port'],
    $db['name'],
    $db['sslmode'] ?? 'require'
);
$pdo = new PDO($dsn, $db['user'], $db['pass'], [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

$pdo->exec('CREATE INDEX IF NOT EXISTS idx_other_assets_company_location ON other_assets (company_id, location_id)');
$pdo->exec('CREATE INDEX IF NOT EXISTS idx_peripherals_company_location ON peripherals (company_id, location_id)');
$pdo->exec('CREATE INDEX IF NOT EXISTS idx_pcs_company_location ON pcs (company_id, location_id)');
$pdo->exec('CREATE INDEX IF NOT EXISTS idx_laptops_company_location ON laptops (company_id, location_id)');
$pdo->exec('CREATE INDEX IF NOT EXISTS idx_mobile_phones_company_location ON mobile_phones (company_id, location_id)');

echo "OK: location list indexes created.\n";
