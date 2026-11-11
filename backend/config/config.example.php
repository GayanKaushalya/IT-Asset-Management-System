<?php

declare(strict_types=1);

/**
 * Indra Group ITAM — application config example.
 * Copy to config.php and fill secrets.
 */
return [
    'app' => [
        'name' => 'Indra Group ITAM',
        'env' => 'local',
        'debug' => true,
        'url' => 'http://localhost:8080',
        'cors_origin' => 'http://localhost:5173',
    ],

    'db' => [
        // Local PostgreSQL (default for this project):
        'url' => '',
        'driver' => 'pgsql',
        'host' => '127.0.0.1',
        'port' => '5432',
        'name' => 'itams',
        'user' => 'postgres',
        'pass' => 'CHANGE_ME',
        'sslmode' => 'disable',

        // Supabase cloud example (optional):
        // 'url' => 'postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres?sslmode=require',
        // 'sslmode' => 'require',
    ],

    'vault_encryption_key' => '',

    'api_tokens' => [
        // 'demo-token' => ['user_id' => 1],
    ],
];
