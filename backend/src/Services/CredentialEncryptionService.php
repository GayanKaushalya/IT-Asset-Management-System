<?php

declare(strict_types=1);

namespace Indra\Itam\Services;

use RuntimeException;

/**
 * AES-256-GCM encryption for the Credential Vault (pure PHP / OpenSSL).
 *
 * Payload format (base64): version(1) | iv(12) | tag(16) | ciphertext
 */
final class CredentialEncryptionService
{
    private const CIPHER = 'aes-256-gcm';
    private const IV_LENGTH = 12;
    private const TAG_LENGTH = 16;
    private const VERSION = "\x01";

    private string $key;

    public function __construct(string $base64Key)
    {
        if ($base64Key === '') {
            throw new RuntimeException('vault_encryption_key is not configured.');
        }

        $key = base64_decode($base64Key, true);

        if ($key === false || strlen($key) !== 32) {
            throw new RuntimeException('vault_encryption_key must be base64-encoded 32 bytes (AES-256).');
        }

        $this->key = $key;
    }

    public function encrypt(string $plaintext): string
    {
        $iv = random_bytes(self::IV_LENGTH);
        $tag = '';

        $ciphertext = openssl_encrypt(
            $plaintext,
            self::CIPHER,
            $this->key,
            OPENSSL_RAW_DATA,
            $iv,
            $tag,
            '',
            self::TAG_LENGTH
        );

        if ($ciphertext === false || strlen($tag) !== self::TAG_LENGTH) {
            throw new RuntimeException('Failed to encrypt credential secret.');
        }

        return base64_encode(self::VERSION . $iv . $tag . $ciphertext);
    }

    public function decrypt(string $payload): string
    {
        $raw = base64_decode($payload, true);

        if ($raw === false || strlen($raw) < 1 + self::IV_LENGTH + self::TAG_LENGTH) {
            throw new RuntimeException('Invalid credential ciphertext.');
        }

        if ($raw[0] !== self::VERSION) {
            throw new RuntimeException('Unsupported credential encryption version.');
        }

        $iv = substr($raw, 1, self::IV_LENGTH);
        $tag = substr($raw, 1 + self::IV_LENGTH, self::TAG_LENGTH);
        $ciphertext = substr($raw, 1 + self::IV_LENGTH + self::TAG_LENGTH);

        $plaintext = openssl_decrypt(
            $ciphertext,
            self::CIPHER,
            $this->key,
            OPENSSL_RAW_DATA,
            $iv,
            $tag
        );

        if ($plaintext === false) {
            throw new RuntimeException('Unable to decrypt credential secret.');
        }

        return $plaintext;
    }

    public static function generateKey(): string
    {
        return base64_encode(random_bytes(32));
    }
}
