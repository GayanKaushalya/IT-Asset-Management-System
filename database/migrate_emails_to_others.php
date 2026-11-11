<?php

declare(strict_types=1);

/**
 * Ensure "Others" company exists and move external mailboxes
 * (gmail, yahoo, outlook, hotmail, etc.) into it.
 *
 * Usage: C:\xampp\php\php.exe database/migrate_emails_to_others.php
 */

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;

$pdo = Connection::make(itam_config()['db']);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

$pdo->exec(
    "INSERT INTO companies (code, name, short_name, is_active)
     VALUES ('OTHER', 'Other Emails', 'Others', TRUE)
     ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, short_name = EXCLUDED.short_name, is_active = TRUE"
);

$otherId = (int) $pdo->query("SELECT id FROM companies WHERE code = 'OTHER' LIMIT 1")->fetchColumn();
if ($otherId < 1) {
    fwrite(STDERR, "Failed to create OTHER company\n");
    exit(1);
}

$pdo->prepare(
    "INSERT INTO locations (company_id, code, name, city, is_active)
     VALUES (:c, 'EXTERNAL', 'External / Personal', NULL, TRUE)
     ON CONFLICT (company_id, code) DO UPDATE SET name = EXCLUDED.name, is_active = TRUE"
)->execute(['c' => $otherId]);

$locStmt = $pdo->prepare('SELECT id FROM locations WHERE company_id = :c AND code = :code LIMIT 1');
$locStmt->execute(['c' => $otherId, 'code' => 'EXTERNAL']);
$locId = (int) $locStmt->fetchColumn();
if ($locId < 1) {
    fwrite(STDERR, "Failed to create OTHER location\n");
    exit(1);
}

$companyDomains = [
    'indratraders.lk',
    'indramotorspares.com',
    'indraservicepark.lk',
    'fotontrucks.lk',
];

$rows = $pdo->query(
    'SELECT id, email_address, company_id FROM email_accounts WHERE is_active = TRUE'
)->fetchAll(PDO::FETCH_ASSOC);

$moved = 0;
$updAccount = $pdo->prepare('UPDATE email_accounts SET company_id = :c, updated_at = NOW() WHERE id = :id');
$updUsers = $pdo->prepare(
    'UPDATE email_account_users SET location_id = :loc, updated_at = NOW()
     WHERE email_account_id = :eid AND is_active = TRUE'
);

foreach ($rows as $row) {
    $email = strtolower(trim((string) $row['email_address']));
    $at = strrpos($email, '@');
    if ($at === false) {
        continue;
    }
    $domain = substr($email, $at + 1);
    $isCompany = false;
    foreach ($companyDomains as $cd) {
        if ($domain === $cd || str_ends_with($domain, '.' . $cd)) {
            $isCompany = true;
            break;
        }
    }
    if ($isCompany) {
        continue;
    }
    if ((int) $row['company_id'] === $otherId) {
        continue;
    }
    $updAccount->execute(['c' => $otherId, 'id' => (int) $row['id']]);
    $updUsers->execute(['loc' => $locId, 'eid' => (int) $row['id']]);
    $moved++;
    echo "MOVED {$email}\n";
}

$count = (int) $pdo->query(
    "SELECT COUNT(*) FROM email_accounts e JOIN companies c ON c.id = e.company_id
     WHERE c.code = 'OTHER' AND e.is_active = TRUE"
)->fetchColumn();

echo json_encode(['other_company_id' => $otherId, 'moved' => $moved, 'other_total' => $count], JSON_PRETTY_PRINT) . PHP_EOL;
