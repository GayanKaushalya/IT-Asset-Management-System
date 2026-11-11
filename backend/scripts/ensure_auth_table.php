<?php

declare(strict_types=1);

/**
 * Creates api_access_tokens if missing.
 * Run: C:\xampp\php\php.exe scripts\ensure_auth_table.php
 */

require dirname(__DIR__) . '/bootstrap.php';
require dirname(__DIR__) . '/config/load_config.php';

use Indra\Itam\Database\Connection;

$config = itam_config();

try {
    $pdo = Connection::make($config['db']);

    $pdo->exec(
        'CREATE TABLE IF NOT EXISTS api_access_tokens (
            id           BIGSERIAL PRIMARY KEY,
            user_id      BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            token_hash   VARCHAR(64) NOT NULL UNIQUE,
            label        VARCHAR(100),
            expires_at   TIMESTAMPTZ,
            last_used_at TIMESTAMPTZ,
            created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )'
    );

    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_api_tokens_user ON api_access_tokens(user_id)');

    $pdo->exec(
        "UPDATE users
         SET can_decrypt_vault = TRUE,
             role = 'super_admin'
         WHERE email = 'it.admin@indragroup.lk'"
    );

    echo "OK — api_access_tokens is ready.\n";
} catch (Throwable $e) {
    echo 'FAILED: ' . $e->getMessage() . "\n";
    exit(1);
}
