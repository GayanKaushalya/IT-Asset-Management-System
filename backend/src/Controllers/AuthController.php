<?php

declare(strict_types=1);

namespace Indra\Itam\Controllers;

use Indra\Itam\Http\Request;
use Indra\Itam\Http\Response;
use Indra\Itam\Services\SystemAuditService;
use PDO;

final class AuthController
{
    private readonly SystemAuditService $audit;

    public function __construct(private readonly PDO $pdo)
    {
        $this->audit = new SystemAuditService($pdo);
    }

    /**
     * POST /api/login { email, password }
     * First login for a user with empty password_hash sets that password.
     */
    public function login(Request $request): void
    {
        $email = strtolower(trim((string) $request->input('email', '')));
        $password = (string) $request->input('password', '');

        if ($email === '' || strlen($password) < 6) {
            Response::error('Email and password (min 6 chars) required', 422);
            return;
        }

        $stmt = $this->pdo->prepare(
            'SELECT id, uuid, company_id, staff_id, name, email, phone, role, can_decrypt_vault,
                    password_hash, is_active
             FROM users WHERE lower(email) = :email LIMIT 1'
        );
        $stmt->execute(['email' => $email]);
        $user = $stmt->fetch();

        if (! $user || ! self::isTruthy($user['is_active'] ?? false)) {
            $this->audit->log(null, 'login_failed', $request, null, ['email' => $email, 'reason' => 'unknown_or_inactive']);
            Response::error('Invalid email or password', 401);
            return;
        }

        $hash = $user['password_hash'] ?? null;
        if ($hash === null || $hash === '') {
            $newHash = password_hash($password, PASSWORD_BCRYPT);
            $upd = $this->pdo->prepare('UPDATE users SET password_hash = :h, updated_at = NOW() WHERE id = :id');
            $upd->execute(['h' => $newHash, 'id' => $user['id']]);
        } elseif (! password_verify($password, (string) $hash)) {
            $this->audit->log((int) $user['id'], 'login_failed', $request, (int) $user['id'], [
                'email' => $email,
                'reason' => 'bad_password',
            ]);
            Response::error('Invalid email or password', 401);
            return;
        }

        $plainToken = bin2hex(random_bytes(32));
        $tokenHash = hash('sha256', $plainToken);

        $ins = $this->pdo->prepare(
            'INSERT INTO api_access_tokens (user_id, token_hash, label, expires_at)
             VALUES (:user_id, :token_hash, :label, NOW() + INTERVAL \'30 days\')'
        );
        $ins->execute([
            'user_id' => $user['id'],
            'token_hash' => $tokenHash,
            'label' => 'web-login',
        ]);

        $this->pdo->prepare('UPDATE users SET last_login_at = NOW() WHERE id = :id')
            ->execute(['id' => $user['id']]);

        $this->audit->log((int) $user['id'], 'login', $request, (int) $user['id'], [
            'email' => $email,
            'role' => $user['role'] ?? null,
        ]);

        Response::json([
            'token' => $plainToken,
            'user' => $this->publicUser($user),
        ]);
    }

    /**
     * POST /api/register — public self-registration (name, email, password only).
     * company_id defaults to Indra Traders (IT); staff_id is auto-generated.
     */
    public function register(Request $request): void
    {
        $name = trim((string) $request->input('name', ''));
        $email = strtolower(trim((string) $request->input('email', '')));
        $password = (string) $request->input('password', '');

        if ($name === '' || $email === '' || strlen($password) < 6) {
            Response::error('name, email, and password (min 6) are required', 422);
            return;
        }

        if (! filter_var($email, FILTER_VALIDATE_EMAIL)) {
            Response::error('Invalid email address', 422);
            return;
        }

        $companyId = (int) ($this->pdo->query(
            "SELECT id FROM companies WHERE code = 'IT' AND is_active = TRUE LIMIT 1"
        )->fetchColumn() ?: 0);

        if ($companyId < 1) {
            $companyId = (int) ($this->pdo->query(
                'SELECT id FROM companies WHERE is_active = TRUE ORDER BY id LIMIT 1'
            )->fetchColumn() ?: 0);
        }

        if ($companyId < 1) {
            Response::error('No company configured in the system', 500);
            return;
        }

        $staffId = 'USR-' . strtoupper(substr(bin2hex(random_bytes(4)), 0, 8));

        $sql = 'INSERT INTO users (
                    company_id, staff_id, name, email, password_hash,
                    role, can_decrypt_vault, is_active
                ) VALUES (
                    :company_id, :staff_id, :name, :email, :password_hash,
                    \'employee\', FALSE, TRUE
                ) RETURNING id, uuid, company_id, staff_id, name, email, phone, role, can_decrypt_vault, is_active';

        try {
            $stmt = $this->pdo->prepare($sql);
            $stmt->execute([
                'company_id' => $companyId,
                'staff_id' => $staffId,
                'name' => $name,
                'email' => $email,
                'password_hash' => password_hash($password, PASSWORD_BCRYPT),
            ]);
        } catch (\Throwable) {
            Response::error('Could not register (email may already exist)', 422);
            return;
        }

        $user = $stmt->fetch();
        if (! $user) {
            Response::error('Registration failed', 500);
            return;
        }

        $plainToken = bin2hex(random_bytes(32));
        $tokenHash = hash('sha256', $plainToken);
        $this->pdo->prepare(
            'INSERT INTO api_access_tokens (user_id, token_hash, label, expires_at)
             VALUES (:user_id, :token_hash, :label, NOW() + INTERVAL \'30 days\')'
        )->execute([
            'user_id' => $user['id'],
            'token_hash' => $tokenHash,
            'label' => 'web-register',
        ]);

        $this->audit->log((int) $user['id'], 'register', $request, (int) $user['id'], [
            'email' => $email,
            'role' => 'employee',
        ]);

        Response::json([
            'token' => $plainToken,
            'user' => $this->publicUser($user),
            'message' => 'Account registered successfully.',
        ], 201);
    }

    public function me(array $user): void
    {
        Response::json(['user' => $this->publicUser($user)]);
    }

    /**
     * PUT /api/me — update own name / phone.
     */
    public function updateProfile(Request $request, array $user): void
    {
        $name = trim((string) $request->input('name', $user['name'] ?? ''));
        $phone = trim((string) $request->input('phone', ''));

        if ($name === '') {
            Response::error('Name is required', 422);
            return;
        }

        $stmt = $this->pdo->prepare(
            'UPDATE users
             SET name = :name,
                 phone = :phone,
                 updated_at = NOW()
             WHERE id = :id
             RETURNING id, uuid, company_id, staff_id, name, email, phone, role, can_decrypt_vault, is_active'
        );
        $stmt->execute([
            'name' => $name,
            'phone' => $phone !== '' ? $phone : null,
            'id' => (int) $user['id'],
        ]);
        $row = $stmt->fetch();
        if (! $row) {
            Response::error('User not found', 404);
            return;
        }

        Response::json(['user' => $this->publicUser($row), 'message' => 'Profile updated']);
    }

    /**
     * POST /api/me/password — change own password.
     */
    public function changePassword(Request $request, array $user): void
    {
        $current = (string) $request->input('current_password', '');
        $new = (string) $request->input('new_password', '');
        $confirm = (string) $request->input('confirm_password', $request->input('new_password_confirmation', ''));

        if (strlen($new) < 6) {
            Response::error('New password must be at least 6 characters', 422);
            return;
        }
        if ($confirm !== '' && $confirm !== $new) {
            Response::error('New password confirmation does not match', 422);
            return;
        }

        $stmt = $this->pdo->prepare('SELECT password_hash FROM users WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => (int) $user['id']]);
        $hash = $stmt->fetchColumn();

        if ($hash !== null && $hash !== '') {
            if ($current === '' || ! password_verify($current, (string) $hash)) {
                Response::error('Current password is incorrect', 422);
                return;
            }
        }

        $upd = $this->pdo->prepare(
            'UPDATE users SET password_hash = :h, updated_at = NOW() WHERE id = :id'
        );
        $upd->execute([
            'h' => password_hash($new, PASSWORD_BCRYPT),
            'id' => (int) $user['id'],
        ]);

        Response::json(['message' => 'Password updated']);
    }

    public function logout(Request $request, array $user): void
    {
        $token = $request->bearerToken();
        if ($token !== null) {
            $this->pdo->prepare('DELETE FROM api_access_tokens WHERE token_hash = :h AND user_id = :u')
                ->execute(['h' => hash('sha256', $token), 'u' => $user['id']]);
        }
        $this->audit->log((int) $user['id'], 'logout', $request, (int) $user['id'], [
            'email' => $user['email'] ?? null,
        ]);
        Response::json(['message' => 'Logged out']);
    }

    /** @param array<string, mixed> $user */
    private function publicUser(array $user): array
    {
        return [
            'id' => (int) $user['id'],
            'uuid' => $user['uuid'] ?? null,
            'company_id' => (int) $user['company_id'],
            'staff_id' => $user['staff_id'],
            'name' => $user['name'],
            'email' => $user['email'],
            'phone' => $user['phone'] ?? null,
            'role' => $user['role'],
            'can_decrypt_vault' => self::isTruthy($user['can_decrypt_vault'] ?? false),
        ];
    }

    private static function isTruthy(mixed $v): bool
    {
        return $v === true || $v === 1 || $v === '1' || $v === 't' || $v === 'true';
    }
}
