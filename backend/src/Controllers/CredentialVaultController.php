<?php

declare(strict_types=1);

namespace Indra\Itam\Controllers;

use Indra\Itam\Http\Request;
use Indra\Itam\Http\Response;
use Indra\Itam\Services\CredentialEncryptionService;
use Indra\Itam\Support\Auth;
use PDO;
use Throwable;

final class CredentialVaultController
{
    public function __construct(
        private readonly PDO $pdo,
        private readonly CredentialEncryptionService $vault,
    ) {
    }

    public function index(Request $request, array $user): void
    {
        $sql = 'SELECT c.id, c.uuid, c.company_id, c.location_id, c.assigned_user_id, c.asset_id,
                       c.credential_type, c.system_name, c.username, c.email_address,
                       c.password_ciphertext, c.password_hint, c.url, c.last_rotated_at, c.expires_at, c.is_active,
                       co.short_name AS company_short, co.code AS company_code,
                       l.name AS location_name, l.city AS location_city,
                       u.name AS assigned_user_name
                FROM credentials c
                JOIN companies co ON co.id = c.company_id
                LEFT JOIN locations l ON l.id = c.location_id
                LEFT JOIN users u ON u.id = c.assigned_user_id
                WHERE c.is_active = TRUE';
        $params = [];
        if (($user['role'] ?? '') !== 'super_admin') {
            $sql .= ' AND c.company_id = :company_id';
            $params['company_id'] = $user['company_id'];
        } elseif ($request->input('company_id')) {
            $sql .= ' AND c.company_id = :company_id';
            $params['company_id'] = (int) $request->input('company_id');
        }

        if ($request->input('company_code')) {
            $sql .= ' AND co.code = :company_code';
            $params['company_code'] = strtoupper((string) $request->input('company_code'));
        }

        if ($request->input('credential_type')) {
            $sql .= ' AND c.credential_type = :credential_type';
            $params['credential_type'] = (string) $request->input('credential_type');
        }

        if ($request->input('location_id')) {
            $sql .= ' AND c.location_id = :location_id';
            $params['location_id'] = (int) $request->input('location_id');
        }

        $sql .= ' ORDER BY c.id DESC LIMIT 500';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll();
        foreach ($rows as &$row) {
            $cipher = (string) ($row['password_ciphertext'] ?? '');
            unset($row['password_ciphertext']);
            $has = false;
            if ($cipher !== '') {
                try {
                    $has = $this->vault->decrypt($cipher) !== '';
                } catch (Throwable) {
                    $has = true;
                }
            }
            $row['has_password'] = $has;
        }
        unset($row);
        Response::json(['data' => $rows]);
    }

    public function store(Request $request, array $user): void
    {
        $companyId = (int) $request->input('company_id', 0);
        $password = (string) $request->input('password', '');
        $systemName = trim((string) $request->input('system_name', ''));
        $username = trim((string) $request->input('username', ''));
        $type = (string) $request->input('credential_type', 'email');

        $allowedTypes = ['email', 'erp', 'system_login', 'vpn', 'wifi', 'other'];

        if ($type === 'wifi' && $username === '') {
            $username = 'wifi';
        }

        // WiFi may be blank (shown as N/A); other types still need a password
        if ($companyId < 1 || $systemName === '' || $username === '') {
            Response::error('Invalid credential payload', 422);
            return;
        }
        if ($type === 'wifi') {
            // blank allowed
        } elseif (strlen($password) < 8) {
            Response::error('Password must be at least 8 characters', 422);
            return;
        }
        if (! in_array($type, $allowedTypes, true)) {
            Response::error('Invalid credential_type', 422);
            return;
        }

        Auth::assertCompanyAccess($user, $companyId);

        $locationId = $request->input('location_id') ? (int) $request->input('location_id') : null;
        if ($locationId !== null && $locationId > 0) {
            if (! $this->locationBelongsToCompany($locationId, $companyId)) {
                Response::error('Location does not belong to the selected company', 422);
                return;
            }
        } else {
            $locationId = null;
        }

        $notes = $request->input('notes');
        $notesCipher = is_string($notes) && $notes !== '' ? $this->vault->encrypt($notes) : null;

        $sql = 'INSERT INTO credentials (
                    company_id, location_id, assigned_user_id, asset_id, credential_type, system_name,
                    username, email_address, password_ciphertext, encryption_version,
                    password_hint, url, notes_ciphertext, created_by, updated_by
                ) VALUES (
                    :company_id, :location_id, :assigned_user_id, :asset_id, :credential_type, :system_name,
                    :username, :email_address, :password_ciphertext, 1,
                    :password_hint, :url, :notes_ciphertext, :created_by, :updated_by
                )';

        $isPgsql = $this->pdo->getAttribute(PDO::ATTR_DRIVER_NAME) === 'pgsql';
        if ($isPgsql) {
            $sql .= ' RETURNING id, uuid';
        }

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([
            'company_id' => $companyId,
            'location_id' => $locationId,
            'assigned_user_id' => $request->input('assigned_user_id') ?: null,
            'asset_id' => $request->input('asset_id') ?: null,
            'credential_type' => $type,
            'system_name' => $systemName,
            'username' => $username,
            'email_address' => $request->input('email_address') ?: null,
            'password_ciphertext' => $this->vault->encrypt($password),
            'password_hint' => $request->input('password_hint') ?: null,
            'url' => $request->input('url') ?: null,
            'notes_ciphertext' => $notesCipher,
            'created_by' => $user['id'],
            'updated_by' => $user['id'],
        ]);

        if ($isPgsql) {
            $row = $stmt->fetch() ?: [];
            $id = (int) ($row['id'] ?? 0);
            $uuid = $row['uuid'] ?? null;
        } else {
            $id = (int) $this->pdo->lastInsertId();
            $uuidStmt = $this->pdo->prepare('SELECT uuid FROM credentials WHERE id = :id');
            $uuidStmt->execute(['id' => $id]);
            $uuid = $uuidStmt->fetchColumn() ?: null;
        }

        $this->audit($id, $user, $request, 'create');

        Response::json([
            'id' => $id,
            'uuid' => $uuid,
            'message' => 'Credential stored securely.',
        ], 201);
    }

    public function reveal(Request $request, array $user, array $params): void
    {
        if (! Auth::canDecryptVault($user)) {
            Response::error('Not authorized to decrypt vault secrets', 403);
            return;
        }

        $credential = $this->findCredential($params['id'] ?? '');
        if ($credential === null) {
            Response::error('Credential not found', 404);
            return;
        }

        Auth::assertCompanyAccess($user, (int) $credential['company_id']);

        try {
            $plaintext = $this->vault->decrypt($credential['password_ciphertext']);
        } catch (Throwable $e) {
            Response::error('Unable to decrypt credential secret', 500);
            return;
        }

        $this->audit((int) $credential['id'], $user, $request, 'view_decrypt');

        Response::json([
            'id' => $credential['id'],
            'system_name' => $credential['system_name'],
            'username' => $credential['username'],
            'password' => $plaintext,
            'ttl_seconds' => 10,
        ]);
    }

    public function updatePassword(Request $request, array $user, array $params): void
    {
        if (! Auth::canDecryptVault($user)) {
            Response::error('Not authorized to update vault secrets', 403);
            return;
        }

        $credential = $this->findCredential($params['id'] ?? '');
        if ($credential === null) {
            Response::error('Credential not found', 404);
            return;
        }

        Auth::assertCompanyAccess($user, (int) $credential['company_id']);

        $password = (string) $request->input('password', '');
        $minLen = ($credential['credential_type'] ?? '') === 'wifi' ? 4 : 8;
        if (strlen($password) < $minLen) {
            Response::error("Password must be at least {$minLen} characters", 422);
            return;
        }

        $stmt = $this->pdo->prepare(
            'UPDATE credentials
             SET password_ciphertext = :cipher,
                 last_rotated_at = CURRENT_DATE,
                 updated_by = :updated_by,
                 updated_at = NOW()
             WHERE id = :id'
        );
        $stmt->execute([
            'cipher' => $this->vault->encrypt($password),
            'updated_by' => $user['id'],
            'id' => $credential['id'],
        ]);

        $this->audit((int) $credential['id'], $user, $request, 'update');
        Response::json(['message' => 'Password rotated securely.']);
    }

    public function update(Request $request, array $user, array $params): void
    {
        $credential = $this->findCredential($params['id'] ?? '');
        if ($credential === null || ! ($credential['is_active'] ?? true)) {
            Response::error('Credential not found', 404);
            return;
        }

        Auth::assertCompanyAccess($user, (int) $credential['company_id']);

        $systemName = trim((string) $request->input('system_name', $credential['system_name']));
        $password = (string) $request->input('password', '');
        $type = (string) ($credential['credential_type'] ?? 'other');

        $companyId = (int) $credential['company_id'];
        if ($request->input('company_id') !== null && $request->input('company_id') !== '') {
            $companyId = (int) $request->input('company_id');
            if ($companyId < 1) {
                Response::error('Invalid company', 422);
                return;
            }
            Auth::assertCompanyAccess($user, $companyId);
        }

        $locationId = $credential['location_id'] ?? null;
        if (array_key_exists('location_id', $request->body)) {
            $rawLoc = $request->body['location_id'];
            $locationId = $rawLoc !== null && $rawLoc !== '' ? (int) $rawLoc : null;
        }
        if ($locationId !== null && $locationId > 0) {
            if (! $this->locationBelongsToCompany((int) $locationId, $companyId)) {
                Response::error('Location does not belong to the selected company', 422);
                return;
            }
        } else {
            $locationId = null;
        }

        if ($systemName === '') {
            Response::error('Invalid credential payload', 422);
            return;
        }
        if ($password !== '') {
            $minLen = $type === 'wifi' ? 4 : 8;
            if (strlen($password) < $minLen) {
                Response::error("Password must be at least {$minLen} characters", 422);
                return;
            }
        }

        $sql = 'UPDATE credentials
                SET system_name = :system_name,
                    company_id = :company_id,
                    location_id = :location_id,
                    updated_by = :updated_by,
                    updated_at = NOW()';
        $paramsBind = [
            'system_name' => $systemName,
            'company_id' => $companyId,
            'location_id' => $locationId,
            'updated_by' => $user['id'],
            'id' => $credential['id'],
        ];
        if ($password !== '') {
            $sql .= ', password_ciphertext = :cipher, last_rotated_at = CURRENT_DATE';
            $paramsBind['cipher'] = $this->vault->encrypt($password);
        }
        $sql .= ' WHERE id = :id';

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($paramsBind);

        $this->audit((int) $credential['id'], $user, $request, 'update');
        Response::json([
            'message' => 'Credential updated.',
            'company_id' => $companyId,
            'location_id' => $locationId,
        ]);
    }

    public function destroy(Request $request, array $user, array $params): void
    {
        $credential = $this->findCredential($params['id'] ?? '');
        if ($credential === null || ! ($credential['is_active'] ?? true)) {
            Response::error('Credential not found', 404);
            return;
        }

        Auth::assertCompanyAccess($user, (int) $credential['company_id']);

        $stmt = $this->pdo->prepare(
            'UPDATE credentials
             SET is_active = FALSE, updated_by = :updated_by, updated_at = NOW()
             WHERE id = :id'
        );
        $stmt->execute([
            'updated_by' => $user['id'],
            'id' => $credential['id'],
        ]);

        $this->audit((int) $credential['id'], $user, $request, 'delete');
        Response::json(['message' => 'Credential deleted.']);
    }

    /** @return array<string, mixed>|null */
    private function findCredential(string $id): ?array
    {
        if ($id === '' || ! ctype_digit($id)) {
            return null;
        }
        $stmt = $this->pdo->prepare('SELECT * FROM credentials WHERE id = :id LIMIT 1');
        $stmt->execute(['id' => (int) $id]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    private function locationBelongsToCompany(int $locationId, int $companyId): bool
    {
        $stmt = $this->pdo->prepare(
            'SELECT 1 FROM locations WHERE id = :id AND company_id = :company_id LIMIT 1'
        );
        $stmt->execute(['id' => $locationId, 'company_id' => $companyId]);
        return (bool) $stmt->fetchColumn();
    }

    private function audit(int $credentialId, array $user, Request $request, string $action): void
    {
        $stmt = $this->pdo->prepare(
            'INSERT INTO credential_access_logs (credential_id, accessed_by, action, ip_address, user_agent, created_at)
             VALUES (:credential_id, :accessed_by, :action, :ip_address, :user_agent, NOW())'
        );
        $ua = $request->userAgent();
        $stmt->execute([
            'credential_id' => $credentialId,
            'accessed_by' => $user['id'],
            'action' => $action,
            'ip_address' => $request->ip(),
            'user_agent' => $ua !== null ? substr($ua, 0, 255) : null,
        ]);
    }
}
