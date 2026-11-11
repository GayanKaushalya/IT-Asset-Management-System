<?php

declare(strict_types=1);

/**
 * Standalone AES-256-GCM demo (no framework).
 * Run: php backend/examples/vault_encrypt_demo.php
 */

require dirname(__DIR__) . '/bootstrap.php';

use Indra\Itam\Services\CredentialEncryptionService;

$key = CredentialEncryptionService::generateKey();
$vault = new CredentialEncryptionService($key);

$plain = 'IndraERP#2026!Secure';
$cipher = $vault->encrypt($plain);
$out = $vault->decrypt($cipher);

echo 'vault_encryption_key sample: ' . $key . PHP_EOL;
echo 'ciphertext: ' . $cipher . PHP_EOL;
echo 'round-trip OK: ' . ($out === $plain ? 'yes' : 'no') . PHP_EOL;
