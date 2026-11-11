<?php

declare(strict_types=1);

/**
 * Builds config from environment variables (Render / MySQL) with file fallbacks.
 * Used by public/index.php — no secrets committed.
 */
function itam_config(): array
{
    $root = dirname(__DIR__);
    $file = $root . '/config/config.php';
    $base = is_file($file)
        ? require $file
        : (is_file($root . '/config/config.example.php')
            ? require $root . '/config/config.example.php'
            : []);

    $env = static function (string $key, mixed $default = null): mixed {
        $v = $_ENV[$key] ?? getenv($key);
        if ($v === false || $v === null || $v === '') {
            return $default;
        }
        return $v;
    };

    $cors = (string) $env('CORS_ORIGIN', $base['app']['cors_origin'] ?? '*');

    return [
        'app' => [
            'name' => (string) $env('APP_NAME', $base['app']['name'] ?? 'Indra Group ITAM'),
            'env' => (string) $env('APP_ENV', $base['app']['env'] ?? 'production'),
            'debug' => filter_var($env('APP_DEBUG', $base['app']['debug'] ?? false), FILTER_VALIDATE_BOOL),
            'url' => (string) $env('APP_URL', $base['app']['url'] ?? ''),
            'cors_origin' => $cors,
        ],
        'db' => [
            'url' => (string) $env('DATABASE_URL', $base['db']['url'] ?? ''),
            'driver' => (string) $env('DB_DRIVER', $base['db']['driver'] ?? 'pgsql'),
            'host' => (string) $env('DB_HOST', $base['db']['host'] ?? '127.0.0.1'),
            'port' => (string) $env('DB_PORT', $base['db']['port'] ?? '5432'),
            'name' => (string) $env('DB_NAME', $base['db']['name'] ?? 'postgres'),
            'user' => (string) $env('DB_USER', $base['db']['user'] ?? 'postgres'),
            'pass' => (string) $env('DB_PASS', $base['db']['pass'] ?? ''),
            'sslmode' => (string) $env('DB_SSLMODE', $base['db']['sslmode'] ?? 'require'),
        ],
        'vault_encryption_key' => (string) $env(
            'VAULT_ENCRYPTION_KEY',
            $base['vault_encryption_key'] ?? ''
        ),
        'api_tokens' => itam_parse_api_tokens(
            (string) $env('API_TOKENS', ''),
            $base['api_tokens'] ?? []
        ),
    ];
}

/**
 * API_TOKENS format: token1:userId1,token2:userId2
 *
 * @param array<string, array{user_id:int}> $fallback
 * @return array<string, array{user_id:int}>
 */
function itam_parse_api_tokens(string $raw, array $fallback): array
{
    if (trim($raw) === '') {
        return $fallback;
    }

    $out = [];
    foreach (explode(',', $raw) as $pair) {
        $pair = trim($pair);
        if ($pair === '' || ! str_contains($pair, ':')) {
            continue;
        }
        [$token, $userId] = array_map('trim', explode(':', $pair, 2));
        if ($token !== '' && ctype_digit($userId)) {
            $out[$token] = ['user_id' => (int) $userId];
        }
    }

    return $out !== [] ? $out : $fallback;
}
