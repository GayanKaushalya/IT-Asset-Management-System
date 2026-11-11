<?php

declare(strict_types=1);

namespace Indra\Itam\Database;

use PDO;
use PDOException;
use RuntimeException;

final class Connection
{
    private static ?PDO $pdo = null;

    /**
     * Supports MySQL and PostgreSQL (Supabase).
     *
     * @param array{host?:string,port?:string,name?:string,user?:string,pass?:string,url?:string,driver?:string} $db
     */
    public static function make(array $db): PDO
    {
        if (self::$pdo instanceof PDO) {
            return self::$pdo;
        }

        $url = $db['url'] ?? getenv('DATABASE_URL') ?: '';
        if (is_string($url) && $url !== '') {
            self::$pdo = self::fromUrl($url);
            return self::$pdo;
        }

        $driver = strtolower((string) ($db['driver'] ?? 'mysql'));
        if (in_array($driver, ['pgsql', 'postgres', 'postgresql', 'supabase'], true)) {
            self::$pdo = self::makePgsql($db);
        } else {
            self::$pdo = self::makeMysql($db);
        }

        return self::$pdo;
    }

    /** @param array<string, mixed> $db */
    private static function makeMysql(array $db): PDO
    {
        $dsn = sprintf(
            'mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4',
            $db['host'] ?? '127.0.0.1',
            $db['port'] ?? '3306',
            $db['name'] ?? 'indra_itam'
        );

        return self::connect($dsn, $db['user'] ?? 'root', $db['pass'] ?? '');
    }

    /** @param array<string, mixed> $db */
    private static function makePgsql(array $db): PDO
    {
        $dsn = sprintf(
            'pgsql:host=%s;port=%s;dbname=%s;sslmode=%s',
            $db['host'] ?? '127.0.0.1',
            $db['port'] ?? '5432',
            $db['name'] ?? 'postgres',
            $db['sslmode'] ?? 'require'
        );

        return self::connect($dsn, $db['user'] ?? 'postgres', $db['pass'] ?? '');
    }

    private static function fromUrl(string $url): PDO
    {
        // mysql://  mysql2://  postgres://  postgresql://
        // Passwords with # @ : must be URL-encoded (e.g. # → %23)
        $normalized = preg_replace('#^mysql2://#i', 'mysql://', $url) ?? $url;
        $normalized = preg_replace('#^postgres(ql)?://#i', 'pgsql://', $normalized) ?? $normalized;

        // Parse userinfo manually so # in passwords does not truncate the URL
        if (preg_match('#^(pgsql|mysql)://([^/@]+)@(.+)$#i', $normalized, $m)) {
            $scheme = strtolower($m[1]);
            $userinfo = $m[2];
            $rest = $m[3];
            $user = 'postgres';
            $pass = '';
            if (str_contains($userinfo, ':')) {
                [$user, $pass] = explode(':', $userinfo, 2);
                $user = rawurldecode($user);
                $pass = rawurldecode($pass);
            } else {
                $user = rawurldecode($userinfo);
            }
            $hostPart = $rest;
            $query = [];
            if (str_contains($rest, '?')) {
                [$hostPart, $queryString] = explode('?', $rest, 2);
                parse_str($queryString, $query);
            }
            $path = 'postgres';
            if (str_contains($hostPart, '/')) {
                [$hostPort, $path] = explode('/', $hostPart, 2);
            } else {
                $hostPort = $hostPart;
            }
            $host = $hostPort;
            $port = $scheme === 'pgsql' ? '5432' : '3306';
            if (str_contains($hostPort, ':')) {
                [$host, $port] = explode(':', $hostPort, 2);
            }
            $name = ltrim($path, '/') ?: 'postgres';

            if ($scheme === 'pgsql') {
                $sslmode = (string) ($query['sslmode'] ?? 'require');
                $dsn = sprintf('pgsql:host=%s;port=%s;dbname=%s;sslmode=%s', $host, $port, $name, $sslmode);
                return self::connect($dsn, $user !== '' ? $user : 'postgres', $pass);
            }

            $dsn = sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $host, $port, $name);
            return self::connect($dsn, $user !== '' ? $user : 'root', $pass);
        }

        $parts = parse_url($normalized);
        if ($parts === false || ! isset($parts['host'], $parts['path'])) {
            throw new RuntimeException('Invalid DATABASE_URL. Use host/user/pass fields if the password contains # @ :');
        }

        $scheme = strtolower($parts['scheme'] ?? 'mysql');
        $host = $parts['host'];
        $user = rawurldecode($parts['user'] ?? '');
        $pass = rawurldecode($parts['pass'] ?? '');
        $name = ltrim($parts['path'], '/');

        $query = [];
        if (! empty($parts['query'])) {
            parse_str($parts['query'], $query);
        }

        if ($scheme === 'pgsql') {
            $port = (string) ($parts['port'] ?? 5432);
            $sslmode = (string) ($query['sslmode'] ?? 'require');
            $dsn = sprintf('pgsql:host=%s;port=%s;dbname=%s;sslmode=%s', $host, $port, $name, $sslmode);
            return self::connect($dsn, $user !== '' ? $user : 'postgres', $pass);
        }

        $port = (string) ($parts['port'] ?? 3306);
        $dsn = sprintf('mysql:host=%s;port=%s;dbname=%s;charset=utf8mb4', $host, $port, $name);
        return self::connect($dsn, $user !== '' ? $user : 'root', $pass);
    }

    private static function connect(string $dsn, string $user, string $pass): PDO
    {
        try {
            return new PDO($dsn, $user, $pass, [
                PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
                PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                PDO::ATTR_EMULATE_PREPARES => false,
                PDO::ATTR_PERSISTENT => true,
            ]);
        } catch (PDOException $e) {
            throw new RuntimeException('Database connection failed: ' . $e->getMessage(), 0, $e);
        }
    }
}
