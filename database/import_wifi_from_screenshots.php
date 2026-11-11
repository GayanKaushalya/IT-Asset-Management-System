<?php

declare(strict_types=1);

/**
 * Import WiFi passwords from database/imports/wifi_from_screenshots.json
 *
 * Usage: C:\xampp\php\php.exe database/import_wifi_from_screenshots.php
 */

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;
use Indra\Itam\Services\CredentialEncryptionService;

$config = itam_config();
$pdo = Connection::make($config['db']);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$vault = new CredentialEncryptionService((string) ($config['vault_encryption_key'] ?? ''));

$jsonPath = __DIR__ . '/imports/wifi_from_screenshots.json';
$raw = file_get_contents($jsonPath);
if ($raw === false) {
    fwrite(STDERR, "Missing {$jsonPath}\n");
    exit(1);
}

/** @var list<array<string,string>> $rows */
$rows = json_decode($raw, true, 512, JSON_THROW_ON_ERROR);

$companies = [];
foreach ($pdo->query('SELECT id, code FROM companies')->fetchAll(PDO::FETCH_ASSOC) as $c) {
    $companies[strtoupper((string) $c['code'])] = (int) $c['id'];
}

$adminId = (int) ($pdo->query('SELECT id FROM users ORDER BY id ASC LIMIT 1')->fetchColumn() ?: 0);

$find = $pdo->prepare(
    "SELECT id FROM credentials
     WHERE company_id = :c AND credential_type = 'wifi'
       AND lower(system_name) = lower(:ssid) AND is_active = TRUE
     LIMIT 1"
);
$insert = $pdo->prepare(
    "INSERT INTO credentials (
        company_id, credential_type, system_name, username, password_ciphertext,
        encryption_version, password_hint, notes_ciphertext, created_by, updated_by, is_active
     ) VALUES (
        :company_id, 'wifi', :system_name, :username, :password_ciphertext,
        1, :password_hint, :notes_ciphertext, :created_by, :updated_by, TRUE
     )"
);
$update = $pdo->prepare(
    "UPDATE credentials SET
        password_ciphertext = :cipher,
        password_hint = :hint,
        notes_ciphertext = :notes,
        username = :username,
        updated_by = :updated_by,
        updated_at = NOW(),
        is_active = TRUE
     WHERE id = :id"
);

$stats = ['inserted' => 0, 'updated' => 0, 'skipped' => 0, 'blank_pw' => 0, 'by_company' => []];

foreach ($rows as $row) {
    $ssid = trim((string) ($row['ssid'] ?? ''));
    $password = (string) ($row['password'] ?? '');
    $company = strtoupper(trim((string) ($row['company'] ?? 'IT')));
    $location = trim((string) ($row['location'] ?? ''));
    $flow = trim((string) ($row['flow'] ?? ''));
    $phone = trim((string) ($row['phone'] ?? ''));

    if ($ssid === '') {
        $stats['skipped']++;
        continue;
    }
    if (! isset($companies[$company])) {
        echo "SKIP unknown company {$company} for {$ssid}\n";
        $stats['skipped']++;
        continue;
    }

    if ($password === '') {
        $stats['blank_pw']++;
    }

    $companyId = $companies[$company];
    $username = $flow !== '' ? $flow : 'wifi';
    $hintParts = array_filter([$location, $flow !== '' ? "Flow: {$flow}" : null, $phone !== '' ? "Tel: {$phone}" : null]);
    $hint = implode(' · ', $hintParts);
    if (strlen($hint) > 120) {
        $hint = substr($hint, 0, 117) . '...';
    }
    $notesPlain = json_encode([
        'location' => $location,
        'flow' => $flow,
        'phone' => $phone,
        'source' => 'wifi_screenshots',
    ], JSON_UNESCAPED_UNICODE);
    $notesCipher = $vault->encrypt((string) $notesPlain);
    $cipher = $vault->encrypt($password);

    $find->execute(['c' => $companyId, 'ssid' => $ssid]);
    $existingId = $find->fetchColumn();
    if ($existingId) {
        $update->execute([
            'cipher' => $cipher,
            'hint' => $hint !== '' ? $hint : null,
            'notes' => $notesCipher,
            'username' => $username,
            'updated_by' => $adminId ?: null,
            'id' => (int) $existingId,
        ]);
        $stats['updated']++;
    } else {
        $insert->execute([
            'company_id' => $companyId,
            'system_name' => $ssid,
            'username' => $username,
            'password_ciphertext' => $cipher,
            'password_hint' => $hint !== '' ? $hint : null,
            'notes_ciphertext' => $notesCipher,
            'created_by' => $adminId ?: null,
            'updated_by' => $adminId ?: null,
        ]);
        $stats['inserted']++;
    }

    $stats['by_company'][$company] = ($stats['by_company'][$company] ?? 0) + 1;
}

echo json_encode($stats, JSON_PRETTY_PRINT) . PHP_EOL;
echo "Done.\n";
