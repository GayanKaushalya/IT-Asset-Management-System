<?php

declare(strict_types=1);

/**
 * Remove unidentified / undefined WiFi credentials.
 * Targets: empty/null/"undefined"/"null" SSID, or username literally "undefined".
 * Also lists candidates with blank password for review when --blank-pw is passed.
 *
 * Usage:
 *   C:\xampp\php\php.exe database/delete_undefined_wifi.php
 *   C:\xampp\php\php.exe database/delete_undefined_wifi.php --blank-pw
 */

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;
use Indra\Itam\Services\CredentialEncryptionService;

$config = itam_config();
$pdo = Connection::make($config['db']);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
$vault = new CredentialEncryptionService((string) ($config['vault_encryption_key'] ?? ''));

$includeBlankPw = in_array('--blank-pw', $argv, true);

$find = $pdo->query(
    "SELECT id, company_id, system_name, username, password_hint, password_ciphertext, is_active
     FROM credentials
     WHERE credential_type = 'wifi'
     ORDER BY id"
);
$rows = $find->fetchAll(PDO::FETCH_ASSOC);

$toDelete = [];
foreach ($rows as $r) {
    $name = strtolower(trim((string) ($r['system_name'] ?? '')));
    $user = strtolower(trim((string) ($r['username'] ?? '')));
    $hint = strtolower(trim((string) ($r['password_hint'] ?? '')));

    $badName =
        $name === ''
        || in_array($name, ['undefined', 'null', 'n/a', 'na', 'none', 'unidentified', 'unknown'], true)
        || str_contains($name, 'undefined')
        || str_contains($name, 'unidentified');

    $badUser = in_array($user, ['undefined', 'null', 'unidentified'], true);
    $badHint = in_array($hint, ['undefined', 'null'], true);

    $blankPw = false;
    if ($includeBlankPw) {
        try {
            $blankPw = $vault->decrypt((string) ($r['password_ciphertext'] ?? '')) === '';
        } catch (Throwable) {
            $blankPw = false;
        }
    }

    if ($badName || $badUser || $badHint || $blankPw) {
        $toDelete[] = [
            'id' => (int) $r['id'],
            'system_name' => (string) ($r['system_name'] ?? ''),
            'username' => (string) ($r['username'] ?? ''),
            'reason' => $badName ? 'bad_name' : ($badUser ? 'bad_user' : ($badHint ? 'bad_hint' : 'blank_pw')),
        ];
    }
}

echo 'Candidates: ' . count($toDelete) . PHP_EOL;
foreach ($toDelete as $r) {
    echo sprintf("  id=%d name=%s user=%s reason=%s\n", $r['id'], json_encode($r['system_name']), json_encode($r['username']), $r['reason']);
}

if ($toDelete === []) {
    echo "Nothing to delete.\n";
    exit(0);
}

$ids = array_column($toDelete, 'id');
$placeholders = implode(',', array_fill(0, count($ids), '?'));

foreach (['credential_access_logs', 'credential_audit_logs'] as $table) {
    try {
        $del = $pdo->prepare("DELETE FROM {$table} WHERE credential_id IN ({$placeholders})");
        $del->execute($ids);
        echo "Cleared {$table}: " . $del->rowCount() . PHP_EOL;
    } catch (Throwable) {
        // optional table
    }
}

$delCred = $pdo->prepare("DELETE FROM credentials WHERE id IN ({$placeholders}) AND credential_type = 'wifi'");
$delCred->execute($ids);
echo 'Deleted WiFi credentials: ' . $delCred->rowCount() . PHP_EOL;

$left = (int) $pdo->query(
    "SELECT COUNT(*) FROM credentials WHERE credential_type = 'wifi'"
)->fetchColumn();
echo "Remaining WiFi credentials: {$left}\n";
