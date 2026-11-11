<?php

declare(strict_types=1);

namespace Indra\Itam\Support;

use Indra\Itam\Http\Request;
use Indra\Itam\Http\Response;
use PDO;

final class Auth
{
    /** @var array<string, array<string, mixed>> */
    private static array $tokenCache = [];

    /**
     * Resolve user from Bearer token (DB api_access_tokens or legacy config api_tokens).
     *
     * @return array<string, mixed>|null
     */
    public static function user(PDO $pdo, Request $request, array $config): ?array
    {
        $token = $request->bearerToken();
        if ($token !== null && $token !== '') {
            if (isset(self::$tokenCache[$token])) {
                return self::$tokenCache[$token];
            }

            $fromDb = self::userFromDbToken($pdo, $token);
            if ($fromDb !== null) {
                self::$tokenCache[$token] = $fromDb;
                return $fromDb;
            }

            $tokens = $config['api_tokens'] ?? [];
            if (isset($tokens[$token])) {
                $userId = (int) ($tokens[$token]['user_id'] ?? 0);
                $user = self::findUser($pdo, $userId);
                if ($user !== null) {
                    self::$tokenCache[$token] = $user;
                }
                return $user;
            }
        }

        if (($config['app']['env'] ?? '') === 'local') {
            $devUserId = $request->headers['X-User-Id'] ?? null;
            if ($devUserId !== null && ctype_digit((string) $devUserId)) {
                return self::findUser($pdo, (int) $devUserId);
            }
        }

        return null;
    }

    public static function requireUser(PDO $pdo, Request $request, array $config): array
    {
        $user = self::user($pdo, $request, $config);
        if ($user === null) {
            Response::error('Unauthorized', 401);
            exit;
        }
        return $user;
    }

    public static function canDecryptVault(array $user): bool
    {
        if (! empty($user['can_decrypt_vault'])) {
            return true;
        }
        return in_array($user['role'] ?? '', ['super_admin', 'it_admin'], true);
    }

    public static function assertCompanyAccess(array $user, int $companyId): void
    {
        if (($user['role'] ?? '') === 'super_admin') {
            return;
        }
        if ((int) ($user['company_id'] ?? 0) !== $companyId) {
            Response::error('Cross-company access denied', 403);
            exit;
        }
    }

    /** @return array<string, mixed>|null */
    private static function userFromDbToken(PDO $pdo, string $token): ?array
    {
        try {
            $hash = hash('sha256', $token);
            $stmt = $pdo->prepare(
                'SELECT u.id, u.uuid, u.company_id, u.staff_id, u.name, u.email, u.phone, u.role,
                        u.can_decrypt_vault, u.is_active
                 FROM api_access_tokens t
                 JOIN users u ON u.id = t.user_id
                 WHERE t.token_hash = :h
                   AND u.is_active = TRUE
                   AND (t.expires_at IS NULL OR t.expires_at > NOW())
                 LIMIT 1'
            );
            $stmt->execute(['h' => $hash]);
            $row = $stmt->fetch();
            if (! $row) {
                return null;
            }
            // Skip write on GET — saves a round-trip on every list/search request
            $method = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
            if ($method !== 'GET' && $method !== 'OPTIONS' && $method !== 'HEAD') {
                $pdo->prepare(
                    'UPDATE api_access_tokens
                     SET last_used_at = NOW()
                     WHERE token_hash = :h
                       AND (last_used_at IS NULL OR last_used_at < NOW() - INTERVAL \'10 minutes\')'
                )->execute(['h' => $hash]);
            }
            return $row;
        } catch (\Throwable) {
            return null;
        }
    }

    /** @return array<string, mixed>|null */
    private static function findUser(PDO $pdo, int $id): ?array
    {
        if ($id < 1) {
            return null;
        }
        $stmt = $pdo->prepare(
            'SELECT id, uuid, company_id, staff_id, name, email, phone, role, can_decrypt_vault, is_active
             FROM users WHERE id = :id AND is_active = TRUE LIMIT 1'
        );
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }
}
