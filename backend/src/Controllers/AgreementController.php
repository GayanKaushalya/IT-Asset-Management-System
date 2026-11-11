<?php

declare(strict_types=1);

namespace Indra\Itam\Controllers;

use Indra\Itam\Http\Request;
use Indra\Itam\Http\Response;
use PDO;

final class AgreementController
{
    private const TYPES = ['software', 'hardware', 'networking'];
    private const STATUSES = ['active', 'expiring', 'expired', 'cancelled', 'draft'];

    public function __construct(private readonly PDO $pdo)
    {
    }

    /** GET /api/agreements?company=&type=&status=&q= */
    public function index(Request $request, array $user): void
    {
        $this->ensureTable();

        $company = strtoupper(trim((string) $request->input('company', '')));
        if ($company === 'ITL') {
            $company = 'IT';
        }
        $type = strtolower(trim((string) $request->input('type', '')));
        $status = strtolower(trim((string) $request->input('status', '')));
        $q = trim((string) $request->input('q', ''));

        $sql = $this->selectSql() . ' WHERE a.is_active = TRUE';
        $params = [];

        if (($user['role'] ?? '') !== 'super_admin') {
            $sql .= ' AND (a.company_id = :user_company OR a.company_id IS NULL)';
            $params['user_company'] = (int) ($user['company_id'] ?? 0);
        } elseif ($company !== '' && $company !== 'ALL') {
            $sql .= ' AND c.code = :company_code';
            $params['company_code'] = $company;
        }

        if ($type !== '' && in_array($type, self::TYPES, true)) {
            $sql .= ' AND a.agreement_type = :atype';
            $params['atype'] = $type;
        }

        if ($status !== '' && in_array($status, self::STATUSES, true)) {
            $sql .= ' AND a.status = :astatus';
            $params['astatus'] = $status;
        }

        if ($q !== '') {
            $sql .= ' AND (
                a.vendor_name ILIKE :q OR a.title ILIKE :q OR a.contract_ref ILIKE :q
                OR a.contact_person ILIKE :q OR a.terms ILIKE :q OR a.notes ILIKE :q
            )';
            $params['q'] = '%' . $q . '%';
        }

        $sql .= ' ORDER BY
            CASE a.status
                WHEN \'expiring\' THEN 0
                WHEN \'active\' THEN 1
                WHEN \'draft\' THEN 2
                WHEN \'expired\' THEN 3
                WHEN \'cancelled\' THEN 4
                ELSE 5
            END,
            a.end_date ASC NULLS LAST,
            a.vendor_name ASC,
            a.title ASC';

        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        foreach ($rows as &$row) {
            $row = $this->enrichRow($row);
        }
        unset($row);

        Response::json(['data' => $rows, 'meta' => ['total' => count($rows)]]);
    }

    /** GET /api/agreements/{id} */
    public function show(Request $request, array $user, string $id): void
    {
        $this->ensureTable();
        $row = $this->find((int) $id);
        if ($row === null) {
            Response::error('Agreement not found', 404);
            return;
        }
        if (! $this->canView($user, $row)) {
            Response::error('Not allowed', 403);
            return;
        }
        Response::json(['data' => $this->enrichRow($row)]);
    }

    /** POST /api/agreements */
    public function store(Request $request, array $user): void
    {
        if (! $this->canManage($user)) {
            Response::error('Only IT staff can manage agreements', 403);
            return;
        }
        $this->ensureTable();

        $payload = $this->parsePayload($request, $user, null);
        if (isset($payload['error'])) {
            Response::error($payload['error'], 422);
            return;
        }

        $stmt = $this->pdo->prepare(
            'INSERT INTO vendor_agreements (
                company_id, agreement_type, vendor_name, title, contract_ref,
                start_date, end_date, renewal_date, auto_renewing, status,
                value_amount, currency, contact_person, contact_phone, contact_email,
                terms, notes, created_by, updated_by
             ) VALUES (
                :company_id, :agreement_type, :vendor_name, :title, :contract_ref,
                :start_date, :end_date, :renewal_date, :auto_renewing, :status,
                :value_amount, :currency, :contact_person, :contact_phone, :contact_email,
                :terms, :notes, :uid, :uid
             ) RETURNING id'
        );
        $stmt->execute([
            ...$payload,
            'uid' => (int) ($user['id'] ?? 0) ?: null,
        ]);
        $id = (int) $stmt->fetchColumn();
        $this->logEvent($id, 'created', 'Agreement Started & Registered', $this->createdDetail($payload), $user);
        $row = $this->find($id);
        Response::json(['data' => $this->enrichRow($row ?? []), 'message' => 'Agreement created'], 201);
    }

    /** PUT /api/agreements/{id} */
    public function update(Request $request, array $user, string $id): void
    {
        if (! $this->canManage($user)) {
            Response::error('Only IT staff can manage agreements', 403);
            return;
        }
        $this->ensureTable();

        $existing = $this->find((int) $id);
        if ($existing === null) {
            Response::error('Agreement not found', 404);
            return;
        }
        if (! $this->canView($user, $existing)) {
            Response::error('Not allowed', 403);
            return;
        }

        $payload = $this->parsePayload($request, $user, $existing);
        if (isset($payload['error'])) {
            Response::error($payload['error'], 422);
            return;
        }

        $stmt = $this->pdo->prepare(
            'UPDATE vendor_agreements SET
                company_id = :company_id,
                agreement_type = :agreement_type,
                vendor_name = :vendor_name,
                title = :title,
                contract_ref = :contract_ref,
                start_date = :start_date,
                end_date = :end_date,
                renewal_date = :renewal_date,
                auto_renewing = :auto_renewing,
                status = :status,
                value_amount = :value_amount,
                currency = :currency,
                contact_person = :contact_person,
                contact_phone = :contact_phone,
                contact_email = :contact_email,
                terms = :terms,
                notes = :notes,
                updated_by = :uid,
                updated_at = NOW()
             WHERE id = :id'
        );
        $stmt->execute([
            ...$payload,
            'uid' => (int) ($user['id'] ?? 0) ?: null,
            'id' => (int) $id,
        ]);

        $explicitRenew = filter_var($request->input('record_renewal', false), FILTER_VALIDATE_BOOLEAN);
        $change = $this->describeChanges($existing, $payload, $explicitRenew);
        if ($change !== null) {
            $this->logEvent((int) $id, $change['type'], $change['title'], $change['detail'], $user);
        }

        $row = $this->find((int) $id);
        Response::json(['data' => $this->enrichRow($row ?? []), 'message' => 'Agreement updated']);
    }

    /**
     * POST /api/agreements/{id}/renew
     * Extend end / renewal dates and log a renewal event.
     */
    public function renew(Request $request, array $user, string $id): void
    {
        if (! $this->canManage($user)) {
            Response::error('Only IT staff can manage agreements', 403);
            return;
        }
        $this->ensureTable();
        $existing = $this->find((int) $id);
        if ($existing === null) {
            Response::error('Agreement not found', 404);
            return;
        }
        if (! $this->canView($user, $existing)) {
            Response::error('Not allowed', 403);
            return;
        }

        $newEnd = $this->nullDate($request->input('end_date'));
        $newRenewal = $this->nullDate($request->input('renewal_date'));
        $note = $this->nullStr($request->input('note', $request->input('reason', null)));

        if ($newEnd === null && $newRenewal === null) {
            // Default: push end date by 1 year from current end or today
            $base = $this->nullDate($existing['end_date'] ?? null) ?? date('Y-m-d');
            $ts = strtotime($base . ' +1 year');
            $newEnd = $ts ? date('Y-m-d', $ts) : null;
            if ($newEnd === null) {
                Response::error('Could not compute renewal end date', 422);
                return;
            }
            $renewTs = strtotime($newEnd . ' -30 days');
            $newRenewal = $renewTs ? date('Y-m-d', $renewTs) : $newRenewal;
        }

        $oldEnd = $this->nullDate($existing['end_date'] ?? null);
        $oldRenewal = $this->nullDate($existing['renewal_date'] ?? null);
        $status = $this->computeStatus('active', $newEnd ?? $oldEnd);

        $this->pdo->prepare(
            'UPDATE vendor_agreements SET
                end_date = COALESCE(:end_date, end_date),
                renewal_date = COALESCE(:renewal_date, renewal_date),
                status = :status,
                updated_by = :uid,
                updated_at = NOW()
             WHERE id = :id'
        )->execute([
            'end_date' => $newEnd,
            'renewal_date' => $newRenewal,
            'status' => $status,
            'uid' => (int) ($user['id'] ?? 0) ?: null,
            'id' => (int) $id,
        ]);

        $bits = [];
        if ($newEnd !== null) {
            $bits[] = 'Term extended to ' . $newEnd . ($oldEnd ? ' (was ' . $oldEnd . ')' : '');
        }
        if ($newRenewal !== null) {
            $bits[] = 'Next renewal decision ' . $newRenewal;
        }
        if ($note !== null) {
            $bits[] = $note;
        }
        $vendor = (string) ($existing['vendor_name'] ?? 'vendor');
        $this->logEvent(
            (int) $id,
            'renewed',
            'Agreement Renewed',
            $bits !== []
                ? 'Contract with ' . $vendor . ' renewed · ' . implode(' · ', $bits) . '.'
                : 'Contract with ' . $vendor . ' renewed under the same commercial terms.',
            $user
        );

        $row = $this->find((int) $id);
        Response::json(['data' => $this->enrichRow($row ?? []), 'message' => 'Agreement renewed']);
    }

    /** GET /api/agreements/{id}/history */
    public function history(Request $request, array $user, string $id): void
    {
        unset($request);
        $this->ensureTable();
        $existing = $this->find((int) $id);
        if ($existing === null) {
            Response::error('Agreement not found', 404);
            return;
        }
        if (! $this->canView($user, $existing)) {
            Response::error('Not allowed', 403);
            return;
        }

        try {
            $stmt = $this->pdo->prepare(
                'SELECT h.id, h.event_type, h.title, h.detail, h.created_at,
                        u.name AS changed_by_name
                 FROM vendor_agreement_history h
                 LEFT JOIN users u ON u.id = h.changed_by
                 WHERE h.agreement_id = :id
                 ORDER BY h.created_at ASC, h.id ASC'
            );
            $stmt->execute(['id' => (int) $id]);
            $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        } catch (\Throwable) {
            $rows = [];
        }

        $events = [];
        $hasCreated = false;
        foreach ($rows as $r) {
            $type = (string) ($r['event_type'] ?? 'updated');
            if ($type === 'created') {
                $hasCreated = true;
            }
            $title = $this->displayTitle($type, (string) ($r['title'] ?? ''));
            $detail = $this->displayDetail($type, (string) ($r['detail'] ?? ''), $existing);
            $by = trim((string) ($r['changed_by_name'] ?? ''));
            if ($by !== '' && ! str_contains($detail, $by)) {
                $detail = trim($detail . ($detail !== '' ? ' · ' : '') . 'by ' . $by);
            }
            $events[] = [
                'id' => (int) $r['id'],
                'type' => $type,
                'tone' => $this->eventTone($type),
                'title' => $title,
                'detail' => $detail,
                'at' => (string) ($r['created_at'] ?? ''),
                'date' => isset($r['created_at']) ? substr((string) $r['created_at'], 0, 10) : null,
                'changed_by_name' => $r['changed_by_name'] ?? null,
            ];
        }

        // Always surface a lifecycle-style "started" entry (like asset registered).
        if (! $hasCreated) {
            $startAt = (string) ($existing['created_at'] ?? $existing['start_date'] ?? '');
            array_unshift($events, [
                'id' => 'started',
                'type' => 'created',
                'tone' => 'success',
                'title' => 'Agreement Started & Registered',
                'detail' => $this->createdDetail([
                    'agreement_type' => $existing['agreement_type'] ?? '',
                    'vendor_name' => $existing['vendor_name'] ?? '',
                    'start_date' => $existing['start_date'] ?? null,
                    'end_date' => $existing['end_date'] ?? null,
                    'contract_ref' => $existing['contract_ref'] ?? null,
                ]),
                'at' => $startAt,
                'date' => $startAt !== '' ? substr($startAt, 0, 10) : null,
                'changed_by_name' => null,
            ]);
        }

        Response::json(['data' => $events]);
    }

    /** DELETE /api/agreements/{id} — soft delete */
    public function destroy(Request $request, array $user, string $id): void
    {
        if (! $this->canManage($user)) {
            Response::error('Only IT staff can manage agreements', 403);
            return;
        }
        $this->ensureTable();

        $existing = $this->find((int) $id);
        if ($existing === null) {
            Response::error('Agreement not found', 404);
            return;
        }
        if (! $this->canView($user, $existing)) {
            Response::error('Not allowed', 403);
            return;
        }

        $this->pdo->prepare(
            'UPDATE vendor_agreements SET is_active = FALSE, updated_by = :uid, updated_at = NOW() WHERE id = :id'
        )->execute([
            'uid' => (int) ($user['id'] ?? 0) ?: null,
            'id' => (int) $id,
        ]);
        $this->logEvent(
            (int) $id,
            'removed',
            'Agreement Removed from Register',
            'Archived · no longer shown in the active agreements list.',
            $user
        );
        Response::json(['message' => 'Agreement removed']);
    }

    /** POST /api/agreements/{id}/document — multipart file field "document" */
    public function uploadDocument(Request $request, array $user, string $id): void
    {
        if (! $this->canManage($user)) {
            Response::error('Only IT staff can manage agreements', 403);
            return;
        }
        $this->ensureTable();

        $existing = $this->find((int) $id);
        if ($existing === null) {
            Response::error('Agreement not found', 404);
            return;
        }
        if (! $this->canView($user, $existing)) {
            Response::error('Not allowed', 403);
            return;
        }

        $uploaded = $_FILES['document'] ?? null;
        if (! is_array($uploaded) || ($uploaded['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            Response::error('Upload a PDF or DOCX document', 422);
            return;
        }

        $origName = basename((string) ($uploaded['name'] ?? 'agreement.pdf'));
        $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
        if (! in_array($ext, ['pdf', 'doc', 'docx'], true)) {
            Response::error('Only PDF, DOC, or DOCX files are allowed', 422);
            return;
        }

        $size = (int) ($uploaded['size'] ?? 0);
        if ($size <= 0 || $size > 25 * 1024 * 1024) {
            Response::error('File must be under 25MB', 422);
            return;
        }

        $tmp = (string) ($uploaded['tmp_name'] ?? '');
        if ($tmp === '' || ! is_uploaded_file($tmp)) {
            Response::error('Invalid upload', 422);
            return;
        }

        $dir = $this->documentDir();
        if (! is_dir($dir) && ! mkdir($dir, 0755, true) && ! is_dir($dir)) {
            Response::error('Could not create document storage', 500);
            return;
        }

        $safe = 'agreement_' . (int) $id . '_' . date('YmdHis') . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
        $dest = $dir . DIRECTORY_SEPARATOR . $safe;
        if (! move_uploaded_file($tmp, $dest)) {
            Response::error('Could not save document', 500);
            return;
        }

        $oldPath = (string) ($existing['document_path'] ?? '');
        if ($oldPath !== '' && is_file($oldPath)) {
            @unlink($oldPath);
        }

        $this->pdo->prepare(
            'UPDATE vendor_agreements SET document_path = :path, document_name = :name, updated_by = :uid, updated_at = NOW() WHERE id = :id'
        )->execute([
            'path' => $dest,
            'name' => $origName,
            'uid' => (int) ($user['id'] ?? 0) ?: null,
            'id' => (int) $id,
        ]);

        $this->logEvent(
            (int) $id,
            'document_uploaded',
            'Signed Contract Document Attached',
            'Document filed · ' . $origName . '.',
            $user
        );

        $row = $this->find((int) $id);
        Response::json(['data' => $this->enrichRow($row ?? []), 'message' => 'Document uploaded']);
    }

    /** GET /api/agreements/{id}/document */
    public function downloadDocument(Request $request, array $user, string $id): void
    {
        $this->ensureTable();
        $existing = $this->find((int) $id);
        if ($existing === null) {
            Response::error('Agreement not found', 404);
            return;
        }
        if (! $this->canView($user, $existing)) {
            Response::error('Not allowed', 403);
            return;
        }

        $path = (string) ($existing['document_path'] ?? '');
        $name = (string) ($existing['document_name'] ?? 'agreement.pdf');
        if ($path === '' || ! is_file($path)) {
            Response::error('No document on file', 404);
            return;
        }

        $ext = strtolower(pathinfo($path, PATHINFO_EXTENSION));
        $mime = match ($ext) {
            'pdf' => 'application/pdf',
            'doc' => 'application/msword',
            'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            default => 'application/octet-stream',
        };

        header('Content-Type: ' . $mime);
        header('Content-Length: ' . (string) filesize($path));
        header('Content-Disposition: attachment; filename="' . str_replace('"', '', $name) . '"');
        readfile($path);
        exit;
    }

    private function selectSql(): string
    {
        return 'SELECT a.*,
                       c.code AS company_code,
                       c.short_name AS company_short,
                       c.name AS company_name
                FROM vendor_agreements a
                LEFT JOIN companies c ON c.id = a.company_id';
    }

    /** @return array<string, mixed>|null */
    private function find(int $id): ?array
    {
        $stmt = $this->pdo->prepare($this->selectSql() . ' WHERE a.id = :id AND a.is_active = TRUE');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row === false ? null : $row;
    }

    /**
     * @param array<string, mixed> $row
     * @return array<string, mixed>
     */
    private function enrichRow(array $row): array
    {
        if ($row === []) {
            return $row;
        }
        $computed = $this->computeStatus(
            (string) ($row['status'] ?? 'active'),
            isset($row['end_date']) ? (string) $row['end_date'] : null
        );
        $row['status'] = $computed;
        $row['company_label'] = $row['company_id'] === null
            ? 'All companies'
            : ((string) ($row['company_short'] ?? $row['company_code'] ?? '—'));
        $row['type_label'] = match ((string) ($row['agreement_type'] ?? '')) {
            'software' => 'Software License / SaaS',
            'hardware' => 'Hardware / Equipment',
            'networking' => 'Networking / Connectivity',
            default => (string) ($row['agreement_type'] ?? ''),
        };
        $row['auto_renewing'] = filter_var($row['auto_renewing'] ?? false, FILTER_VALIDATE_BOOLEAN);
        $row['has_document'] = ! empty($row['document_path']) && is_file((string) $row['document_path']);
        // Never expose filesystem path to clients
        unset($row['document_path']);
        return $row;
    }

    private function computeStatus(string $stored, ?string $endDate): string
    {
        if (in_array($stored, ['cancelled', 'draft'], true)) {
            return $stored;
        }
        if ($endDate === null || trim($endDate) === '') {
            return $stored === 'expired' || $stored === 'expiring' ? 'active' : $stored;
        }
        $end = strtotime($endDate);
        if ($end === false) {
            return $stored;
        }
        $today = strtotime('today');
        if ($end < $today) {
            return 'expired';
        }
        if ($end <= strtotime('+60 days', $today)) {
            return 'expiring';
        }
        return $stored === 'expired' || $stored === 'expiring' ? 'active' : $stored;
    }

    /**
     * @param array<string, mixed>|null $existing
     * @return array<string, mixed>
     */
    private function parsePayload(Request $request, array $user, ?array $existing): array
    {
        $vendor = trim((string) $request->input('vendor_name', $existing['vendor_name'] ?? ''));
        $title = trim((string) $request->input('title', $existing['title'] ?? ''));
        $type = strtolower(trim((string) $request->input('agreement_type', $existing['agreement_type'] ?? '')));

        if ($vendor === '') {
            return ['error' => 'Vendor / company name is required'];
        }
        if ($title === '') {
            return ['error' => 'Agreement title is required'];
        }
        if (! in_array($type, self::TYPES, true)) {
            return ['error' => 'Type must be software, hardware, or networking'];
        }

        $companyRaw = $request->input('company_code', $request->input('company', null));
        $companyId = $existing['company_id'] ?? null;
        if ($companyRaw !== null) {
            $code = strtoupper(trim((string) $companyRaw));
            if ($code === 'ITL') {
                $code = 'IT';
            }
            if ($code === '' || $code === 'ALL' || $code === 'GROUP') {
                $companyId = null;
            } else {
                $cid = $this->resolveCompanyId($code);
                if ($cid === null) {
                    return ['error' => 'Unknown company'];
                }
                $companyId = $cid;
            }
        } elseif ($request->input('company_id') !== null && $request->input('company_id') !== '') {
            $companyId = (int) $request->input('company_id');
            if ($companyId <= 0) {
                $companyId = null;
            }
        } elseif ($existing === null && ($user['role'] ?? '') !== 'super_admin') {
            $companyId = (int) ($user['company_id'] ?? 0) ?: null;
        }

        $status = strtolower(trim((string) $request->input('status', $existing['status'] ?? 'active')));
        if (! in_array($status, self::STATUSES, true)) {
            $status = 'active';
        }

        $start = $this->nullDate($request->input('start_date', $existing['start_date'] ?? null));
        $end = $this->nullDate($request->input('end_date', $existing['end_date'] ?? null));
        $renewal = $this->nullDate($request->input('renewal_date', $existing['renewal_date'] ?? null));
        if ($status !== 'draft') {
            if ($start === null) {
                return ['error' => 'Start date is required'];
            }
            if ($end === null) {
                return ['error' => 'End / expiration date is required'];
            }
        }
        if ($start && $end && $end < $start) {
            return ['error' => 'End date cannot be before start date'];
        }

        $amountRaw = $request->input('value_amount', $existing['value_amount'] ?? null);
        $amount = null;
        if ($amountRaw !== null && $amountRaw !== '') {
            $amount = (float) $amountRaw;
        }

        $currency = strtoupper(trim((string) $request->input('currency', $existing['currency'] ?? 'LKR')));
        if ($currency === '') {
            $currency = 'LKR';
        }

        $autoRaw = $request->input('auto_renewing', $existing['auto_renewing'] ?? false);
        $autoRenewing = filter_var($autoRaw, FILTER_VALIDATE_BOOLEAN);

        if ($status !== 'draft') {
            $status = $this->computeStatus($status, $end);
        }

        return [
            'company_id' => $companyId,
            'agreement_type' => $type,
            'vendor_name' => $vendor,
            'title' => $title,
            'contract_ref' => $this->nullStr($request->input('contract_ref', $existing['contract_ref'] ?? null)),
            'start_date' => $start,
            'end_date' => $end,
            'renewal_date' => $renewal,
            'auto_renewing' => $autoRenewing,
            'status' => $status,
            'value_amount' => $amount,
            'currency' => $currency,
            'contact_person' => $this->nullStr($request->input('contact_person', $existing['contact_person'] ?? null)),
            'contact_phone' => $this->nullStr($request->input('contact_phone', $existing['contact_phone'] ?? null)),
            'contact_email' => $this->nullStr($request->input('contact_email', $existing['contact_email'] ?? null)),
            'terms' => $this->nullStr($request->input('terms', $existing['terms'] ?? null)),
            'notes' => $this->nullStr($request->input('notes', $existing['notes'] ?? null)),
        ];
    }

    private function documentDir(): string
    {
        return dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'storage' . DIRECTORY_SEPARATOR . 'agreements';
    }

    private function nullStr(mixed $v): ?string
    {
        if ($v === null) {
            return null;
        }
        $s = trim((string) $v);
        return $s === '' ? null : $s;
    }

    private function nullDate(mixed $v): ?string
    {
        if ($v === null || $v === '') {
            return null;
        }
        $s = substr(trim((string) $v), 0, 10);
        return $s === '' ? null : $s;
    }

    private function resolveCompanyId(string $code): ?int
    {
        $stmt = $this->pdo->prepare('SELECT id FROM companies WHERE UPPER(code) = :c AND is_active = TRUE LIMIT 1');
        $stmt->execute(['c' => $code]);
        $id = $stmt->fetchColumn();
        return $id === false ? null : (int) $id;
    }

    /** @param array<string, mixed> $row */
    private function canView(array $user, array $row): bool
    {
        if (($user['role'] ?? '') === 'super_admin') {
            return true;
        }
        $cid = $row['company_id'] ?? null;
        if ($cid === null || $cid === '') {
            return true;
        }
        return (int) $cid === (int) ($user['company_id'] ?? 0);
    }

    private function canManage(array $user): bool
    {
        return in_array($user['role'] ?? '', ['super_admin', 'it_admin', 'it_staff'], true);
    }

    private function ensureTable(): void
    {
        static $ready = false;
        if ($ready) {
            return;
        }
        try {
            $this->pdo->query('SELECT 1 FROM vendor_agreements LIMIT 1');
        } catch (\Throwable) {
            $sql = file_get_contents(dirname(__DIR__, 3) . '/database/migrations/create_vendor_agreements.sql');
            if ($sql) {
                $this->pdo->exec($sql);
            }
        }
        try {
            $alter = file_get_contents(dirname(__DIR__, 3) . '/database/migrations/alter_vendor_agreements_renewal_document.sql');
            if ($alter) {
                $this->pdo->exec($alter);
            }
        } catch (\Throwable) {
            // Columns may already exist
        }
        try {
            $hist = file_get_contents(dirname(__DIR__, 3) . '/database/migrations/create_vendor_agreement_history.sql');
            if ($hist) {
                $this->pdo->exec($hist);
            }
        } catch (\Throwable) {
            // history table may already exist
        }
        $ready = true;
    }

    /**
     * @param array<string, mixed> $payload
     */
    private function createdDetail(array $payload): string
    {
        $type = $this->typePhrase((string) ($payload['agreement_type'] ?? ''));
        $vendor = trim((string) ($payload['vendor_name'] ?? ''));
        $bits = ['Logged into vendor agreements register'];
        if ($vendor !== '') {
            $bits[] = $type . ' with ' . $vendor;
        } else {
            $bits[] = $type;
        }
        if (! empty($payload['start_date']) || ! empty($payload['end_date'])) {
            $bits[] = 'Term ' . ($payload['start_date'] ?? '—') . ' → ' . ($payload['end_date'] ?? 'open');
        }
        if (! empty($payload['contract_ref'])) {
            $bits[] = 'Contract ref ' . $payload['contract_ref'];
        }
        return implode(' · ', $bits) . '.';
    }

    private function typePhrase(string $type): string
    {
        return match (strtolower($type)) {
            'software' => 'Software / SaaS agreement',
            'hardware' => 'Hardware agreement',
            'networking' => 'Networking agreement',
            default => 'Vendor agreement',
        };
    }

    private function statusPhrase(string $status): string
    {
        return match (strtolower($status)) {
            'active' => 'Active',
            'expiring' => 'Expiring soon',
            'expired' => 'Expired',
            'cancelled' => 'Cancelled',
            'draft' => 'Draft',
            default => ucfirst($status !== '' ? $status : 'Updated'),
        };
    }

    private function displayTitle(string $type, string $stored): string
    {
        $s = trim($stored);
        // Prefer narrative titles when older short labels were stored.
        return match ($type) {
            'created' => ($s === '' || strcasecmp($s, 'Agreement registered') === 0)
                ? 'Agreement Started & Registered'
                : $s,
            'renewed' => ($s === '' || strcasecmp($s, 'Agreement renewed') === 0)
                ? 'Agreement Renewed'
                : $s,
            'document_uploaded' => (
                $s === ''
                || strcasecmp($s, 'Signed document uploaded') === 0
                || stripos($s, 'Attached') === false
            )
                ? 'Signed Contract Document Attached'
                : $s,
            'removed' => ($s === '' || strcasecmp($s, 'Agreement removed') === 0)
                ? 'Agreement Removed from Register'
                : $s,
            'status_changed' => $s !== '' ? $s : 'Status Updated',
            'updated' => ($s === '' || strcasecmp($s, 'Agreement updated') === 0)
                ? 'Agreement Details Updated'
                : $s,
            default => $s !== '' ? $s : 'Agreement Updated',
        };
    }

    /**
     * @param array<string, mixed> $agreement
     */
    private function displayDetail(string $type, string $stored, array $agreement): string
    {
        $s = trim($stored);
        if ($s !== '') {
            return $s;
        }
        $vendor = trim((string) ($agreement['vendor_name'] ?? 'vendor'));
        return match ($type) {
            'created' => $this->createdDetail($agreement),
            'renewed' => 'Contract with ' . $vendor . ' renewed.',
            'document_uploaded' => 'Signed document filed against this agreement.',
            'removed' => 'Archived · no longer shown in the active agreements list.',
            'status_changed' => 'Agreement status was updated.',
            default => 'Agreement record updated.',
        };
    }

    /**
     * @param array<string, mixed> $before
     * @param array<string, mixed> $after
     * @return array{type: string, title: string, detail: string}|null
     */
    private function describeChanges(array $before, array $after, bool $explicitRenew): ?array
    {
        $labels = [
            'vendor_name' => 'Vendor',
            'title' => 'Title',
            'agreement_type' => 'Type',
            'contract_ref' => 'Contract ref',
            'start_date' => 'Start date',
            'end_date' => 'End date',
            'renewal_date' => 'Renewal decision date',
            'status' => 'Status',
            'value_amount' => 'Contract value',
            'currency' => 'Currency',
            'contact_person' => 'Contact',
            'contact_phone' => 'Phone',
            'contact_email' => 'Email',
            'terms' => 'Terms / SLA',
            'notes' => 'Notes',
            'auto_renewing' => 'Auto-renewing',
        ];

        $changes = [];
        $statusChange = null;
        foreach ($labels as $key => $label) {
            $old = $before[$key] ?? null;
            $new = $after[$key] ?? null;
            if ($key === 'auto_renewing') {
                $old = filter_var($old, FILTER_VALIDATE_BOOLEAN) ? 'Yes' : 'No';
                $new = filter_var($new, FILTER_VALIDATE_BOOLEAN) ? 'Yes' : 'No';
            } elseif ($key === 'status') {
                $oldRaw = strtolower((string) ($old ?? ''));
                $newRaw = strtolower((string) ($new ?? ''));
                $old = $this->statusPhrase((string) ($old ?? ''));
                $new = $this->statusPhrase((string) ($new ?? ''));
                if ($oldRaw !== $newRaw) {
                    $statusChange = ['from' => $old, 'to' => $new];
                }
            } elseif ($key === 'value_amount') {
                $old = $old === null || $old === '' ? null : (string) $old;
                $new = $new === null || $new === '' ? null : (string) $new;
            } else {
                $old = $old === null || $old === '' ? null : (string) $old;
                $new = $new === null || $new === '' ? null : (string) $new;
            }
            if ((string) $old === (string) $new) {
                continue;
            }
            if (in_array($key, ['terms', 'notes'], true)) {
                $changes[] = $label . ' revised';
            } else {
                $changes[] = $label . ' ' . ($old ?? '—') . ' → ' . ($new ?? '—');
            }
        }

        if ($changes === []) {
            return null;
        }

        $endExtended = false;
        $oldEnd = $this->nullDate($before['end_date'] ?? null);
        $newEnd = $this->nullDate($after['end_date'] ?? null);
        if ($oldEnd && $newEnd && $newEnd > $oldEnd) {
            $endExtended = true;
        }
        $oldRenewal = $this->nullDate($before['renewal_date'] ?? null);
        $newRenewal = $this->nullDate($after['renewal_date'] ?? null);
        $renewalMoved = $oldRenewal && $newRenewal && $newRenewal > $oldRenewal;

        $vendor = (string) ($after['vendor_name'] ?? $before['vendor_name'] ?? 'vendor');
        $detail = implode(' · ', $changes) . '.';

        if ($explicitRenew || $endExtended || ($renewalMoved && $endExtended)) {
            return [
                'type' => 'renewed',
                'title' => 'Agreement Renewed',
                'detail' => 'Contract with ' . $vendor . ' renewed · ' . $detail,
            ];
        }
        if ($statusChange !== null && count($changes) === 1) {
            return [
                'type' => 'status_changed',
                'title' => 'Status → ' . $statusChange['to'],
                'detail' => $statusChange['from'] . ' → ' . $statusChange['to'] . '.',
            ];
        }
        if ($statusChange !== null) {
            return [
                'type' => 'status_changed',
                'title' => 'Status → ' . $statusChange['to'],
                'detail' => $detail,
            ];
        }

        return [
            'type' => 'updated',
            'title' => 'Agreement Details Updated',
            'detail' => $detail,
        ];
    }

    private function eventTone(string $type): string
    {
        return match ($type) {
            'created' => 'success',
            'renewed' => 'info',
            'document_uploaded' => 'primary',
            'status_changed' => 'warning',
            'removed' => 'danger',
            default => 'neutral',
        };
    }

    private function logEvent(int $agreementId, string $type, string $title, string $detail, array $user): void
    {
        try {
            $this->pdo->prepare(
                'INSERT INTO vendor_agreement_history (agreement_id, event_type, title, detail, changed_by)
                 VALUES (:aid, :type, :title, :detail, :uid)'
            )->execute([
                'aid' => $agreementId,
                'type' => $type,
                'title' => $title,
                'detail' => $detail !== '' ? $detail : null,
                'uid' => (int) ($user['id'] ?? 0) ?: null,
            ]);
        } catch (\Throwable) {
            // History is best-effort
        }
    }
}
