<?php

declare(strict_types=1);

/**
 * Import email accounts from database/imports/emails_from_excel.json
 * into email_accounts / email_account_users, split by company (IT / IMS / ISP / FOTON / OTHER).
 *
 * - Blank passwords stay blank (encrypted empty string)
 * - Blank names allowed
 * - Inserts only — skips emails that already exist (any company)
 *
 * Usage: C:\xampp\php\php.exe database/import_emails_from_excel.php
 */

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;
use Indra\Itam\Services\CredentialEncryptionService;

$config = itam_config();
$pdo = Connection::make($config['db']);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

$vault = new CredentialEncryptionService((string) ($config['vault_encryption_key'] ?? ''));

$jsonPath = __DIR__ . '/imports/emails_from_excel.json';
$raw = file_get_contents($jsonPath);
if ($raw === false) {
    fwrite(STDERR, "Missing {$jsonPath} — run: node database/parse_emails_excel.js\n");
    exit(1);
}

/** @var list<array{email:string,password:string,name:string,company:string}> $rows */
$rows = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);

$companies = [];
foreach ($pdo->query('SELECT id, code FROM companies')->fetchAll(PDO::FETCH_ASSOC) as $c) {
    $companies[strtoupper((string) $c['code'])] = (int) $c['id'];
}

$defaultLocByCompany = [];
$locStmt = $pdo->query(
    "SELECT l.id, l.company_id, l.code
     FROM locations l
     WHERE l.is_active = TRUE
     ORDER BY l.id ASC"
);
foreach ($locStmt->fetchAll(PDO::FETCH_ASSOC) as $l) {
    $cid = (int) $l['company_id'];
    if (! isset($defaultLocByCompany[$cid])) {
        $defaultLocByCompany[$cid] = (int) $l['id'];
    }
}
$preferred = [
    'IT' => 'KANDY_HO',
    'IMS' => 'BR_201',
    'ISP' => 'KANDY',
    'FOTON' => 'KANDY_HO',
    'OTHER' => 'OTHER',
];
foreach ($preferred as $code => $locCode) {
    if (! isset($companies[$code])) {
        continue;
    }
    $cid = $companies[$code];
    $q = $pdo->prepare(
        'SELECT id FROM locations WHERE company_id = :c AND upper(code) = :code AND is_active = TRUE LIMIT 1'
    );
    $q->execute(['c' => $cid, 'code' => $locCode]);
    $id = $q->fetchColumn();
    if ($id) {
        $defaultLocByCompany[$cid] = (int) $id;
    }
}

$adminId = (int) ($pdo->query("SELECT id FROM users ORDER BY id ASC LIMIT 1")->fetchColumn() ?: 0);

// Skip if email already exists in any company (no duplicate addresses)
$findEmailAny = $pdo->prepare(
    'SELECT id FROM email_accounts WHERE lower(email_address) = lower(:e) LIMIT 1'
);
$insertEmail = $pdo->prepare(
    'INSERT INTO email_accounts (
        company_id, email_address, password_ciphertext, encryption_version, created_by, updated_by
     ) VALUES (
        :company_id, :email_address, :password_ciphertext, 1, :created_by, :updated_by
     ) RETURNING id'
);
$insertUser = $pdo->prepare(
    'INSERT INTO email_account_users (email_account_id, user_name, location_id, created_by)
     VALUES (:email_account_id, :user_name, :location_id, :created_by)'
);

$stats = [
    'inserted' => 0,
    'skipped_duplicate' => 0,
    'skipped_invalid' => 0,
    'blank_pw' => 0,
    'by_company' => [],
];

$seenInFile = [];

foreach ($rows as $row) {
    $email = strtolower(trim((string) ($row['email'] ?? '')));
    $companyCode = strtoupper(trim((string) ($row['company'] ?? '')));
    $password = (string) ($row['password'] ?? '');
    // Names optional — leave blank when not provided
    $name = trim((string) ($row['name'] ?? ''));

    if ($email === '' || ! filter_var($email, FILTER_VALIDATE_EMAIL)) {
        $stats['skipped_invalid']++;
        continue;
    }
    if (isset($seenInFile[$email])) {
        $stats['skipped_duplicate']++;
        continue;
    }
    $seenInFile[$email] = true;

    if (! isset($companies[$companyCode])) {
        echo "SKIP no company {$companyCode}: {$email}\n";
        $stats['skipped_invalid']++;
        continue;
    }

    $companyId = $companies[$companyCode];
    $locationId = $defaultLocByCompany[$companyId] ?? null;
    if ($locationId === null) {
        echo "SKIP no location for {$companyCode}: {$email}\n";
        $stats['skipped_invalid']++;
        continue;
    }

    $findEmailAny->execute(['e' => $email]);
    if ($findEmailAny->fetchColumn()) {
        $stats['skipped_duplicate']++;
        continue;
    }

    if ($password === '') {
        $stats['blank_pw']++;
    }

    $cipher = $vault->encrypt($password);

    $insertEmail->execute([
        'company_id' => $companyId,
        'email_address' => $email,
        'password_ciphertext' => $cipher,
        'created_by' => $adminId ?: null,
        'updated_by' => $adminId ?: null,
    ]);
    $emailId = (int) ($insertEmail->fetchColumn() ?: 0);
    $stats['inserted']++;

    $insertUser->execute([
        'email_account_id' => $emailId,
        'user_name' => $name,
        'location_id' => $locationId,
        'created_by' => $adminId ?: null,
    ]);

    $stats['by_company'][$companyCode] = ($stats['by_company'][$companyCode] ?? 0) + 1;
}

echo json_encode($stats, JSON_PRETTY_PRINT) . PHP_EOL;
echo "Done.\n";
