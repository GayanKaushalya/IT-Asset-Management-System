<?php

declare(strict_types=1);

namespace Indra\Itam\Controllers;

use Indra\Itam\Http\Request;
use Indra\Itam\Http\Response;
use Indra\Itam\Services\SystemAuditService;
use Indra\Itam\Support\Auth;
use PDO;

/**
 * IT Expenditure Management — ledger of purchases/expenses with line items,
 * attachments, date-range reporting, and company-wise summaries.
 */
final class ExpenditureController
{
    private const PAYMENT = ['pending', 'partially_paid', 'paid', 'overdue'];
    private const APPROVAL = ['pending', 'approved', 'rejected'];
    private const ITEM_TYPES = [
        'laptop', 'desktop_pc', 'mobile_phone', 'printer', 'monitor',
        'networking', 'accessories', 'software', 'internet', 'repairs',
        'maintenance', 'cloud', 'subscription', 'other',
    ];
    /** Item types that contribute to physical quantity totals */
    private const PHYSICAL_TYPES = [
        'laptop', 'desktop_pc', 'mobile_phone', 'printer', 'monitor',
        'networking', 'accessories',
    ];
    private const DOC_TYPES = ['invoice', 'quotation', 'receipt', 'other'];

    public function __construct(private readonly PDO $pdo)
    {
    }

    /** GET /api/expenditures */
    public function index(Request $request, array $user): void
    {
        $this->ensureTables();
        [$where, $params] = $this->buildFilters($request, $user, false);

        $page = max(1, (int) $request->input('page', 1));
        $limit = min(100, max(10, (int) $request->input('limit', 25)));
        $offset = ($page - 1) * $limit;

        $fromJoin = 'FROM it_expenditures e
                     LEFT JOIN companies c ON c.id = e.company_id
                     LEFT JOIN locations l ON l.id = e.location_id
                     LEFT JOIN departments d ON d.id = e.department_id
                     WHERE ' . $where;

        $countSql = 'SELECT COUNT(*) ' . $fromJoin;
        $cStmt = $this->pdo->prepare($countSql);
        $cStmt->execute($params);
        $total = (int) $cStmt->fetchColumn();

        // Filtered summary (all matching rows, not just current page) + sub-company counts
        $sumSql = "SELECT
                COALESCE(SUM(e.total_lkr), 0) AS total_spend,
                COALESCE(SUM(GREATEST(e.total_lkr - e.amount_paid_lkr, 0)), 0) AS outstanding,
                COUNT(*) AS transaction_count
             {$fromJoin}";
        $sStmt = $this->pdo->prepare($sumSql);
        $sStmt->execute($params);
        $totals = $sStmt->fetch(PDO::FETCH_ASSOC) ?: [];

        $qtySql = "SELECT COALESCE(SUM(ln.quantity), 0)
                   FROM it_expenditure_lines ln
                   WHERE ln.counts_as_physical = TRUE
                     AND ln.expenditure_id IN (SELECT e.id {$fromJoin})";
        $qStmt = $this->pdo->prepare($qtySql);
        $qStmt->execute($params);
        $physicalQty = (float) $qStmt->fetchColumn();

        $byCoSql = "SELECT c.code AS company_code,
                           c.short_name AS company_short,
                           COUNT(*) AS transaction_count,
                           COALESCE(SUM(e.total_lkr), 0) AS total_spend,
                           COALESCE(SUM(GREATEST(e.total_lkr - e.amount_paid_lkr, 0)), 0) AS outstanding
                    {$fromJoin}
                    GROUP BY c.code, c.short_name
                    ORDER BY total_spend DESC";
        $coStmt = $this->pdo->prepare($byCoSql);
        $coStmt->execute($params);
        $byCompany = [];
        foreach ($coStmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $co) {
            $code = (string) ($co['company_code'] ?? '');
            $qtyCoSql = "SELECT COALESCE(SUM(ln.quantity), 0)
                         FROM it_expenditure_lines ln
                         JOIN it_expenditures e ON e.id = ln.expenditure_id
                         LEFT JOIN companies c ON c.id = e.company_id
                         LEFT JOIN locations l ON l.id = e.location_id
                         LEFT JOIN departments d ON d.id = e.department_id
                         WHERE {$where} AND c.code = :co_code AND ln.counts_as_physical = TRUE";
            $qc = $this->pdo->prepare($qtyCoSql);
            $qc->execute([...$params, 'co_code' => $code]);
            $byCompany[] = [
                'company_code' => $code,
                'company_label' => $code === 'IT' ? 'ITL' : (string) ($co['company_short'] ?? $code),
                'transaction_count' => (int) ($co['transaction_count'] ?? 0),
                'total_spend' => (float) ($co['total_spend'] ?? 0),
                'outstanding' => (float) ($co['outstanding'] ?? 0),
                'physical_qty' => (float) $qc->fetchColumn(),
            ];
        }

        $sql = $this->headerSelect() . ' WHERE ' . $where
            . ' ORDER BY e.expense_date DESC, e.id DESC LIMIT ' . $limit . ' OFFSET ' . $offset;
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        foreach ($rows as &$row) {
            $row = $this->enrichHeader($row);
            $row = $this->attachItemsPreview($row);
        }
        unset($row);

        Response::json([
            'data' => $rows,
            'meta' => [
                'total' => $total,
                'page' => $page,
                'limit' => $limit,
                'pages' => $total === 0 ? 1 : (int) ceil($total / $limit),
            ],
            'summary' => [
                'total_spend' => (float) ($totals['total_spend'] ?? 0),
                'outstanding' => (float) ($totals['outstanding'] ?? 0),
                'transaction_count' => (int) ($totals['transaction_count'] ?? 0),
                'physical_qty' => $physicalQty,
                'by_company' => $byCompany,
            ],
        ]);
    }

    /** GET /api/expenditures/{id} */
    public function show(Request $request, array $user, string $id): void
    {
        $this->ensureTables();
        $row = $this->findHeader((int) $id);
        if ($row === null) {
            Response::error('Expenditure not found', 404);
            return;
        }
        Auth::assertCompanyAccess($user, (int) $row['company_id']);
        $row = $this->enrichHeader($row);
        $row['lines'] = $this->loadLines((int) $id);
        $row['attachments'] = $this->loadAttachments((int) $id);
        Response::json(['data' => $row]);
    }

    /** POST /api/expenditures */
    public function store(Request $request, array $user): void
    {
        if (! $this->canManage($user)) {
            Response::error('Only IT staff can manage expenditures', 403);
            return;
        }
        $this->ensureTables();
        $parsed = $this->parsePayload($request, $user, null);
        if (isset($parsed['error'])) {
            Response::error($parsed['error'], 422);
            return;
        }

        try {
            $this->pdo->beginTransaction();
            $ref = $this->nextReference((int) $parsed['header']['company_id']);
            $h = $parsed['header'];
            $stmt = $this->pdo->prepare(
                'INSERT INTO it_expenditures (
                    reference_no, expense_date, company_id, location_id, department_id,
                    supplier_id, supplier_name, invoice_no, po_capex_ref, expense_category,
                    payment_status, payment_date, amount_paid_lkr, approval_status,
                    remarks, warranty_notes, linked_asset_type, linked_asset_id,
                    subtotal_lkr, discount_total_lkr, tax_total_lkr, total_lkr,
                    created_by, updated_by
                 ) VALUES (
                    :reference_no, :expense_date, :company_id, :location_id, :department_id,
                    :supplier_id, :supplier_name, :invoice_no, :po_capex_ref, :expense_category,
                    :payment_status, :payment_date, :amount_paid_lkr, :approval_status,
                    :remarks, :warranty_notes, :linked_asset_type, :linked_asset_id,
                    :subtotal_lkr, :discount_total_lkr, :tax_total_lkr, :total_lkr,
                    :uid, :uid
                 ) RETURNING id'
            );
            $stmt->execute([
                'reference_no' => $ref,
                ...$h,
                'uid' => (int) ($user['id'] ?? 0) ?: null,
            ]);
            $expId = (int) $stmt->fetchColumn();
            $this->replaceLines($expId, $parsed['lines']);
            $this->recalcTotals($expId);
            $this->pdo->commit();
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            Response::error('Could not create expenditure: ' . $e->getMessage(), 422);
            return;
        }

        (new SystemAuditService($this->pdo))->log(
            (int) ($user['id'] ?? 0) ?: null,
            'expenditure.create',
            $request,
            null,
            ['id' => $expId, 'reference_no' => $ref]
        );

        $row = $this->findHeader($expId);
        $out = $this->enrichHeader($row ?? []);
        $out['lines'] = $this->loadLines($expId);
        $out['attachments'] = [];
        Response::json(['data' => $out, 'message' => 'Expenditure created'], 201);
    }

    /** PUT /api/expenditures/{id} */
    public function update(Request $request, array $user, string $id): void
    {
        if (! $this->canManage($user)) {
            Response::error('Only IT staff can manage expenditures', 403);
            return;
        }
        $this->ensureTables();
        $existing = $this->findHeader((int) $id);
        if ($existing === null) {
            Response::error('Expenditure not found', 404);
            return;
        }
        Auth::assertCompanyAccess($user, (int) $existing['company_id']);

        $parsed = $this->parsePayload($request, $user, $existing);
        if (isset($parsed['error'])) {
            Response::error($parsed['error'], 422);
            return;
        }

        try {
            $this->pdo->beginTransaction();
            $h = $parsed['header'];
            $this->pdo->prepare(
                'UPDATE it_expenditures SET
                    expense_date = :expense_date,
                    company_id = :company_id,
                    location_id = :location_id,
                    department_id = :department_id,
                    supplier_id = :supplier_id,
                    supplier_name = :supplier_name,
                    invoice_no = :invoice_no,
                    po_capex_ref = :po_capex_ref,
                    expense_category = :expense_category,
                    payment_status = :payment_status,
                    payment_date = :payment_date,
                    amount_paid_lkr = :amount_paid_lkr,
                    approval_status = :approval_status,
                    remarks = :remarks,
                    warranty_notes = :warranty_notes,
                    linked_asset_type = :linked_asset_type,
                    linked_asset_id = :linked_asset_id,
                    updated_by = :uid,
                    updated_at = NOW()
                 WHERE id = :id'
            )->execute([
                ...$h,
                'uid' => (int) ($user['id'] ?? 0) ?: null,
                'id' => (int) $id,
            ]);
            $this->replaceLines((int) $id, $parsed['lines']);
            $this->recalcTotals((int) $id);
            $this->pdo->commit();
        } catch (\Throwable $e) {
            if ($this->pdo->inTransaction()) {
                $this->pdo->rollBack();
            }
            Response::error('Could not update expenditure: ' . $e->getMessage(), 422);
            return;
        }

        (new SystemAuditService($this->pdo))->log(
            (int) ($user['id'] ?? 0) ?: null,
            'expenditure.update',
            $request,
            null,
            ['id' => (int) $id]
        );

        $row = $this->findHeader((int) $id);
        $out = $this->enrichHeader($row ?? []);
        $out['lines'] = $this->loadLines((int) $id);
        $out['attachments'] = $this->loadAttachments((int) $id);
        Response::json(['data' => $out, 'message' => 'Expenditure updated']);
    }

    /** DELETE /api/expenditures/{id} — soft delete */
    public function destroy(Request $request, array $user, string $id): void
    {
        if (! $this->canManage($user)) {
            Response::error('Only IT staff can manage expenditures', 403);
            return;
        }
        $this->ensureTables();
        $existing = $this->findHeader((int) $id);
        if ($existing === null) {
            Response::error('Expenditure not found', 404);
            return;
        }
        Auth::assertCompanyAccess($user, (int) $existing['company_id']);

        $this->pdo->prepare(
            'UPDATE it_expenditures SET is_active = FALSE, updated_by = :uid, updated_at = NOW() WHERE id = :id'
        )->execute([
            'uid' => (int) ($user['id'] ?? 0) ?: null,
            'id' => (int) $id,
        ]);

        (new SystemAuditService($this->pdo))->log(
            (int) ($user['id'] ?? 0) ?: null,
            'expenditure.delete',
            $request,
            null,
            ['id' => (int) $id, 'reference_no' => $existing['reference_no'] ?? null]
        );

        Response::json(['message' => 'Expenditure archived']);
    }

    /** POST /api/expenditures/{id}/void */
    public function voidRecord(Request $request, array $user, string $id): void
    {
        if (! $this->canManage($user)) {
            Response::error('Only IT staff can manage expenditures', 403);
            return;
        }
        $this->ensureTables();
        $existing = $this->findHeader((int) $id);
        if ($existing === null) {
            Response::error('Expenditure not found', 404);
            return;
        }
        Auth::assertCompanyAccess($user, (int) $existing['company_id']);
        $reason = trim((string) $request->input('void_reason', ''));
        $this->pdo->prepare(
            'UPDATE it_expenditures SET is_voided = TRUE, void_reason = :r, updated_by = :uid, updated_at = NOW() WHERE id = :id'
        )->execute([
            'r' => $reason !== '' ? $reason : null,
            'uid' => (int) ($user['id'] ?? 0) ?: null,
            'id' => (int) $id,
        ]);
        Response::json(['message' => 'Expenditure voided', 'data' => $this->enrichHeader($this->findHeader((int) $id) ?? [])]);
    }

    /** POST /api/expenditures/{id}/attachments */
    public function uploadAttachment(Request $request, array $user, string $id): void
    {
        if (! $this->canManage($user)) {
            Response::error('Only IT staff can manage expenditures', 403);
            return;
        }
        $this->ensureTables();
        $existing = $this->findHeader((int) $id);
        if ($existing === null) {
            Response::error('Expenditure not found', 404);
            return;
        }
        Auth::assertCompanyAccess($user, (int) $existing['company_id']);

        $uploaded = $_FILES['document'] ?? $_FILES['file'] ?? null;
        if (! is_array($uploaded) || ($uploaded['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            Response::error('Upload a PDF, image, DOC, or DOCX file', 422);
            return;
        }
        $origName = basename((string) ($uploaded['name'] ?? 'document.pdf'));
        $ext = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
        if (! in_array($ext, ['pdf', 'doc', 'docx', 'png', 'jpg', 'jpeg', 'webp'], true)) {
            Response::error('Allowed: PDF, DOC, DOCX, PNG, JPG, WEBP', 422);
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

        $docType = strtolower(trim((string) $request->input('doc_type', 'other')));
        if (! in_array($docType, self::DOC_TYPES, true)) {
            $docType = 'other';
        }

        $dir = dirname(__DIR__, 2) . DIRECTORY_SEPARATOR . 'storage' . DIRECTORY_SEPARATOR . 'expenditures';
        if (! is_dir($dir) && ! mkdir($dir, 0755, true) && ! is_dir($dir)) {
            Response::error('Could not create document storage', 500);
            return;
        }
        $safe = 'itx_' . (int) $id . '_' . date('YmdHis') . '_' . bin2hex(random_bytes(4)) . '.' . $ext;
        $dest = $dir . DIRECTORY_SEPARATOR . $safe;
        if (! move_uploaded_file($tmp, $dest)) {
            Response::error('Could not save document', 500);
            return;
        }

        $mime = match ($ext) {
            'pdf' => 'application/pdf',
            'png' => 'image/png',
            'jpg', 'jpeg' => 'image/jpeg',
            'webp' => 'image/webp',
            'doc' => 'application/msword',
            'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            default => 'application/octet-stream',
        };

        $this->pdo->prepare(
            'INSERT INTO it_expenditure_attachments
                (expenditure_id, doc_type, file_name, stored_path, mime_type, file_size, uploaded_by)
             VALUES (:eid, :dtype, :fname, :path, :mime, :size, :uid)'
        )->execute([
            'eid' => (int) $id,
            'dtype' => $docType,
            'fname' => $origName,
            'path' => $dest,
            'mime' => $mime,
            'size' => $size,
            'uid' => (int) ($user['id'] ?? 0) ?: null,
        ]);

        Response::json([
            'message' => 'Document uploaded',
            'data' => $this->loadAttachments((int) $id),
        ]);
    }

    /** GET /api/expenditures/{id}/attachments/{attachmentId} */
    public function downloadAttachment(Request $request, array $user, string $id, string $attachmentId): void
    {
        $this->ensureTables();
        $existing = $this->findHeader((int) $id);
        if ($existing === null) {
            Response::error('Expenditure not found', 404);
            return;
        }
        Auth::assertCompanyAccess($user, (int) $existing['company_id']);

        $stmt = $this->pdo->prepare(
            'SELECT * FROM it_expenditure_attachments WHERE id = :aid AND expenditure_id = :eid'
        );
        $stmt->execute(['aid' => (int) $attachmentId, 'eid' => (int) $id]);
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
        header('Content-Disposition: attachment; filename="' . str_replace('"', '', (string) $att['file_name']) . '"');
        readfile($path);
        exit;
    }

    /** GET /api/expenditures/report — date-range report + company summary */
    public function report(Request $request, array $user): void
    {
        $this->ensureTables();
        $from = trim((string) $request->input('from_date', ''));
        $to = trim((string) $request->input('to_date', ''));
        if ($from === '' || $to === '') {
            Response::error('From Date and To Date are required', 422);
            return;
        }
        if (! preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) || ! preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) {
            Response::error('Dates must be YYYY-MM-DD', 422);
            return;
        }
        if ($from > $to) {
            Response::error('From Date cannot be later than To Date', 422);
            return;
        }

        [$where, $params] = $this->buildFilters($request, $user, true);
        // Force date range on expense_date (inclusive)
        $where .= ' AND e.expense_date >= :from_date AND e.expense_date <= :to_date';
        $params['from_date'] = $from;
        $params['to_date'] = $to;

        $includeVoided = self::toBool($request->input('include_voided', false));
        if (! $includeVoided) {
            $where .= ' AND e.is_voided = FALSE';
        }

        $approvedOnly = self::toBool($request->input('approved_only', false));
        if ($approvedOnly) {
            $where .= " AND e.approval_status = 'approved'";
        }

        $lineFilter = '';
        $itemType = strtolower(trim((string) $request->input('item_type', $request->input('item_category', ''))));
        if ($itemType !== '' && in_array($itemType, self::ITEM_TYPES, true)) {
            $lineFilter .= ' AND ln.item_type = :ln_item_type';
            $params['ln_item_type'] = $itemType;
        }
        $itemName = trim((string) $request->input('item_name', ''));
        if ($itemName !== '') {
            $lineFilter .= ' AND ln.item_name ILIKE :ln_item_name';
            $params['ln_item_name'] = '%' . $itemName . '%';
        }
        $brand = trim((string) $request->input('brand', ''));
        if ($brand !== '') {
            $lineFilter .= ' AND (ln.brand ILIKE :ln_brand OR ln.model ILIKE :ln_brand)';
            $params['ln_brand'] = '%' . $brand . '%';
        }

        $sql = 'SELECT e.id, e.reference_no, e.expense_date, e.invoice_no, e.po_capex_ref,
                       e.payment_status, e.approval_status, e.is_voided,
                       e.amount_paid_lkr, e.total_lkr, e.supplier_name,
                       c.code AS company_code, c.short_name AS company_short,
                       l.name AS location_name, d.name AS department_name,
                       ln.id AS line_id, ln.line_no, ln.item_name, ln.item_type,
                       ln.brand, ln.model, ln.quantity, ln.unit_price_lkr,
                       ln.discount_lkr, ln.tax_lkr, ln.line_total_lkr, ln.counts_as_physical
                FROM it_expenditures e
                JOIN companies c ON c.id = e.company_id
                LEFT JOIN locations l ON l.id = e.location_id
                LEFT JOIN departments d ON d.id = e.department_id
                JOIN it_expenditure_lines ln ON ln.expenditure_id = e.id
                WHERE ' . $where . $lineFilter . '
                ORDER BY e.expense_date ASC, e.id ASC, ln.line_no ASC';
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $lines = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $summary = $this->buildReportSummary($lines);
        $byCompany = $this->buildCompanySummary($lines);

        $format = strtolower(trim((string) $request->input('format', 'json')));
        if ($format === 'csv') {
            $this->streamCsv($lines, $from, $to);
            return;
        }

        Response::json([
            'data' => [
                'from_date' => $from,
                'to_date' => $to,
                'approved_only' => $approvedOnly,
                'include_voided' => $includeVoided,
                'summary' => $summary,
                'by_company' => $byCompany,
                'rows' => array_map(fn (array $r) => $this->enrichLineRow($r), $lines),
            ],
        ]);
    }

    /** GET /api/expenditures/dashboard-summary */
    public function dashboardSummary(Request $request, array $user): void
    {
        $this->ensureTables();
        $companyId = null;
        if (($user['role'] ?? '') !== 'super_admin') {
            $companyId = (int) ($user['company_id'] ?? 0);
        } elseif ($request->input('company_id')) {
            $companyId = (int) $request->input('company_id');
        }

        $filter = 'e.is_active = TRUE AND e.is_voided = FALSE';
        $params = [];
        if ($companyId) {
            $filter .= ' AND e.company_id = :cid';
            $params['cid'] = $companyId;
        }

        $monthStart = date('Y-m-01');
        $monthEnd = date('Y-m-t');

        // Header aggregates must not JOIN lines (that multiplies totals per line).
        $sql = "SELECT
            COALESCE(SUM(e.total_lkr) FILTER (WHERE e.expense_date >= :ms AND e.expense_date <= :me), 0) AS month_total,
            COALESCE(SUM(e.total_lkr), 0) AS all_total,
            COALESCE(SUM(GREATEST(e.total_lkr - e.amount_paid_lkr, 0)) FILTER (
                WHERE e.payment_status IN ('pending','partially_paid','overdue')
            ), 0) AS outstanding,
            COALESCE(SUM(e.total_lkr) FILTER (WHERE e.approval_status = 'pending'), 0) AS pending_approval
         FROM it_expenditures e
         WHERE {$filter}";
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute([...$params, 'ms' => $monthStart, 'me' => $monthEnd]);
        $tot = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];

        $repairSql = "SELECT COALESCE(SUM(ln.line_total_lkr), 0)
                      FROM it_expenditures e
                      JOIN it_expenditure_lines ln ON ln.expenditure_id = e.id
                      WHERE {$filter}
                        AND ln.item_type IN ('repairs','maintenance')
                        AND e.expense_date >= :ms AND e.expense_date <= :me";
        $rStmt = $this->pdo->prepare($repairSql);
        $rStmt->execute([...$params, 'ms' => $monthStart, 'me' => $monthEnd]);
        $tot['repair_maintenance'] = (float) $rStmt->fetchColumn();

        $trendSql = "SELECT to_char(date_trunc('month', e.expense_date), 'YYYY-MM') AS month_key,
                            COALESCE(SUM(e.total_lkr), 0) AS total
                     FROM it_expenditures e
                     WHERE {$filter}
                       AND e.expense_date >= (CURRENT_DATE - INTERVAL '11 months')
                     GROUP BY 1 ORDER BY 1";
        $tStmt = $this->pdo->prepare($trendSql);
        $tStmt->execute($params);
        $trend = $tStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $byCoSql = "SELECT c.code, c.short_name, COALESCE(SUM(e.total_lkr), 0) AS total
                    FROM it_expenditures e
                    JOIN companies c ON c.id = e.company_id
                    WHERE {$filter}
                      AND e.expense_date >= :ms AND e.expense_date <= :me
                    GROUP BY c.code, c.short_name ORDER BY total DESC";
        $cStmt = $this->pdo->prepare($byCoSql);
        $cStmt->execute([...$params, 'ms' => $monthStart, 'me' => $monthEnd]);
        $byCompany = $cStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $byCatSql = "SELECT ln.item_type, COALESCE(SUM(ln.line_total_lkr), 0) AS total,
                            COALESCE(SUM(CASE WHEN ln.counts_as_physical THEN ln.quantity ELSE 0 END), 0) AS qty
                     FROM it_expenditures e
                     JOIN it_expenditure_lines ln ON ln.expenditure_id = e.id
                     WHERE {$filter}
                       AND e.expense_date >= :ms AND e.expense_date <= :me
                     GROUP BY ln.item_type ORDER BY total DESC";
        $catStmt = $this->pdo->prepare($byCatSql);
        $catStmt->execute([...$params, 'ms' => $monthStart, 'me' => $monthEnd]);
        $byCategory = $catStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $qtyByCoSql = "SELECT c.code, c.short_name, ln.item_type,
                              COALESCE(SUM(CASE WHEN ln.counts_as_physical THEN ln.quantity ELSE 0 END), 0) AS qty
                       FROM it_expenditures e
                       JOIN companies c ON c.id = e.company_id
                       JOIN it_expenditure_lines ln ON ln.expenditure_id = e.id
                       WHERE {$filter}
                         AND e.expense_date >= :ms AND e.expense_date <= :me
                       GROUP BY c.code, c.short_name, ln.item_type
                       HAVING SUM(CASE WHEN ln.counts_as_physical THEN ln.quantity ELSE 0 END) > 0
                       ORDER BY c.code, qty DESC";
        $qStmt = $this->pdo->prepare($qtyByCoSql);
        $qStmt->execute([...$params, 'ms' => $monthStart, 'me' => $monthEnd]);
        $qtyByCompany = $qStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $vendorSql = "SELECT COALESCE(NULLIF(e.supplier_name,''), s.name, 'Unknown') AS vendor,
                             COALESCE(SUM(e.total_lkr), 0) AS total
                      FROM it_expenditures e
                      LEFT JOIN suppliers s ON s.id = e.supplier_id
                      WHERE {$filter}
                        AND e.expense_date >= :ms AND e.expense_date <= :me
                      GROUP BY 1 ORDER BY total DESC LIMIT 10";
        $vStmt = $this->pdo->prepare($vendorSql);
        $vStmt->execute([...$params, 'ms' => $monthStart, 'me' => $monthEnd]);
        $vendors = $vStmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        Response::json([
            'data' => [
                'month_start' => $monthStart,
                'month_end' => $monthEnd,
                'stats' => [
                    'expenditureThisMonth' => (float) ($tot['month_total'] ?? 0),
                    'expenditureAllActive' => (float) ($tot['all_total'] ?? 0),
                    'outstandingPayments' => (float) ($tot['outstanding'] ?? 0),
                    'pendingApprovals' => (float) ($tot['pending_approval'] ?? 0),
                    'repairMaintenance' => (float) ($tot['repair_maintenance'] ?? 0),
                ],
                'monthlyTrend' => $trend,
                'byCompany' => $byCompany,
                'byCategory' => $byCategory,
                'qtyByCompany' => $qtyByCompany,
                'vendors' => $vendors,
            ],
        ]);
    }

    // ─── helpers ───────────────────────────────────────────────

    private function canManage(array $user): bool
    {
        return in_array($user['role'] ?? '', ['super_admin', 'it_admin', 'it_staff'], true);
    }

    private function headerSelect(): string
    {
        return 'SELECT e.*,
                       c.code AS company_code, c.short_name AS company_short, c.name AS company_name,
                       l.name AS location_name, d.name AS department_name,
                       s.name AS supplier_joined_name,
                       cu.name AS created_by_name, uu.name AS updated_by_name,
                       (SELECT COUNT(*) FROM it_expenditure_lines ln WHERE ln.expenditure_id = e.id) AS line_count,
                       (SELECT COUNT(*) FROM it_expenditure_attachments a WHERE a.expenditure_id = e.id) AS attachment_count
                FROM it_expenditures e
                LEFT JOIN companies c ON c.id = e.company_id
                LEFT JOIN locations l ON l.id = e.location_id
                LEFT JOIN departments d ON d.id = e.department_id
                LEFT JOIN suppliers s ON s.id = e.supplier_id
                LEFT JOIN users cu ON cu.id = e.created_by
                LEFT JOIN users uu ON uu.id = e.updated_by';
    }

    /** @return array<string, mixed>|null */
    private function findHeader(int $id): ?array
    {
        $stmt = $this->pdo->prepare($this->headerSelect() . ' WHERE e.id = :id AND e.is_active = TRUE');
        $stmt->execute(['id' => $id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return is_array($row) ? $row : null;
    }

    /** @param array<string, mixed> $row @return array<string, mixed> */
    private function enrichHeader(array $row): array
    {
        if ($row === []) {
            return $row;
        }
        $total = (float) ($row['total_lkr'] ?? 0);
        $paid = (float) ($row['amount_paid_lkr'] ?? 0);
        $row['outstanding_lkr'] = max(0, $total - $paid);
        $row['supplier_display'] = $row['supplier_name']
            ?: ($row['supplier_joined_name'] ?? null);
        $row['company_label'] = (($row['company_code'] ?? '') === 'IT')
            ? 'ITL'
            : ($row['company_short'] ?? $row['company_code'] ?? null);
        return $row;
    }

    /** Attach what was bought (items preview + physical qty) for list/detail cards. */
    /** @param array<string, mixed> $row @return array<string, mixed> */
    private function attachItemsPreview(array $row): array
    {
        $id = (int) ($row['id'] ?? 0);
        if ($id < 1) {
            return $row;
        }
        $stmt = $this->pdo->prepare(
            'SELECT id, item_name, item_type, brand, model, quantity, unit_price_lkr,
                    counts_as_physical, line_total_lkr
             FROM it_expenditure_lines WHERE expenditure_id = :id ORDER BY line_no ASC'
        );
        $stmt->execute(['id' => $id]);
        $lines = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
        $parts = [];
        $phys = 0.0;
        foreach ($lines as $ln) {
            $label = trim((string) ($ln['item_name'] ?? ''));
            $bm = trim(implode(' ', array_filter([(string) ($ln['brand'] ?? ''), (string) ($ln['model'] ?? '')])));
            if ($bm !== '') {
                $label .= ' (' . $bm . ')';
            }
            $qty = (float) ($ln['quantity'] ?? 0);
            $parts[] = $label . ' × ' . rtrim(rtrim(number_format($qty, 3, '.', ''), '0'), '.');
            $physFlag = $ln['counts_as_physical'] ?? false;
            $isPhys = $physFlag === true || $physFlag === 't' || $physFlag === '1' || $physFlag === 1;
            if ($isPhys) {
                $phys += $qty;
            }
        }
        $row['items_preview'] = $parts === [] ? null : implode('; ', $parts);
        $row['items_short'] = $parts === [] ? null : (count($parts) <= 2
            ? implode('; ', $parts)
            : $parts[0] . '; ' . $parts[1] . ' +' . (count($parts) - 2) . ' more');
        $row['physical_qty'] = $phys;
        $row['line_items'] = $lines;
        return $row;
    }

    /** @return list<array<string, mixed>> */
    private function loadLines(int $expId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT * FROM it_expenditure_lines WHERE expenditure_id = :id ORDER BY line_no ASC'
        );
        $stmt->execute(['id' => $expId]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /** @return list<array<string, mixed>> */
    private function loadAttachments(int $expId): array
    {
        $stmt = $this->pdo->prepare(
            'SELECT id, expenditure_id, doc_type, file_name, mime_type, file_size, created_at
             FROM it_expenditure_attachments WHERE expenditure_id = :id ORDER BY id ASC'
        );
        $stmt->execute(['id' => $expId]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /**
     * @return array{0: string, 1: array<string, mixed>}
     */
    private function buildFilters(Request $request, array $user, bool $forReport): array
    {
        $where = ['e.is_active = TRUE'];
        $params = [];

        if (($user['role'] ?? '') !== 'super_admin') {
            $where[] = 'e.company_id = :user_company';
            $params['user_company'] = (int) ($user['company_id'] ?? 0);
        } else {
            $company = strtoupper(trim((string) $request->input('company', $request->input('company_code', ''))));
            if ($company === 'ITL') {
                $company = 'IT';
            }
            if ($company !== '' && $company !== 'ALL') {
                $where[] = 'c.code = :company_code';
                $params['company_code'] = $company;
            }
            if ($request->input('company_id')) {
                $where[] = 'e.company_id = :company_id';
                $params['company_id'] = (int) $request->input('company_id');
            }
        }

        if ($request->input('location_id')) {
            $where[] = 'e.location_id = :location_id';
            $params['location_id'] = (int) $request->input('location_id');
        }
        if ($request->input('department_id')) {
            $where[] = 'e.department_id = :department_id';
            $params['department_id'] = (int) $request->input('department_id');
        }
        $pay = strtolower(trim((string) $request->input('payment_status', '')));
        if ($pay !== '' && in_array($pay, self::PAYMENT, true)) {
            $where[] = 'e.payment_status = :payment_status';
            $params['payment_status'] = $pay;
        }
        $appr = strtolower(trim((string) $request->input('approval_status', '')));
        if ($appr !== '' && in_array($appr, self::APPROVAL, true)) {
            $where[] = 'e.approval_status = :approval_status';
            $params['approval_status'] = $appr;
        }
        if (trim((string) $request->input('supplier', '')) !== '') {
            $where[] = '(e.supplier_name ILIKE :supplier OR EXISTS (
                SELECT 1 FROM suppliers sx WHERE sx.id = e.supplier_id AND sx.name ILIKE :supplier
            ))';
            $params['supplier'] = '%' . trim((string) $request->input('supplier')) . '%';
        }
        if (trim((string) $request->input('invoice_no', '')) !== '') {
            $where[] = 'e.invoice_no ILIKE :invoice_no';
            $params['invoice_no'] = '%' . trim((string) $request->input('invoice_no')) . '%';
        }
        $q = trim((string) $request->input('q', ''));
        if ($q !== '') {
            $where[] = '(e.reference_no ILIKE :q OR e.invoice_no ILIKE :q OR e.supplier_name ILIKE :q
                OR e.po_capex_ref ILIKE :q OR e.remarks ILIKE :q
                OR EXISTS (
                    SELECT 1 FROM it_expenditure_lines lx
                    WHERE lx.expenditure_id = e.id
                      AND (lx.item_name ILIKE :q OR lx.brand ILIKE :q OR lx.model ILIKE :q)
                ))';
            $params['q'] = '%' . $q . '%';
        }

        // Line-level filters (for report / list when provided)
        $itemType = strtolower(trim((string) $request->input('item_type', $request->input('item_category', ''))));
        if ($itemType !== '' && in_array($itemType, self::ITEM_TYPES, true)) {
            $where[] = 'EXISTS (SELECT 1 FROM it_expenditure_lines lx WHERE lx.expenditure_id = e.id AND lx.item_type = :item_type)';
            $params['item_type'] = $itemType;
        }
        $itemName = trim((string) $request->input('item_name', ''));
        if ($itemName !== '') {
            $where[] = 'EXISTS (SELECT 1 FROM it_expenditure_lines lx WHERE lx.expenditure_id = e.id AND lx.item_name ILIKE :item_name)';
            $params['item_name'] = '%' . $itemName . '%';
        }
        $brand = trim((string) $request->input('brand', ''));
        if ($brand !== '') {
            $where[] = 'EXISTS (SELECT 1 FROM it_expenditure_lines lx WHERE lx.expenditure_id = e.id AND (lx.brand ILIKE :brand OR lx.model ILIKE :brand))';
            $params['brand'] = '%' . $brand . '%';
        }

        if (! $forReport) {
            $from = trim((string) $request->input('from_date', ''));
            $to = trim((string) $request->input('to_date', ''));
            if ($from !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $from)) {
                $where[] = 'e.expense_date >= :list_from';
                $params['list_from'] = $from;
            }
            if ($to !== '' && preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) {
                $where[] = 'e.expense_date <= :list_to';
                $params['list_to'] = $to;
            }
            if (! self::toBool($request->input('include_voided', false))) {
                $where[] = 'e.is_voided = FALSE';
            }
        }

        return [implode(' AND ', $where), $params];
    }

    /**
     * @param array<string, mixed>|null $existing
     * @return array{error?: string, header?: array<string, mixed>, lines?: list<array<string, mixed>>}
     */
    private function parsePayload(Request $request, array $user, ?array $existing): array
    {
        $companyId = (int) ($request->input('company_id') ?: ($existing['company_id'] ?? 0));
        if ($companyId < 1) {
            return ['error' => 'Company is required'];
        }
        Auth::assertCompanyAccess($user, $companyId);

        $expenseDate = trim((string) $request->input('expense_date', ''));
        if ($expenseDate === '' || ! preg_match('/^\d{4}-\d{2}-\d{2}$/', $expenseDate)) {
            return ['error' => 'Purchase / expense date is required (YYYY-MM-DD)'];
        }

        $payment = strtolower(trim((string) $request->input('payment_status', 'pending')));
        if (! in_array($payment, self::PAYMENT, true)) {
            return ['error' => 'Invalid payment status'];
        }
        $approval = strtolower(trim((string) $request->input('approval_status', 'pending')));
        if (! in_array($approval, self::APPROVAL, true)) {
            return ['error' => 'Invalid approval status'];
        }

        $rawLines = $request->input('lines');
        if (! is_array($rawLines) || $rawLines === []) {
            return ['error' => 'At least one line item is required'];
        }

        $lines = [];
        $lineNo = 0;
        foreach ($rawLines as $raw) {
            if (! is_array($raw)) {
                continue;
            }
            $name = trim((string) ($raw['item_name'] ?? ''));
            if ($name === '') {
                return ['error' => 'Each line needs an item name'];
            }
            $qty = self::num($raw['quantity'] ?? 1);
            $unit = self::num($raw['unit_price_lkr'] ?? $raw['unit_price'] ?? 0);
            $disc = self::num($raw['discount_lkr'] ?? $raw['discount'] ?? 0);
            $tax = self::num($raw['tax_lkr'] ?? $raw['tax'] ?? 0);
            if ($qty <= 0) {
                return ['error' => 'Quantity must be greater than zero'];
            }
            if ($unit < 0 || $disc < 0 || $tax < 0) {
                return ['error' => 'Prices, discount, and tax cannot be negative'];
            }
            $type = strtolower(trim((string) ($raw['item_type'] ?? 'other')));
            if (! in_array($type, self::ITEM_TYPES, true)) {
                $type = 'other';
            }
            $lineTotal = round(($qty * $unit) - $disc + $tax, 2);
            if ($lineTotal < 0) {
                return ['error' => 'Line total cannot be negative (check discount)'];
            }
            $countsPhysical = array_key_exists('counts_as_physical', $raw)
                ? self::toBool($raw['counts_as_physical'])
                : in_array($type, self::PHYSICAL_TYPES, true);

            $lineNo++;
            $lines[] = [
                'line_no' => $lineNo,
                'item_name' => $name,
                'description' => trim((string) ($raw['description'] ?? '')) ?: null,
                'item_type' => $type,
                'brand' => trim((string) ($raw['brand'] ?? '')) ?: null,
                'model' => trim((string) ($raw['model'] ?? '')) ?: null,
                'quantity' => $qty,
                'unit_price_lkr' => $unit,
                'discount_lkr' => $disc,
                'tax_lkr' => $tax,
                'line_total_lkr' => $lineTotal,
                'counts_as_physical' => $countsPhysical,
                'warranty_info' => trim((string) ($raw['warranty_info'] ?? '')) ?: null,
                'linked_asset_type' => trim((string) ($raw['linked_asset_type'] ?? '')) ?: null,
                'linked_asset_id' => ! empty($raw['linked_asset_id']) ? (int) $raw['linked_asset_id'] : null,
            ];
        }
        if ($lines === []) {
            return ['error' => 'At least one valid line item is required'];
        }

        $amountPaid = self::num($request->input('amount_paid_lkr', $request->input('amount_paid', 0)));
        if ($amountPaid < 0) {
            return ['error' => 'Amount paid cannot be negative'];
        }

        $supplierName = trim((string) $request->input('supplier_name', $request->input('supplier', '')));
        $supplierId = $request->input('supplier_id') ? (int) $request->input('supplier_id') : null;

        $header = [
            'expense_date' => $expenseDate,
            'company_id' => $companyId,
            'location_id' => $request->input('location_id') ? (int) $request->input('location_id') : null,
            'department_id' => $request->input('department_id') ? (int) $request->input('department_id') : null,
            'supplier_id' => $supplierId,
            'supplier_name' => $supplierName !== '' ? $supplierName : null,
            'invoice_no' => trim((string) $request->input('invoice_no', '')) ?: null,
            'po_capex_ref' => trim((string) $request->input('po_capex_ref', '')) ?: null,
            'expense_category' => trim((string) $request->input('expense_category', '')) ?: null,
            'payment_status' => $payment,
            'payment_date' => preg_match('/^\d{4}-\d{2}-\d{2}$/', (string) $request->input('payment_date', ''))
                ? (string) $request->input('payment_date')
                : null,
            'amount_paid_lkr' => $amountPaid,
            'approval_status' => $approval,
            'remarks' => trim((string) $request->input('remarks', '')) ?: null,
            'warranty_notes' => trim((string) $request->input('warranty_notes', '')) ?: null,
            'linked_asset_type' => trim((string) $request->input('linked_asset_type', '')) ?: null,
            'linked_asset_id' => $request->input('linked_asset_id') ? (int) $request->input('linked_asset_id') : null,
            'subtotal_lkr' => 0,
            'discount_total_lkr' => 0,
            'tax_total_lkr' => 0,
            'total_lkr' => 0,
        ];

        return ['header' => $header, 'lines' => $lines];
    }

    /** @param list<array<string, mixed>> $lines */
    private function replaceLines(int $expId, array $lines): void
    {
        $this->pdo->prepare('DELETE FROM it_expenditure_lines WHERE expenditure_id = :id')
            ->execute(['id' => $expId]);
        $ins = $this->pdo->prepare(
            'INSERT INTO it_expenditure_lines (
                expenditure_id, line_no, item_name, description, item_type, brand, model,
                quantity, unit_price_lkr, discount_lkr, tax_lkr, line_total_lkr,
                counts_as_physical, warranty_info, linked_asset_type, linked_asset_id
             ) VALUES (
                :eid, :line_no, :item_name, :description, :item_type, :brand, :model,
                :quantity, :unit_price_lkr, :discount_lkr, :tax_lkr, :line_total_lkr,
                :counts_as_physical, :warranty_info, :linked_asset_type, :linked_asset_id
             )'
        );
        foreach ($lines as $ln) {
            $ins->execute([
                'eid' => $expId,
                'line_no' => $ln['line_no'],
                'item_name' => $ln['item_name'],
                'description' => $ln['description'],
                'item_type' => $ln['item_type'],
                'brand' => $ln['brand'],
                'model' => $ln['model'],
                'quantity' => $ln['quantity'],
                'unit_price_lkr' => $ln['unit_price_lkr'],
                'discount_lkr' => $ln['discount_lkr'],
                'tax_lkr' => $ln['tax_lkr'],
                'line_total_lkr' => $ln['line_total_lkr'],
                'counts_as_physical' => $ln['counts_as_physical'] ? 'true' : 'false',
                'warranty_info' => $ln['warranty_info'],
                'linked_asset_type' => $ln['linked_asset_type'],
                'linked_asset_id' => $ln['linked_asset_id'],
            ]);
        }
    }

    private function recalcTotals(int $expId): void
    {
        $stmt = $this->pdo->prepare(
            'SELECT
                COALESCE(SUM(quantity * unit_price_lkr), 0) AS subtotal,
                COALESCE(SUM(discount_lkr), 0) AS discount_total,
                COALESCE(SUM(tax_lkr), 0) AS tax_total,
                COALESCE(SUM(line_total_lkr), 0) AS total
             FROM it_expenditure_lines WHERE expenditure_id = :id'
        );
        $stmt->execute(['id' => $expId]);
        $t = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
        $this->pdo->prepare(
            'UPDATE it_expenditures SET
                subtotal_lkr = :s, discount_total_lkr = :d, tax_total_lkr = :x, total_lkr = :t,
                updated_at = NOW()
             WHERE id = :id'
        )->execute([
            's' => (float) ($t['subtotal'] ?? 0),
            'd' => (float) ($t['discount_total'] ?? 0),
            'x' => (float) ($t['tax_total'] ?? 0),
            't' => (float) ($t['total'] ?? 0),
            'id' => $expId,
        ]);
    }

    private function nextReference(int $companyId): string
    {
        $year = date('Y');
        $stmt = $this->pdo->prepare(
            "SELECT COUNT(*) FROM it_expenditures WHERE reference_no LIKE :pfx"
        );
        $pfx = 'ITX-' . $year . '-%';
        $stmt->execute(['pfx' => $pfx]);
        $n = ((int) $stmt->fetchColumn()) + 1;
        return sprintf('ITX-%s-%04d', $year, $n);
    }

    /**
     * @param list<array<string, mixed>> $lines
     * @return array<string, mixed>
     */
    private function buildReportSummary(array $lines): array
    {
        $total = 0.0;
        $qty = 0.0;
        $types = [];
        $txIds = [];
        $byCompanySpend = [];
        $outstanding = 0.0;
        $paidSeen = [];

        foreach ($lines as $r) {
            $total += (float) ($r['line_total_lkr'] ?? 0);
            if (! empty($r['counts_as_physical']) && ($r['counts_as_physical'] === true || $r['counts_as_physical'] === 't' || $r['counts_as_physical'] === '1')) {
                $qty += (float) ($r['quantity'] ?? 0);
            }
            $types[(string) ($r['item_type'] ?? 'other')] = true;
            $eid = (int) ($r['id'] ?? 0);
            $txIds[$eid] = true;
            $code = (string) ($r['company_code'] ?? '');
            $byCompanySpend[$code] = ($byCompanySpend[$code] ?? 0) + (float) ($r['line_total_lkr'] ?? 0);

            if (! isset($paidSeen[$eid])) {
                $paidSeen[$eid] = true;
                $hdrTotal = (float) ($r['total_lkr'] ?? 0);
                $paid = (float) ($r['amount_paid_lkr'] ?? 0);
                $outstanding += max(0, $hdrTotal - $paid);
            }
        }

        $companyCards = [];
        foreach ($byCompanySpend as $code => $amt) {
            $companyCards[] = [
                'company_code' => $code,
                'company_label' => $code === 'IT' ? 'ITL' : $code,
                'total_lkr' => round($amt, 2),
            ];
        }

        return [
            'total_expenditure_lkr' => round($total, 2),
            'total_quantity' => round($qty, 3),
            'distinct_item_types' => count($types),
            'transaction_count' => count($txIds),
            'outstanding_lkr' => round($outstanding, 2),
            'by_company' => $companyCards,
        ];
    }

    /**
     * @param list<array<string, mixed>> $lines
     * @return list<array<string, mixed>>
     */
    private function buildCompanySummary(array $lines): array
    {
        /** @var array<string, array<string, mixed>> $companies */
        $companies = [];
        $txSeen = [];

        foreach ($lines as $r) {
            $code = (string) ($r['company_code'] ?? 'OTHER');
            if (! isset($companies[$code])) {
                $companies[$code] = [
                    'company_code' => $code,
                    'company_short' => (string) ($r['company_short'] ?? $code),
                    'company_label' => $code === 'IT' ? 'ITL' : (string) ($r['company_short'] ?? $code),
                    'total_lkr' => 0.0,
                    'total_quantity' => 0.0,
                    'transaction_count' => 0,
                    'outstanding_lkr' => 0.0,
                    'by_item_type' => [],
                    'by_item' => [],
                    'transactions' => [],
                ];
            }
            $companies[$code]['total_lkr'] += (float) ($r['line_total_lkr'] ?? 0);
            $physical = ! empty($r['counts_as_physical']) && ($r['counts_as_physical'] === true || $r['counts_as_physical'] === 't' || $r['counts_as_physical'] === '1');
            $q = (float) ($r['quantity'] ?? 0);
            if ($physical) {
                $companies[$code]['total_quantity'] += $q;
            }

            $type = (string) ($r['item_type'] ?? 'other');
            if (! isset($companies[$code]['by_item_type'][$type])) {
                $companies[$code]['by_item_type'][$type] = [
                    'item_type' => $type,
                    'quantity' => 0.0,
                    'total_lkr' => 0.0,
                    'line_count' => 0,
                ];
            }
            if ($physical) {
                $companies[$code]['by_item_type'][$type]['quantity'] += $q;
            }
            $companies[$code]['by_item_type'][$type]['total_lkr'] += (float) ($r['line_total_lkr'] ?? 0);
            $companies[$code]['by_item_type'][$type]['line_count']++;

            $itemKey = strtolower(trim(
                ($r['item_name'] ?? '') . '|' . ($r['brand'] ?? '') . '|' . ($r['model'] ?? '')
            ));
            if (! isset($companies[$code]['by_item'][$itemKey])) {
                $companies[$code]['by_item'][$itemKey] = [
                    'item_name' => (string) ($r['item_name'] ?? ''),
                    'item_type' => $type,
                    'brand' => $r['brand'] ?? null,
                    'model' => $r['model'] ?? null,
                    'quantity' => 0.0,
                    'total_lkr' => 0.0,
                    'avg_unit_price' => 0.0,
                    '_unit_sum' => 0.0,
                    '_unit_n' => 0,
                ];
            }
            if ($physical) {
                $companies[$code]['by_item'][$itemKey]['quantity'] += $q;
            }
            $companies[$code]['by_item'][$itemKey]['total_lkr'] += (float) ($r['line_total_lkr'] ?? 0);
            $companies[$code]['by_item'][$itemKey]['_unit_sum'] += (float) ($r['unit_price_lkr'] ?? 0);
            $companies[$code]['by_item'][$itemKey]['_unit_n']++;

            $eid = (int) ($r['id'] ?? 0);
            $txKey = $code . ':' . $eid;
            if (! isset($txSeen[$txKey])) {
                $txSeen[$txKey] = true;
                $companies[$code]['transaction_count']++;
                $hdrTotal = (float) ($r['total_lkr'] ?? 0);
                $paid = (float) ($r['amount_paid_lkr'] ?? 0);
                $companies[$code]['outstanding_lkr'] += max(0, $hdrTotal - $paid);
                $companies[$code]['transactions'][] = [
                    'id' => $eid,
                    'reference_no' => $r['reference_no'] ?? null,
                    'expense_date' => $r['expense_date'] ?? null,
                    'invoice_no' => $r['invoice_no'] ?? null,
                    'total_lkr' => $hdrTotal,
                    'payment_status' => $r['payment_status'] ?? null,
                ];
            }
        }

        $out = [];
        foreach ($companies as $co) {
            $items = [];
            foreach ($co['by_item'] as $it) {
                $n = (int) $it['_unit_n'];
                $it['avg_unit_price'] = $n > 0 ? round($it['_unit_sum'] / $n, 2) : 0;
                unset($it['_unit_sum'], $it['_unit_n']);
                $it['quantity'] = round((float) $it['quantity'], 3);
                $it['total_lkr'] = round((float) $it['total_lkr'], 2);
                $items[] = $it;
            }
            usort($items, static fn ($a, $b) => $b['total_lkr'] <=> $a['total_lkr']);

            $types = array_values($co['by_item_type']);
            foreach ($types as &$t) {
                $t['quantity'] = round((float) $t['quantity'], 3);
                $t['total_lkr'] = round((float) $t['total_lkr'], 2);
            }
            unset($t);
            usort($types, static fn ($a, $b) => $b['total_lkr'] <=> $a['total_lkr']);

            $out[] = [
                'company_code' => $co['company_code'],
                'company_short' => $co['company_short'],
                'company_label' => $co['company_label'],
                'total_lkr' => round((float) $co['total_lkr'], 2),
                'total_quantity' => round((float) $co['total_quantity'], 3),
                'transaction_count' => (int) $co['transaction_count'],
                'outstanding_lkr' => round((float) $co['outstanding_lkr'], 2),
                'by_item_type' => $types,
                'by_item' => $items,
                'transactions' => $co['transactions'],
            ];
        }
        usort($out, static fn ($a, $b) => $b['total_lkr'] <=> $a['total_lkr']);
        return $out;
    }

    /** @param array<string, mixed> $r @return array<string, mixed> */
    private function enrichLineRow(array $r): array
    {
        $r['company_label'] = (($r['company_code'] ?? '') === 'IT')
            ? 'ITL'
            : ($r['company_short'] ?? $r['company_code'] ?? '');
        return $r;
    }

    /** @param list<array<string, mixed>> $lines */
    private function streamCsv(array $lines, string $from, string $to): void
    {
        header('Content-Type: text/csv; charset=utf-8');
        header('Content-Disposition: attachment; filename="it-expenditure-' . $from . '_to_' . $to . '.csv"');
        $out = fopen('php://output', 'w');
        if ($out === false) {
            return;
        }
        fprintf($out, chr(0xEF) . chr(0xBB) . chr(0xBF));
        fputcsv($out, [
            'Purchase Date', 'Reference', 'Company', 'Branch', 'Department',
            'Item Name', 'Item Category', 'Brand', 'Model', 'Quantity',
            'Unit Price (LKR)', 'Discount (LKR)', 'Tax (LKR)', 'Line Total (LKR)',
            'Supplier', 'Invoice No', 'Payment Status', 'Approval Status',
        ]);
        foreach ($lines as $r) {
            fputcsv($out, [
                $r['expense_date'] ?? '',
                $r['reference_no'] ?? '',
                (($r['company_code'] ?? '') === 'IT' ? 'ITL' : ($r['company_short'] ?? '')),
                $r['location_name'] ?? '',
                $r['department_name'] ?? '',
                $r['item_name'] ?? '',
                $r['item_type'] ?? '',
                $r['brand'] ?? '',
                $r['model'] ?? '',
                $r['quantity'] ?? '',
                $r['unit_price_lkr'] ?? '',
                $r['discount_lkr'] ?? '',
                $r['tax_lkr'] ?? '',
                $r['line_total_lkr'] ?? '',
                $r['supplier_name'] ?? '',
                $r['invoice_no'] ?? '',
                $r['payment_status'] ?? '',
                $r['approval_status'] ?? '',
            ]);
        }
        fclose($out);
        exit;
    }

    private static function num(mixed $v): float
    {
        if ($v === null || $v === '') {
            return 0.0;
        }
        if (is_numeric($v)) {
            return (float) $v;
        }
        if (is_string($v) && preg_match('/-?\d+(?:\.\d+)?/', str_replace(',', '', $v), $m)) {
            return (float) $m[0];
        }
        return 0.0;
    }

    private static function toBool(mixed $v): bool
    {
        if (is_bool($v)) {
            return $v;
        }
        if ($v === null || $v === '') {
            return false;
        }
        $f = filter_var($v, FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
        return $f ?? false;
    }

    /**
     * GET /api/expenditures/inventory-spend
     * Calculate IT expenses for a date range from Assets (purchase_amount_lkr).
     * Acquired On / purchase_date is the purchased date — no manual expenditure entry.
     * Other assets: uses purchase_date, else handover_date. Rows with both blank are excluded
     * (intentional for old stock that must not inflate spend).
     */
    public function inventorySpend(Request $request, array $user): void
    {
        $from = trim((string) $request->input('from_date', ''));
        $to = trim((string) $request->input('to_date', ''));
        if ($from === '' || $to === '' || ! preg_match('/^\d{4}-\d{2}-\d{2}$/', $from) || ! preg_match('/^\d{4}-\d{2}-\d{2}$/', $to)) {
            Response::error('from_date and to_date are required (YYYY-MM-DD)', 422);
            return;
        }
        if ($from > $to) {
            Response::error('from_date cannot be later than to_date', 422);
            return;
        }

        $q = trim((string) $request->input('q', ''));
        $categoryFilter = strtolower(trim((string) $request->input('category', '')));
        $locationId = $request->input('location_id') ? (int) $request->input('location_id') : null;
        $departmentId = $request->input('department_id') ? (int) $request->input('department_id') : null;

        // New purchases across inventory tabs (not old/legacy fleet). Require purchase price.
        $tables = [
            'laptop' => [
                'table' => 'laptops',
                'item_type' => 'laptop',
                'name_expr' => "COALESCE(NULLIF(TRIM(a.pc_name), ''), NULLIF(TRIM(a.asset_tag), ''), 'Laptop')",
                'staff_expr' => "COALESCE(NULLIF(TRIM(a.allocated_person), ''), NULLIF(TRIM(a.original_assigned_person), ''), NULLIF(TRIM(a.handover_person_1), ''))",
                'date_expr' => 'a.purchase_date',
                'entry_filter' => 'COALESCE(a.is_legacy, FALSE) = FALSE AND COALESCE(a.purchase_amount_lkr, 0) > 0',
            ],
            'mobile_phone' => [
                'table' => 'mobile_phones',
                'item_type' => 'mobile_phone',
                'name_expr' => "COALESCE(NULLIF(TRIM(a.pc_name), ''), NULLIF(TRIM(a.asset_tag), ''), 'Mobile phone')",
                'staff_expr' => "COALESCE(NULLIF(TRIM(a.allocated_person), ''), NULLIF(TRIM(a.original_assigned_person), ''), NULLIF(TRIM(a.first_handover_person), ''), NULLIF(TRIM(a.handover_person_1), ''))",
                'date_expr' => 'a.purchase_date',
                'entry_filter' => 'COALESCE(a.is_legacy, FALSE) = FALSE AND COALESCE(a.purchase_amount_lkr, 0) > 0',
            ],
            'pc' => [
                'table' => 'pcs',
                'item_type' => 'desktop_pc',
                'name_expr' => "COALESCE(NULLIF(TRIM(a.pc_name), ''), NULLIF(TRIM(a.asset_tag), ''), 'Desktop PC')",
                'staff_expr' => "COALESCE(NULLIF(TRIM(a.allocated_person), ''), NULLIF(TRIM(a.original_assigned_person), ''), NULLIF(TRIM(a.handover_person_1), ''))",
                'date_expr' => 'a.purchase_date',
                'entry_filter' => 'COALESCE(a.newly_purchased, FALSE) = TRUE AND COALESCE(a.purchase_amount_lkr, 0) > 0',
            ],
            'other' => [
                'table' => 'other_assets',
                'item_type' => 'other',
                'name_expr' => "COALESCE(NULLIF(TRIM(a.item_name), ''), NULLIF(TRIM(a.pc_name), ''), NULLIF(TRIM(a.user_name), ''), NULLIF(TRIM(a.asset_tag), ''), 'Other asset')",
                'staff_expr' => "COALESCE(NULLIF(TRIM(a.user_name), ''), NULLIF(TRIM(a.pc_name), ''))",
                // No created_at fallback — blank dates keep legacy other assets out of spend
                'date_expr' => 'COALESCE(a.purchase_date, a.handover_date)',
                'entry_filter' => 'COALESCE(a.purchase_amount_lkr, 0) > 0',
            ],
        ];

        if ($categoryFilter === 'desktop_pc') {
            $categoryFilter = 'pc';
        }
        if ($categoryFilter !== '' && isset($tables[$categoryFilter])) {
            $tables = [$categoryFilter => $tables[$categoryFilter]];
        } elseif ($categoryFilter !== '' && $categoryFilter !== 'all') {
            $tables = [];
        }

        $companyId = null;
        $companyCode = null;
        if (($user['role'] ?? '') !== 'super_admin') {
            $companyId = (int) ($user['company_id'] ?? 0);
        } else {
            $company = strtoupper(trim((string) $request->input('company', $request->input('company_code', ''))));
            if ($company === 'ITL') {
                $company = 'IT';
            }
            if ($company !== '' && $company !== 'ALL') {
                $companyCode = $company;
            }
            if ($request->input('company_id')) {
                $companyId = (int) $request->input('company_id');
            }
        }

        // Query each asset table separately (avoids brittle UNION named-param issues)
        $raw = [];
        foreach ($tables as $cat => $meta) {
            $where = [
                $meta['entry_filter'],
                "{$meta['date_expr']} IS NOT NULL",
                "{$meta['date_expr']} >= :from_date",
                "{$meta['date_expr']} <= :to_date",
            ];
            $params = [
                'from_date' => $from,
                'to_date' => $to,
            ];
            if ($companyId !== null && $companyId > 0) {
                $where[] = 'a.company_id = :company_id';
                $params['company_id'] = $companyId;
            }
            if ($companyCode !== null) {
                $where[] = 'c.code = :company_code';
                $params['company_code'] = $companyCode;
            }
            if ($locationId !== null && $locationId > 0) {
                $where[] = 'a.location_id = :location_id';
                $params['location_id'] = $locationId;
            }
            if ($departmentId !== null && $departmentId > 0) {
                $where[] = 'a.department_id = :department_id';
                $params['department_id'] = $departmentId;
            }
            if ($q !== '') {
                $params['q'] = '%' . $q . '%';
                if ($cat === 'other') {
                    $where[] = '(a.asset_tag ILIKE :q OR a.item_name ILIKE :q OR a.pc_name ILIKE :q
                        OR a.serial_number ILIKE :q OR a.brand ILIKE :q OR a.model ILIKE :q
                        OR a.user_name ILIKE :q OR a.invoice_no ILIKE :q)';
                } elseif ($cat === 'printer') {
                    $where[] = '(a.asset_tag ILIKE :q OR a.pc_name ILIKE :q OR a.serial_number ILIKE :q
                        OR a.brand ILIKE :q OR a.model ILIKE :q OR a.invoice_no ILIKE :q)';
                } else {
                    $where[] = '(a.asset_tag ILIKE :q OR a.pc_name ILIKE :q OR a.serial_number ILIKE :q
                        OR a.brand ILIKE :q OR a.model ILIKE :q OR a.invoice_no ILIKE :q
                        OR a.allocated_person ILIKE :q OR a.original_assigned_person ILIKE :q)';
                }
            }

            $sql = "SELECT
                '{$cat}' AS asset_category,
                a.id AS asset_id,
                a.asset_tag,
                {$meta['name_expr']} AS item_name,
                '{$meta['item_type']}' AS item_type,
                a.brand,
                a.model,
                COALESCE(a.purchase_amount_lkr, 0) AS purchase_amount_lkr,
                a.purchase_date,
                {$meta['date_expr']} AS effective_purchase_date,
                (a.purchase_date IS NULL) AS date_fallback,
                a.invoice_no,
                a.status,
                a.company_id,
                a.location_id,
                a.department_id,
                c.code AS company_code,
                c.short_name AS company_short,
                l.name AS location_name,
                d.name AS department_name,
                {$meta['staff_expr']} AS staff_name
             FROM {$meta['table']} a
             LEFT JOIN companies c ON c.id = a.company_id
             LEFT JOIN locations l ON l.id = a.location_id
             LEFT JOIN departments d ON d.id = a.department_id
             WHERE " . implode(' AND ', $where) . '
             ORDER BY effective_purchase_date DESC, a.id DESC';

            try {
                $stmt = $this->pdo->prepare($sql);
                $stmt->execute($params);
                foreach ($stmt->fetchAll(PDO::FETCH_ASSOC) ?: [] as $row) {
                    $raw[] = $row;
                }
            } catch (\Throwable $e) {
                // Skip a broken category rather than failing the whole report
                error_log('inventorySpend ' . $cat . ': ' . $e->getMessage());
            }
        }

        usort($raw, static function ($a, $b) {
            $da = (string) ($a['effective_purchase_date'] ?? '');
            $db = (string) ($b['effective_purchase_date'] ?? '');
            if ($da === $db) {
                return ((int) ($b['asset_id'] ?? 0)) <=> ((int) ($a['asset_id'] ?? 0));
            }
            return $db <=> $da;
        });

        $rows = [];
        $totalSpend = 0.0;
        $withPrice = 0;
        $byCompany = [];
        $byCategory = [];

        foreach ($raw as $r) {
            $code = (string) ($r['company_code'] ?? '');
            $label = $code === 'IT' ? 'ITL' : (string) (($r['company_short'] ?? '') !== '' ? $r['company_short'] : ($code !== '' ? $code : '—'));
            $amt = round((float) ($r['purchase_amount_lkr'] ?? 0), 2);
            $recorded = $r['purchase_date'] !== null && $r['purchase_date'] !== ''
                ? substr((string) $r['purchase_date'], 0, 10)
                : null;
            $effective = $r['effective_purchase_date'] !== null
                ? substr((string) $r['effective_purchase_date'], 0, 10)
                : $recorded;
            $cat = (string) ($r['asset_category'] ?? '');
            $itemType = (string) ($r['item_type'] ?? 'other');
            $fallback = ($r['date_fallback'] ?? false) === true
                || $r['date_fallback'] === 't'
                || $r['date_fallback'] === '1'
                || $r['date_fallback'] === 1
                || $recorded === null;

            $totalSpend += $amt;
            if ($amt > 0) {
                $withPrice++;
            }

            if (! isset($byCompany[$code])) {
                $byCompany[$code] = [
                    'company_code' => $code,
                    'company_label' => $label,
                    'asset_count' => 0,
                    'total_spend' => 0.0,
                ];
            }
            $byCompany[$code]['asset_count']++;
            $byCompany[$code]['total_spend'] += $amt;

            if (! isset($byCategory[$cat])) {
                $byCategory[$cat] = [
                    'asset_category' => $cat,
                    'item_type' => $itemType,
                    'asset_count' => 0,
                    'total_spend' => 0.0,
                ];
            }
            $byCategory[$cat]['asset_count']++;
            $byCategory[$cat]['total_spend'] += $amt;

            $rows[] = [
                'asset_category' => $cat,
                'asset_id' => (int) ($r['asset_id'] ?? 0),
                'asset_tag' => (string) ($r['asset_tag'] ?? ''),
                'item_name' => (string) ($r['item_name'] ?? ''),
                'item_type' => $itemType,
                'brand' => $r['brand'] ?? null,
                'model' => $r['model'] ?? null,
                'purchase_amount_lkr' => $amt,
                'purchase_date' => $effective,
                'acquired_date' => $recorded ?? $effective,
                'date_is_fallback' => $fallback,
                'invoice_no' => $r['invoice_no'] ?? null,
                'status' => $r['status'] ?? null,
                'company_id' => isset($r['company_id']) ? (int) $r['company_id'] : null,
                'company_code' => $code,
                'company_label' => $label,
                'location_id' => isset($r['location_id']) ? (int) $r['location_id'] : null,
                'location_name' => $r['location_name'] ?? null,
                'department_id' => isset($r['department_id']) ? (int) $r['department_id'] : null,
                'department_name' => $r['department_name'] ?? null,
                'staff_name' => $r['staff_name'] ?? null,
            ];
        }

        foreach ($byCompany as &$co) {
            $co['total_spend'] = round((float) $co['total_spend'], 2);
        }
        unset($co);
        foreach ($byCategory as &$cg) {
            $cg['total_spend'] = round((float) $cg['total_spend'], 2);
        }
        unset($cg);

        usort($byCompany, static fn ($a, $b) => $b['total_spend'] <=> $a['total_spend']);
        usort($byCategory, static fn ($a, $b) => $b['total_spend'] <=> $a['total_spend']);

        Response::json([
            'data' => $rows,
            'summary' => [
                'total_spend' => round($totalSpend, 2),
                'asset_count' => count($rows),
                'with_price_count' => $withPrice,
                'by_company' => array_values($byCompany),
                'by_category' => array_values($byCategory),
            ],
            'meta' => [
                'from_date' => $from,
                'to_date' => $to,
                'note' => 'New purchases: non-legacy laptops/phones, newly purchased PCs, and other assets with purchase amount. Date = Acquired On / purchase date.',
            ],
        ]);
    }

    /**
     * GET /api/expenditures/from-inventory
     * Search Assets (PC / laptop / phone / printer / other) so Expenditure can
     * pull purchase_amount_lkr as unit price and purchase_date (Acquired On) as expense date.
     */
    public function fromInventory(Request $request, array $user): void
    {
        $q = trim((string) $request->input('q', ''));
        $limit = min(50, max(5, (int) $request->input('limit', 25)));
        $categoryFilter = strtolower(trim((string) $request->input('category', '')));

        $tables = [
            'laptop' => ['table' => 'laptops', 'item_type' => 'laptop', 'name_expr' => "COALESCE(NULLIF(TRIM(a.pc_name), ''), NULLIF(TRIM(a.asset_tag), ''), 'Laptop')"],
            'mobile_phone' => ['table' => 'mobile_phones', 'item_type' => 'mobile_phone', 'name_expr' => "COALESCE(NULLIF(TRIM(a.pc_name), ''), NULLIF(TRIM(a.asset_tag), ''), 'Mobile phone')"],
            'pc' => ['table' => 'pcs', 'item_type' => 'desktop_pc', 'name_expr' => "COALESCE(NULLIF(TRIM(a.pc_name), ''), NULLIF(TRIM(a.asset_tag), ''), 'Desktop PC')"],
            'printer' => ['table' => 'printers', 'item_type' => 'printer', 'name_expr' => "COALESCE(NULLIF(TRIM(a.pc_name), ''), NULLIF(TRIM(a.asset_tag), ''), 'Printer')"],
            'other' => ['table' => 'other_assets', 'item_type' => 'other', 'name_expr' => "COALESCE(NULLIF(TRIM(a.item_name), ''), NULLIF(TRIM(a.pc_name), ''), NULLIF(TRIM(a.asset_tag), ''), 'Other asset')"],
        ];

        if ($categoryFilter !== '' && isset($tables[$categoryFilter])) {
            $tables = [$categoryFilter => $tables[$categoryFilter]];
        } elseif ($categoryFilter === 'desktop_pc') {
            $tables = ['pc' => $tables['pc']];
        }

        $companyId = null;
        if (($user['role'] ?? '') !== 'super_admin') {
            $companyId = (int) ($user['company_id'] ?? 0);
        } elseif ($request->input('company_id')) {
            $companyId = (int) $request->input('company_id');
        }

        $parts = [];
        $params = [];
        $i = 0;
        foreach ($tables as $cat => $meta) {
            $i++;
            $where = ['1=1'];
            if ($companyId !== null && $companyId > 0) {
                $ck = 'company_id_' . $i;
                $where[] = "a.company_id = :{$ck}";
                $params[$ck] = $companyId;
            }
            if ($q !== '') {
                $qk = 'q_' . $i;
                $params[$qk] = '%' . $q . '%';
                if ($cat === 'other') {
                    $where[] = "(a.asset_tag ILIKE :{$qk} OR a.item_name ILIKE :{$qk} OR a.pc_name ILIKE :{$qk}
                        OR a.serial_number ILIKE :{$qk} OR a.brand ILIKE :{$qk} OR a.model ILIKE :{$qk}
                        OR a.invoice_no ILIKE :{$qk})";
                } else {
                    $where[] = "(a.asset_tag ILIKE :{$qk} OR a.pc_name ILIKE :{$qk} OR a.serial_number ILIKE :{$qk}
                        OR a.brand ILIKE :{$qk} OR a.model ILIKE :{$qk} OR a.invoice_no ILIKE :{$qk})";
                }
            }
            // Prefer assets that have a purchase amount or acquired/purchase date
            $parts[] = "SELECT
                '{$cat}' AS asset_category,
                a.id AS asset_id,
                a.asset_tag,
                {$meta['name_expr']} AS item_name,
                '{$meta['item_type']}' AS item_type,
                a.brand,
                a.model,
                a.purchase_amount_lkr,
                a.purchase_date,
                a.invoice_no,
                a.company_id,
                a.location_id,
                a.department_id,
                a.supplier_id,
                c.code AS company_code,
                c.short_name AS company_short,
                l.name AS location_name,
                d.name AS department_name,
                s.name AS supplier_name
             FROM {$meta['table']} a
             LEFT JOIN companies c ON c.id = a.company_id
             LEFT JOIN locations l ON l.id = a.location_id
             LEFT JOIN departments d ON d.id = a.department_id
             LEFT JOIN suppliers s ON s.id = a.supplier_id
             WHERE " . implode(' AND ', $where);
        }

        if ($parts === []) {
            Response::json(['data' => []]);
            return;
        }

        $sql = '(' . implode(') UNION ALL (', $parts) . ')
                ORDER BY purchase_date DESC NULLS LAST, asset_id DESC
                LIMIT ' . $limit;
        $stmt = $this->pdo->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];

        $out = [];
        foreach ($rows as $r) {
            $code = (string) ($r['company_code'] ?? '');
            $purchaseDate = $r['purchase_date'] ?? null;
            if ($purchaseDate !== null) {
                $purchaseDate = substr((string) $purchaseDate, 0, 10);
            }
            $out[] = [
                'asset_category' => (string) ($r['asset_category'] ?? ''),
                'asset_id' => (int) ($r['asset_id'] ?? 0),
                'asset_tag' => (string) ($r['asset_tag'] ?? ''),
                'item_name' => (string) ($r['item_name'] ?? ''),
                'item_type' => (string) ($r['item_type'] ?? 'other'),
                'brand' => $r['brand'] ?? null,
                'model' => $r['model'] ?? null,
                // Unit price for expenditure = Assets purchase amount
                'purchase_amount_lkr' => $r['purchase_amount_lkr'] !== null ? (float) $r['purchase_amount_lkr'] : null,
                // Acquired On in Assets = purchased date = expenditure expense_date
                'purchase_date' => $purchaseDate,
                'acquired_date' => $purchaseDate,
                'invoice_no' => $r['invoice_no'] ?? null,
                'company_id' => isset($r['company_id']) ? (int) $r['company_id'] : null,
                'company_label' => $code === 'IT' ? 'ITL' : (string) ($r['company_short'] ?? $code),
                'location_id' => isset($r['location_id']) ? (int) $r['location_id'] : null,
                'location_name' => $r['location_name'] ?? null,
                'department_id' => isset($r['department_id']) ? (int) $r['department_id'] : null,
                'department_name' => $r['department_name'] ?? null,
                'supplier_id' => isset($r['supplier_id']) ? (int) $r['supplier_id'] : null,
                'supplier_name' => $r['supplier_name'] ?? null,
            ];
        }

        Response::json([
            'data' => $out,
            'meta' => [
                'note' => 'purchase_date (Acquired On) is the purchased date used as expense_date; purchase_amount_lkr is the unit price',
            ],
        ]);
    }

    private function ensureTables(): void
    {
        static $done = false;
        if ($done) {
            return;
        }
        try {
            $this->pdo->query('SELECT 1 FROM it_expenditures LIMIT 1');
            $done = true;
        } catch (\Throwable) {
            $sqlFile = dirname(__DIR__, 2) . '/../database/migrations/create_it_expenditures.sql';
            // path: backend/src/Controllers -> backend -> ITAMS/database
            $sqlFile = dirname(__DIR__, 3) . DIRECTORY_SEPARATOR . 'database' . DIRECTORY_SEPARATOR . 'migrations' . DIRECTORY_SEPARATOR . 'create_it_expenditures.sql';
            if (is_file($sqlFile)) {
                $this->pdo->exec((string) file_get_contents($sqlFile));
            }
            $done = true;
        }
    }
}
