<?php

declare(strict_types=1);

namespace Indra\Itam\Controllers;

use Indra\Itam\Http\Request;
use Indra\Itam\Http\Response;
use Indra\Itam\Support\Auth;
use PDO;
use Throwable;

final class AssetAttachmentController
{
    private const MAX_FILES = 10;
    private const MAX_BYTES = 10 * 1024 * 1024;

    /** @var list<string> */
    private const ALLOWED_EXT = [
        'jpg', 'jpeg', 'png', 'gif', 'webp',
        'pdf', 'txt', 'csv', 'log',
        'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
        'zip',
    ];

    /** @var array<string, string> */
    private const TABLES = [
        'laptop' => 'laptops',
        'mobile_phone' => 'mobile_phones',
        'pc' => 'pcs',
        'printer' => 'printers',
        'other' => 'other_assets',
    ];

    public function __construct(private readonly PDO $pdo)
    {
        $this->ensureTable();
    }

    public function index(Request $request, array $user, array $params): void
    {
        $asset = $this->resolveAsset($params, $user);
        if ($asset === null) {
            return;
        }
        Response::json(['data' => $this->loadAttachments($asset['category'], $asset['id'])]);
    }

    public function upload(Request $request, array $user, array $params): void
    {
        $asset = $this->resolveAsset($params, $user);
        if ($asset === null) {
            return;
        }

        $existing = $this->loadAttachments($asset['category'], $asset['id']);
        if (count($existing) >= self::MAX_FILES) {
            Response::error('Maximum of ' . self::MAX_FILES . ' files per asset', 422);
            return;
        }

        $uploaded = $_FILES['file'] ?? $_FILES['document'] ?? null;
        if (! is_array($uploaded) || ($uploaded['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            Response::error('Upload a file', 422);
            return;
        }

        $origName = basename((string) ($uploaded['name'] ?? 'file'));
        $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
        if (! in_array($ext, self::ALLOWED_EXT, true)) {
            Response::error('Allowed: ' . implode(', ', self::ALLOWED_EXT), 422);
            return;
        }

        $size = (int) ($uploaded['size'] ?? 0);
        if ($size <= 0 || $size > self::MAX_BYTES) {
            Response::error('Each file must be under 10 MB', 422);
            return;
        }

        $tmp = (string) ($uploaded['tmp_name'] ?? '');
        if ($tmp === '' || ! is_uploaded_file($tmp)) {
            Response::error('Invalid upload', 422);
            return;
        }

        $dir = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'storage' . DIRECTORY_SEPARATOR . 'assets';
        if (! is_dir($dir) && ! mkdir($dir, 0755, true) && ! is_dir($dir)) {
            Response::error('Could not create attachment storage', 500);
            return;
        }

        $safe = sprintf(
            'asset_%s_%d_%s_%s.%s',
            preg_replace('/[^a-z0-9_]+/i', '', $asset['category']) ?: 'asset',
            $asset['id'],
            date('YmdHis'),
            bin2hex(random_bytes(4)),
            $ext
        );
        $dest = $dir . DIRECTORY_SEPARATOR . $safe;
        if (! move_uploaded_file($tmp, $dest)) {
            Response::error('Could not save file', 500);
            return;
        }

        $this->pdo->prepare(
            'INSERT INTO asset_attachments
                (asset_type, asset_id, file_name, stored_path, mime_type, file_size, uploaded_by)
             VALUES (:atype, :aid, :fname, :path, :mime, :size, :uid)'
        )->execute([
            'atype' => $asset['category'],
            'aid' => $asset['id'],
            'fname' => $origName,
            'path' => $dest,
            'mime' => $this->mimeForExt($ext),
            'size' => $size,
            'uid' => (int) ($user['id'] ?? 0) ?: null,
        ]);

        Response::json([
            'message' => 'File uploaded',
            'data' => $this->loadAttachments($asset['category'], $asset['id']),
        ], 201);
    }

    public function download(Request $request, array $user, array $params): void
    {
        $asset = $this->resolveAsset($params, $user);
        if ($asset === null) {
            return;
        }

        $attachmentId = (int) ($params['attachmentId'] ?? 0);
        $stmt = $this->pdo->prepare(
            'SELECT * FROM asset_attachments
             WHERE id = :aid AND asset_type = :atype AND asset_id = :id
             LIMIT 1'
        );
        $stmt->execute([
            'aid' => $attachmentId,
            'atype' => $asset['category'],
            'id' => $asset['id'],
        ]);
        $att = $stmt->fetch(PDO::FETCH_ASSOC);
        if (! is_array($att)) {
            Response::error('Attachment not found', 404);
            return;
        }

        $path = (string) ($att['stored_path'] ?? '');
        if ($path === '' || ! is_file($path)) {
            Response::error('File missing on disk', 404);
            return;
        }

        header('Content-Type: ' . (string) ($att['mime_type'] ?? 'application/octet-stream'));
        header('Content-Length: ' . (string) filesize($path));
        header(
            'Content-Disposition: attachment; filename="' .
            str_replace('"', '', (string) $att['file_name']) . '"'
        );
        readfile($path);
        exit;
    }

    public function destroy(Request $request, array $user, array $params): void
    {
        $asset = $this->resolveAsset($params, $user);
        if ($asset === null) {
            return;
        }

        $attachmentId = (int) ($params['attachmentId'] ?? 0);
        $stmt = $this->pdo->prepare(
            'SELECT * FROM asset_attachments
             WHERE id = :aid AND asset_type = :atype AND asset_id = :id
             LIMIT 1'
        );
        $stmt->execute([
            'aid' => $attachmentId,
            'atype' => $asset['category'],
            'id' => $asset['id'],
        ]);
        $att = $stmt->fetch(PDO::FETCH_ASSOC);
        if (! is_array($att)) {
            Response::error('Attachment not found', 404);
            return;
        }

        $path = (string) ($att['stored_path'] ?? '');
        $this->pdo->prepare('DELETE FROM asset_attachments WHERE id = :id')->execute(['id' => $attachmentId]);
        if ($path !== '' && is_file($path)) {
            @unlink($path);
        }

        Response::json([
            'message' => 'Attachment deleted',
            'data' => $this->loadAttachments($asset['category'], $asset['id']),
        ]);
    }

    /**
     * @param array<string, string> $params
     * @param array<string, mixed> $user
     * @return array{category: string, id: int, company_id: int}|null
     */
    private function resolveAsset(array $params, array $user): ?array
    {
        $category = strtolower(trim((string) ($params['category'] ?? '')));
        if ($category === 'mobile') {
            $category = 'mobile_phone';
        }
        if ($category === 'desktop_pc' || $category === 'desktop') {
            $category = 'pc';
        }
        $id = (int) ($params['id'] ?? 0);
        if ($id < 1 || ! isset(self::TABLES[$category])) {
            Response::error('Valid category and id required', 422);
            return null;
        }

        $table = self::TABLES[$category];
        $stmt = $this->pdo->prepare("SELECT id, company_id FROM {$table} WHERE id = :id LIMIT 1");
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        if (! is_array($row)) {
            Response::error('Asset not found', 404);
            return null;
        }

        Auth::assertCompanyAccess($user, (int) $row['company_id']);

        return [
            'category' => $category,
            'id' => (int) $row['id'],
            'company_id' => (int) $row['company_id'],
        ];
    }

    /** @return list<array<string, mixed>> */
    private function loadAttachments(string $category, int $assetId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT a.id, a.asset_type, a.asset_id, a.file_name, a.mime_type, a.file_size,
                    a.uploaded_by, a.created_at, u.name AS uploaded_by_name
             FROM asset_attachments a
             LEFT JOIN users u ON u.id = a.uploaded_by
             WHERE a.asset_type = :atype AND a.asset_id = :aid
             ORDER BY a.id ASC'
        );
        $stmt->execute(['atype' => $category, 'aid' => $assetId]);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        foreach ($rows as &$row) {
            unset($row['stored_path']);
        }
        unset($row);
        return $rows;
    }

    private function mimeForExt(string $ext): string
    {
        return match ($ext) {
            'pdf' => 'application/pdf',
            'png' => 'image/png',
            'jpg', 'jpeg' => 'image/jpeg',
            'gif' => 'image/gif',
            'webp' => 'image/webp',
            'txt', 'log', 'csv' => 'text/plain',
            'doc' => 'application/msword',
            'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'xls' => 'application/vnd.ms-excel',
            'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'ppt' => 'application/vnd.ms-powerpoint',
            'pptx' => 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
            'zip' => 'application/zip',
            default => 'application/octet-stream',
        };
    }

    private function ensureTable(): void
    {
        try {
            $this->pdo->exec(
                'CREATE TABLE IF NOT EXISTS asset_attachments (
                    id BIGSERIAL PRIMARY KEY,
                    asset_type VARCHAR(32) NOT NULL,
                    asset_id BIGINT NOT NULL,
                    file_name VARCHAR(255) NOT NULL,
                    stored_path TEXT NOT NULL,
                    mime_type VARCHAR(120),
                    file_size BIGINT,
                    uploaded_by BIGINT REFERENCES users(id) ON DELETE SET NULL,
                    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
                )'
            );
            $this->pdo->exec(
                'CREATE INDEX IF NOT EXISTS idx_asset_attachments_asset
                 ON asset_attachments (asset_type, asset_id)'
            );
        } catch (Throwable) {
            /* table may already exist under restricted role */
        }
    }
}
