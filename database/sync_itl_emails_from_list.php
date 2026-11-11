<?php

declare(strict_types=1);

/**
 * Replace Indra Traders (IT / ITL) mail vault with the official list.
 * - Keeps password_ciphertext for emails that already exist (same address)
 * - Soft-deactivates IT accounts not on the new list
 * - Inserts missing addresses with blank password (can be set later in UI)
 *
 * Usage (PowerShell):
 *   $env:DB_USER='itams'; $env:DB_PASS='itams_local'; $env:DB_SSLMODE='disable'
 *   php database/sync_itl_emails_from_list.php
 */

require dirname(__DIR__) . '/backend/bootstrap.php';
require dirname(__DIR__) . '/backend/config/load_config.php';

use Indra\Itam\Database\Connection;
use Indra\Itam\Services\CredentialEncryptionService;

$config = itam_config();
$pdo = Connection::make($config['db']);
$pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);

$vault = new CredentialEncryptionService((string) ($config['vault_encryption_key'] ?? ''));

$listPath = __DIR__ . '/imports/itl_emails_2026_list.txt';
$raw = file_get_contents($listPath);
if ($raw === false) {
    fwrite(STDERR, "Missing {$listPath}\n");
    exit(1);
}

$wanted = [];
foreach (preg_split('/\R/', $raw) ?: [] as $line) {
    $email = strtolower(trim($line));
    if ($email === '' || str_starts_with($email, '#')) {
        continue;
    }
    if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
        fwrite(STDERR, "Invalid email skipped: {$email}\n");
        continue;
    }
    $wanted[$email] = true;
}

if ($wanted === []) {
    fwrite(STDERR, "No emails in list\n");
    exit(1);
}

$companyId = (int) $pdo->query("SELECT id FROM companies WHERE code = 'IT' LIMIT 1")->fetchColumn();
if ($companyId < 1) {
    fwrite(STDERR, "IT company not found\n");
    exit(1);
}

$locStmt = $pdo->prepare(
    "SELECT id FROM locations
     WHERE company_id = :c AND is_active = TRUE AND upper(code) = 'KANDY_HO'
     LIMIT 1"
);
$locStmt->execute(['c' => $companyId]);
$locationId = (int) ($locStmt->fetchColumn() ?: 0);
if ($locationId < 1) {
    $locationId = (int) $pdo->query(
        "SELECT id FROM locations WHERE company_id = {$companyId} AND is_active = TRUE ORDER BY id ASC LIMIT 1"
    )->fetchColumn();
}
if ($locationId < 1) {
    fwrite(STDERR, "No IT location found\n");
    exit(1);
}

$adminId = (int) ($pdo->query('SELECT id FROM users ORDER BY id ASC LIMIT 1')->fetchColumn() ?: 0);

// Password source: any existing row for this address (prefer IT company, then non-empty cipher)
$pwByEmail = [];
$allEmails = $pdo->query(
    'SELECT id, company_id, lower(email_address) AS email, password_ciphertext, is_active
     FROM email_accounts
     ORDER BY CASE WHEN company_id = ' . $companyId . ' THEN 0 ELSE 1 END, id ASC'
)->fetchAll(PDO::FETCH_ASSOC);
foreach ($allEmails as $row) {
    $em = (string) $row['email'];
    if (! isset($pwByEmail[$em])) {
        $pwByEmail[$em] = (string) ($row['password_ciphertext'] ?? '');
    } elseif ($pwByEmail[$em] === '' && trim((string) ($row['password_ciphertext'] ?? '')) !== '') {
        $pwByEmail[$em] = (string) $row['password_ciphertext'];
    }
}

$findIt = $pdo->prepare(
    'SELECT id, password_ciphertext, is_active
     FROM email_accounts
     WHERE company_id = :c AND lower(email_address) = :e
     LIMIT 1'
);
$insertEmail = $pdo->prepare(
    'INSERT INTO email_accounts (
        company_id, email_address, password_ciphertext, encryption_version,
        is_active, created_by, updated_by
     ) VALUES (
        :company_id, :email_address, :password_ciphertext, 1,
        TRUE, :created_by, :updated_by
     ) RETURNING id'
);
$reactivateEmail = $pdo->prepare(
    'UPDATE email_accounts
     SET is_active = TRUE, updated_by = :uid, updated_at = NOW()
     WHERE id = :id'
);
$ensureUser = $pdo->prepare(
    'SELECT id FROM email_account_users
     WHERE email_account_id = :eid AND is_active = TRUE
     ORDER BY id ASC LIMIT 1'
);
$insertUser = $pdo->prepare(
    'INSERT INTO email_account_users (email_account_id, user_name, location_id, created_by, is_active)
     VALUES (:email_account_id, :user_name, :location_id, :created_by, TRUE)'
);
$reactivateUsers = $pdo->prepare(
    'UPDATE email_account_users SET is_active = TRUE, updated_at = NOW()
     WHERE email_account_id = :eid'
);

$blankCipher = $vault->encrypt('');

$stats = [
    'wanted' => count($wanted),
    'kept' => 0,
    'reactivated' => 0,
    'inserted' => 0,
    'password_preserved' => 0,
    'blank_password' => 0,
    'deactivated' => 0,
];

$pdo->beginTransaction();
try {
    $activeIdsKept = [];

    foreach (array_keys($wanted) as $email) {
        $findIt->execute(['c' => $companyId, 'e' => $email]);
        $existing = $findIt->fetch(PDO::FETCH_ASSOC);

        if ($existing) {
            $emailId = (int) $existing['id'];
            $wasActive = ($existing['is_active'] === true || $existing['is_active'] === 't' || $existing['is_active'] === '1' || $existing['is_active'] === 1);
            if (! $wasActive) {
                $reactivateEmail->execute(['uid' => $adminId ?: null, 'id' => $emailId]);
                $reactivateUsers->execute(['eid' => $emailId]);
                $stats['reactivated']++;
            } else {
                $stats['kept']++;
            }
            $cipher = trim((string) ($existing['password_ciphertext'] ?? ''));
            if ($cipher === '' && isset($pwByEmail[$email]) && $pwByEmail[$email] !== '') {
                $pdo->prepare(
                    'UPDATE email_accounts SET password_ciphertext = :c, updated_at = NOW() WHERE id = :id'
                )->execute(['c' => $pwByEmail[$email], 'id' => $emailId]);
                $cipher = $pwByEmail[$email];
            }
            if ($cipher !== '' && $cipher !== $blankCipher) {
                $stats['password_preserved']++;
            } else {
                // Treat encrypted blank as blank
                try {
                    if ($vault->decrypt($cipher) !== '') {
                        $stats['password_preserved']++;
                    } else {
                        $stats['blank_password']++;
                    }
                } catch (Throwable) {
                    $stats['password_preserved']++;
                }
            }
        } else {
            $cipher = $pwByEmail[$email] ?? $blankCipher;
            if ($cipher === '') {
                $cipher = $blankCipher;
            }
            $hasPw = false;
            try {
                $hasPw = $vault->decrypt($cipher) !== '';
            } catch (Throwable) {
                $hasPw = $cipher !== '' && $cipher !== $blankCipher;
            }
            if ($hasPw) {
                $stats['password_preserved']++;
            } else {
                $stats['blank_password']++;
                $cipher = $blankCipher;
            }

            $insertEmail->execute([
                'company_id' => $companyId,
                'email_address' => $email,
                'password_ciphertext' => $cipher,
                'created_by' => $adminId ?: null,
                'updated_by' => $adminId ?: null,
            ]);
            $emailId = (int) $insertEmail->fetchColumn();
            $stats['inserted']++;

            $local = explode('@', $email)[0] ?? $email;
            $insertUser->execute([
                'email_account_id' => $emailId,
                'user_name' => $local,
                'location_id' => $locationId,
                'created_by' => $adminId ?: null,
            ]);
        }

        // Ensure at least one active user profile row
        $ensureUser->execute(['eid' => $emailId]);
        if (! $ensureUser->fetchColumn()) {
            $local = explode('@', $email)[0] ?? $email;
            $insertUser->execute([
                'email_account_id' => $emailId,
                'user_name' => $local,
                'location_id' => $locationId,
                'created_by' => $adminId ?: null,
            ]);
        }

        $activeIdsKept[] = $emailId;
    }

    // Soft-deactivate IT accounts not on the new list
    if ($activeIdsKept !== []) {
        $placeholders = [];
        $params = ['cid' => $companyId];
        foreach ($activeIdsKept as $i => $id) {
            $k = 'id' . $i;
            $placeholders[] = ':' . $k;
            $params[$k] = $id;
        }
        $in = implode(',', $placeholders);
        $deact = $pdo->prepare(
            "UPDATE email_accounts
             SET is_active = FALSE, updated_by = :uid, updated_at = NOW()
             WHERE company_id = :cid
               AND is_active = TRUE
               AND id NOT IN ({$in})
             RETURNING id, email_address"
        );
        $params['uid'] = $adminId ?: null;
        $deact->execute($params);
        $removed = $deact->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $stats['deactivated'] = count($removed);
        foreach ($removed as $r) {
            $pdo->prepare(
                'UPDATE email_account_users SET is_active = FALSE, updated_at = NOW() WHERE email_account_id = :id'
            )->execute(['id' => (int) $r['id']]);
            echo 'DEACTIVATED ' . $r['email_address'] . PHP_EOL;
        }
    }

    $pdo->commit();
} catch (Throwable $e) {
    if ($pdo->inTransaction()) {
        $pdo->rollBack();
    }
    fwrite(STDERR, 'FAILED: ' . $e->getMessage() . PHP_EOL);
    exit(1);
}

$activeNow = (int) $pdo->query(
    "SELECT COUNT(*) FROM email_accounts WHERE company_id = {$companyId} AND is_active = TRUE"
)->fetchColumn();

echo json_encode([
    'stats' => $stats,
    'active_it_emails_now' => $activeNow,
    'location_id' => $locationId,
], JSON_PRETTY_PRINT) . PHP_EOL;
echo "Done.\n";
