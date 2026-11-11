<?php

declare(strict_types=1);

namespace Indra\Itam\Controllers;

use Indra\Itam\Http\Request;
use Indra\Itam\Http\Response;
use Indra\Itam\Services\BackupService;
use Indra\Itam\Services\SystemAuditService;
use PDO;
use Throwable;

final class BackupController
{
    private readonly BackupService $backups;
    private readonly SystemAuditService $audit;

    public function __construct(private readonly PDO $pdo, string $projectRoot, string $dbHost = 'local')
    {
        $dir = rtrim($projectRoot, '/\\') . DIRECTORY_SEPARATOR . 'backups';
        $this->backups = new BackupService($pdo, $dir, $dbHost);
        $this->audit = new SystemAuditService($pdo);
    }

    public function index(Request $request, array $user): void
    {
        if (! $this->canManage($user)) {
            Response::error('Only IT admins can manage backups', 403);
            return;
        }
        Response::json(['data' => $this->backups->list()]);
    }

    public function create(Request $request, array $user): void
    {
        if (! $this->canManage($user)) {
            Response::error('Only IT admins can create backups', 403);
            return;
        }

        try {
            @set_time_limit(300);
            $result = $this->backups->create();
        } catch (Throwable $e) {
            Response::error('Backup failed: ' . $e->getMessage(), 500);
            return;
        }

        $this->audit->log((int) $user['id'], 'backup_create', $request, null, [
            'file' => $result['file'],
            'bytes' => $result['bytes'],
            'total_rows' => $result['total_rows'],
        ]);

        Response::json([
            'message' => 'Backup created',
            'data' => $result,
        ], 201);
    }

    public function download(Request $request, array $user, string $file): void
    {
        if (! $this->canManage($user)) {
            Response::error('Only IT admins can download backups', 403);
            return;
        }

        try {
            $path = $this->backups->resolvePath($file);
        } catch (Throwable $e) {
            Response::error($e->getMessage(), 404);
            return;
        }

        $this->audit->log((int) $user['id'], 'backup_download', $request, null, [
            'file' => basename($path),
        ]);

        http_response_code(200);
        header('Content-Type: application/sql; charset=utf-8');
        header('Content-Disposition: attachment; filename="' . basename($path) . '"');
        header('Content-Length: ' . (string) filesize($path));
        header('Cache-Control: no-store');
        readfile($path);
        exit;
    }

    /** Restore from a backup already stored on the server. */
    public function restore(Request $request, array $user): void
    {
        if (($user['role'] ?? '') !== 'super_admin') {
            Response::error('Only super_admin can restore backups', 403);
            return;
        }

        $file = trim((string) $request->input('file', ''));
        if ($file === '') {
            Response::error('file is required', 422);
            return;
        }

        try {
            $path = $this->backups->resolvePath($file);
            @set_time_limit(300);
            $result = $this->backups->restoreFromFile($path);
        } catch (Throwable $e) {
            Response::error('Restore failed: ' . $e->getMessage(), 500);
            return;
        }

        $this->audit->log((int) $user['id'], 'backup_restore', $request, null, [
            'file' => basename($path),
            'statements' => $result['statements'],
            'tables_touched' => $result['tables_touched'],
        ]);

        Response::json([
            'message' => 'Database restored from backup. Please sign in again if your session was reset.',
            'data' => [
                'file' => basename($path),
                'statements' => $result['statements'],
                'tables_touched' => $result['tables_touched'],
            ],
        ]);
    }

    /** Upload a .sql backup and restore it. */
    public function restoreUpload(Request $request, array $user): void
    {
        if (($user['role'] ?? '') !== 'super_admin') {
            Response::error('Only super_admin can restore backups', 403);
            return;
        }

        $uploaded = $_FILES['file'] ?? null;
        if (! is_array($uploaded) || ($uploaded['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            Response::error('Upload a .sql backup file', 422);
            return;
        }

        $name = basename((string) ($uploaded['name'] ?? 'upload.sql'));
        if (! str_ends_with(strtolower($name), '.sql')) {
            Response::error('Only .sql backup files are allowed', 422);
            return;
        }

        $tmp = (string) ($uploaded['tmp_name'] ?? '');
        if ($tmp === '' || ! is_uploaded_file($tmp)) {
            Response::error('Invalid upload', 422);
            return;
        }

        $stamp = date('Ymd_His');
        $safeName = 'itams_upload_backup_' . $stamp . '.sql';
        $dest = $this->backups->directory() . DIRECTORY_SEPARATOR . $safeName;
        if (! move_uploaded_file($tmp, $dest)) {
            Response::error('Could not save uploaded backup', 500);
            return;
        }

        try {
            @set_time_limit(300);
            $result = $this->backups->restoreFromFile($dest);
        } catch (Throwable $e) {
            Response::error('Restore failed: ' . $e->getMessage(), 500);
            return;
        }

        file_put_contents(
            preg_replace('/\.sql$/', '_manifest.json', $dest) ?: ($dest . '.json'),
            json_encode([
                'created_at' => date('c'),
                'source_host' => 'upload',
                'file' => $safeName,
                'bytes' => filesize($dest),
                'total_rows' => null,
                'tables' => null,
                'uploaded_as' => $name,
            ], JSON_PRETTY_PRINT)
        );

        $this->audit->log((int) $user['id'], 'backup_restore', $request, null, [
            'file' => $safeName,
            'uploaded_as' => $name,
            'statements' => $result['statements'],
        ]);

        Response::json([
            'message' => 'Database restored from uploaded backup. Please sign in again if your session was reset.',
            'data' => [
                'file' => $safeName,
                'statements' => $result['statements'],
                'tables_touched' => $result['tables_touched'],
            ],
        ]);
    }

    /** @param array<string, mixed> $user */
    private function canManage(array $user): bool
    {
        return in_array($user['role'] ?? '', ['super_admin', 'it_admin'], true);
    }
}
