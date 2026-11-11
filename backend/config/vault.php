<?php

declare(strict_types=1);

return [
    /*
    |--------------------------------------------------------------------------
    | Credential Vault Encryption Key (AES-256)
    |--------------------------------------------------------------------------
    |
    | Generate with:
    |   php -r "echo base64_encode(random_bytes(32)), PHP_EOL;"
    |
    | Store only in .env as VAULT_ENCRYPTION_KEY=...
    | Never commit the real key. Rotate by re-encrypting rows with a new key
    | and bumping encryption_version on credentials.
    |
    */
    'key' => env('VAULT_ENCRYPTION_KEY'),
];
