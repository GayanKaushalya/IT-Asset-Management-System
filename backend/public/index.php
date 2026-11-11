<?php

declare(strict_types=1);

use Indra\Itam\Controllers\AgreementController;
use Indra\Itam\Controllers\AssetAttachmentController;
use Indra\Itam\Controllers\AssetController;
use Indra\Itam\Controllers\ExpenditureController;
use Indra\Itam\Controllers\AuditController;
use Indra\Itam\Controllers\AuthController;
use Indra\Itam\Controllers\BackupController;
use Indra\Itam\Controllers\CredentialVaultController;
use Indra\Itam\Controllers\DashboardController;
use Indra\Itam\Controllers\EmailAccountController;
use Indra\Itam\Controllers\EmployeeController;
use Indra\Itam\Controllers\HandoverController;
use Indra\Itam\Controllers\MetaController;
use Indra\Itam\Controllers\NotificationController;
use Indra\Itam\Controllers\PeripheralController;
use Indra\Itam\Controllers\PcKitController;
use Indra\Itam\Controllers\ReportController;
use Indra\Itam\Controllers\UserController;
use Indra\Itam\Database\Connection;
use Indra\Itam\Http\Request;
use Indra\Itam\Http\Response;
use Indra\Itam\Http\Router;
use Indra\Itam\Services\CredentialEncryptionService;
use Indra\Itam\Support\Auth;

require dirname(__DIR__) . '/bootstrap.php';
require dirname(__DIR__) . '/config/load_config.php';

$config = itam_config();

$origin = $config['app']['cors_origin'] ?? '*';
header('Access-Control-Allow-Origin: ' . $origin);
header('Access-Control-Allow-Headers: Content-Type, Authorization, X-User-Id');
header('Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS');
header('Access-Control-Max-Age: 86400');
header('Vary: Origin');

if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

try {
    $pdo = Connection::make($config['db']);
} catch (Throwable $e) {
    Response::error(
        ($config['app']['debug'] ?? false) ? $e->getMessage() : 'Database connection error',
        500
    );
    exit;
}

$request = Request::fromGlobals();

$makeVault = static function () use ($config): CredentialEncryptionService {
    return new CredentialEncryptionService((string) ($config['vault_encryption_key'] ?? ''));
};

$auth = new AuthController($pdo);
$dashboard = new DashboardController($pdo);
$assets = new AssetController($pdo);
$assetAttachments = new AssetAttachmentController($pdo);
$peripherals = new PeripheralController($pdo);
$pcKit = new PcKitController($pdo);
$users = new UserController($pdo);
$meta = new MetaController($pdo);
$handovers = new HandoverController($pdo);
$audit = new AuditController($pdo);
$employees = new EmployeeController($pdo);
$agreements = new AgreementController($pdo);
$expenditures = new ExpenditureController($pdo);
$reports = new ReportController($pdo);
$notifications = new NotificationController($pdo);
$backups = new BackupController(
    $pdo,
    dirname(__DIR__, 2),
    (string) ($config['db']['host'] ?? 'local')
);

$router = new Router();

$router->add('GET', '/api/health', static function () use ($config): void {
    Response::json(['ok' => true, 'app' => $config['app']['name'] ?? 'ITAM']);
});

$router->add('POST', '/api/login', static function (Request $req) use ($auth): void {
    $auth->login($req);
});

$router->add('POST', '/api/register', static function (Request $req) use ($auth): void {
    $auth->register($req);
});

$router->add('GET', '/api/public/companies', static function () use ($pdo): void {
    $rows = $pdo->query(
        'SELECT id, code, name, short_name FROM companies WHERE is_active = TRUE ORDER BY id'
    )->fetchAll();
    Response::json(['data' => $rows]);
});

$authed = static function (callable $fn) use ($pdo, $config): callable {
    return static function (Request $req, array $params = []) use ($fn, $pdo, $config): void {
        $user = Auth::requireUser($pdo, $req, $config);
        $fn($req, $user, $params);
    };
};

$router->add('GET', '/api/me', $authed(static function (Request $req, array $user) use ($auth): void {
    $auth->me($user);
}));
$router->add('PUT', '/api/me', $authed(static function (Request $req, array $user) use ($auth): void {
    $auth->updateProfile($req, $user);
}));
$router->add('POST', '/api/me/password', $authed(static function (Request $req, array $user) use ($auth): void {
    $auth->changePassword($req, $user);
}));

$router->add('POST', '/api/logout', $authed(static function (Request $req, array $user) use ($auth): void {
    $auth->logout($req, $user);
}));

$router->add('GET', '/api/dashboard', $authed(static function (Request $req, array $user) use ($dashboard): void {
    $dashboard->index($req, $user);
}));

$router->add('GET', '/api/companies', $authed(static function (Request $req, array $user) use ($meta): void {
    $meta->companies($user);
}));
$router->add('GET', '/api/locations', $authed(static function (Request $req, array $user) use ($meta): void {
    $meta->locations($user, $req);
}));
$router->add('POST', '/api/locations', $authed(static function (Request $req, array $user) use ($meta): void {
    $meta->storeLocation($req, $user);
}));
$router->add('GET', '/api/departments', $authed(static function (Request $req, array $user) use ($meta): void {
    $meta->departments($user);
}));
$router->add('POST', '/api/departments', $authed(static function (Request $req, array $user) use ($meta): void {
    $meta->storeDepartment($req, $user);
}));
$router->add('GET', '/api/suppliers', $authed(static function (Request $req, array $user) use ($meta): void {
    $meta->suppliers($user);
}));
$router->add('POST', '/api/suppliers', $authed(static function (Request $req, array $user) use ($meta): void {
    $meta->storeSupplier($req, $user);
}));
$router->add('GET', '/api/org', $authed(static function (Request $req, array $user) use ($meta): void {
    $meta->org($user, $req);
}));

$router->add('GET', '/api/assets', $authed(static function (Request $req, array $user) use ($assets): void {
    $assets->index($req, $user);
}));
$router->add('GET', '/api/assets/export', $authed(static function (Request $req, array $user) use ($assets): void {
    $assets->export($req, $user);
}));
$router->add('GET', '/api/assets/import-template', $authed(static function (Request $req, array $user) use ($assets): void {
    $assets->importTemplate($req, $user);
}));
$router->add('POST', '/api/assets/import', $authed(static function (Request $req, array $user) use ($assets): void {
    $assets->import($req, $user);
}));
$router->add('GET', '/api/assets/{category}/{id}/status-history', $authed(static function (Request $req, array $user, array $params) use ($assets): void {
    $assets->statusHistory($req, $user, $params);
}));
$router->add('GET', '/api/assets/{category}/{id}/lifecycle', $authed(static function (Request $req, array $user, array $params) use ($assets): void {
    $assets->lifecycle($req, $user, $params);
}));
$router->add('GET', '/api/assets/pc/{id}/kit', $authed(static function (Request $req, array $user, array $params) use ($pcKit): void {
    $pcKit->index($req, $user, (string) ($params['id'] ?? ''));
}));
$router->add('POST', '/api/assets/pc/{id}/kit', $authed(static function (Request $req, array $user, array $params) use ($pcKit): void {
    $pcKit->store($req, $user, (string) ($params['id'] ?? ''));
}));
$router->add('POST', '/api/assets/pc/{id}/kit/{kitId}/retire', $authed(static function (Request $req, array $user, array $params) use ($pcKit): void {
    $pcKit->retire($req, $user, (string) ($params['id'] ?? ''), (string) ($params['kitId'] ?? ''));
}));
$router->add('POST', '/api/assets/pc/{id}/replace-hardware', $authed(static function (Request $req, array $user, array $params) use ($assets): void {
    $assets->replaceHardware($req, $user, $params);
}));
$router->add('GET', '/api/assets/{category}/{id}/attachments', $authed(static function (Request $req, array $user, array $params) use ($assetAttachments): void {
    $assetAttachments->index($req, $user, $params);
}));
$router->add('POST', '/api/assets/{category}/{id}/attachments', $authed(static function (Request $req, array $user, array $params) use ($assetAttachments): void {
    $assetAttachments->upload($req, $user, $params);
}));
$router->add('GET', '/api/assets/{category}/{id}/attachments/{attachmentId}', $authed(static function (Request $req, array $user, array $params) use ($assetAttachments): void {
    $assetAttachments->download($req, $user, $params);
}));
$router->add('DELETE', '/api/assets/{category}/{id}/attachments/{attachmentId}', $authed(static function (Request $req, array $user, array $params) use ($assetAttachments): void {
    $assetAttachments->destroy($req, $user, $params);
}));
$router->add('GET', '/api/assets/{category}/{id}', $authed(static function (Request $req, array $user, array $params) use ($assets): void {
    $assets->show($req, $user, $params);
}));
$router->add('GET', '/api/assets/{id}', $authed(static function (Request $req, array $user, array $params) use ($assets): void {
    $assets->show($req, $user, $params);
}));
$router->add('POST', '/api/assets', $authed(static function (Request $req, array $user) use ($assets): void {
    $assets->store($req, $user);
}));
$router->add('PUT', '/api/assets/{category}/{id}', $authed(static function (Request $req, array $user, array $params) use ($assets): void {
    $assets->update($req, $user, $params);
}));
$router->add('PUT', '/api/assets/{id}', $authed(static function (Request $req, array $user, array $params) use ($assets): void {
    $assets->update($req, $user, $params);
}));
$router->add('POST', '/api/assets/{category}/{id}/transfer-company', $authed(static function (Request $req, array $user, array $params) use ($assets): void {
    $assets->transferCompany($req, $user, $params);
}));
$router->add('DELETE', '/api/assets/{category}/{id}', $authed(static function (Request $req, array $user, array $params) use ($assets): void {
    $assets->destroy($req, $user, $params);
}));
$router->add('DELETE', '/api/assets/{id}', $authed(static function (Request $req, array $user, array $params) use ($assets): void {
    $assets->destroy($req, $user, $params);
}));

$router->add('GET', '/api/peripherals', $authed(static function (Request $req, array $user) use ($peripherals): void {
    $peripherals->index($req, $user);
}));
$router->add('GET', '/api/peripherals/{id}', $authed(static function (Request $req, array $user, array $params) use ($peripherals): void {
    $peripherals->show($req, $user, $params);
}));
$router->add('POST', '/api/peripherals', $authed(static function (Request $req, array $user) use ($peripherals): void {
    $peripherals->store($req, $user);
}));
$router->add('PUT', '/api/peripherals/{id}', $authed(static function (Request $req, array $user, array $params) use ($peripherals): void {
    $peripherals->update($req, $user, $params);
}));
$router->add('DELETE', '/api/peripherals/{id}', $authed(static function (Request $req, array $user, array $params) use ($peripherals): void {
    $peripherals->destroy($req, $user, $params);
}));

$router->add('GET', '/api/employees', $authed(static function (Request $req, array $user) use ($employees): void {
    $employees->index($req, $user);
}));
$router->add('POST', '/api/employees', $authed(static function (Request $req, array $user) use ($employees): void {
    $employees->store($req, $user);
}));
$router->add('GET', '/api/employees/locations', $authed(static function (Request $req, array $user) use ($employees): void {
    $employees->locations($req, $user);
}));
$router->add('GET', '/api/employees/{id}', $authed(static function (Request $req, array $user, array $params) use ($employees): void {
    $employees->show($req, $user, (string) ($params['id'] ?? ''));
}));
$router->add('PUT', '/api/employees/{id}', $authed(static function (Request $req, array $user, array $params) use ($employees): void {
    $employees->update($req, $user, (string) ($params['id'] ?? ''));
}));
$router->add('DELETE', '/api/employees/{id}', $authed(static function (Request $req, array $user, array $params) use ($employees): void {
    $employees->destroy($req, $user, (string) ($params['id'] ?? ''));
}));

$router->add('GET', '/api/agreements', $authed(static function (Request $req, array $user) use ($agreements): void {
    $agreements->index($req, $user);
}));
$router->add('POST', '/api/agreements', $authed(static function (Request $req, array $user) use ($agreements): void {
    $agreements->store($req, $user);
}));
$router->add('GET', '/api/agreements/{id}', $authed(static function (Request $req, array $user, array $params) use ($agreements): void {
    $agreements->show($req, $user, (string) ($params['id'] ?? ''));
}));
$router->add('PUT', '/api/agreements/{id}', $authed(static function (Request $req, array $user, array $params) use ($agreements): void {
    $agreements->update($req, $user, (string) ($params['id'] ?? ''));
}));
$router->add('POST', '/api/agreements/{id}/renew', $authed(static function (Request $req, array $user, array $params) use ($agreements): void {
    $agreements->renew($req, $user, (string) ($params['id'] ?? ''));
}));
$router->add('GET', '/api/agreements/{id}/history', $authed(static function (Request $req, array $user, array $params) use ($agreements): void {
    $agreements->history($req, $user, (string) ($params['id'] ?? ''));
}));
$router->add('DELETE', '/api/agreements/{id}', $authed(static function (Request $req, array $user, array $params) use ($agreements): void {
    $agreements->destroy($req, $user, (string) ($params['id'] ?? ''));
}));
$router->add('POST', '/api/agreements/{id}/document', $authed(static function (Request $req, array $user, array $params) use ($agreements): void {
    $agreements->uploadDocument($req, $user, (string) ($params['id'] ?? ''));
}));
$router->add('GET', '/api/agreements/{id}/document', $authed(static function (Request $req, array $user, array $params) use ($agreements): void {
    $agreements->downloadDocument($req, $user, (string) ($params['id'] ?? ''));
}));

// IT Expenditure Management
$router->add('GET', '/api/expenditures/report', $authed(static function (Request $req, array $user) use ($expenditures): void {
    $expenditures->report($req, $user);
}));
$router->add('GET', '/api/expenditures/dashboard-summary', $authed(static function (Request $req, array $user) use ($expenditures): void {
    $expenditures->dashboardSummary($req, $user);
}));
$router->add('GET', '/api/expenditures/from-inventory', $authed(static function (Request $req, array $user) use ($expenditures): void {
    $expenditures->fromInventory($req, $user);
}));
$router->add('GET', '/api/expenditures/inventory-spend', $authed(static function (Request $req, array $user) use ($expenditures): void {
    $expenditures->inventorySpend($req, $user);
}));
$router->add('GET', '/api/expenditures', $authed(static function (Request $req, array $user) use ($expenditures): void {
    $expenditures->index($req, $user);
}));
$router->add('POST', '/api/expenditures', $authed(static function (Request $req, array $user) use ($expenditures): void {
    $expenditures->store($req, $user);
}));
$router->add('GET', '/api/expenditures/{id}', $authed(static function (Request $req, array $user, array $params) use ($expenditures): void {
    $expenditures->show($req, $user, (string) ($params['id'] ?? ''));
}));
$router->add('PUT', '/api/expenditures/{id}', $authed(static function (Request $req, array $user, array $params) use ($expenditures): void {
    $expenditures->update($req, $user, (string) ($params['id'] ?? ''));
}));
$router->add('DELETE', '/api/expenditures/{id}', $authed(static function (Request $req, array $user, array $params) use ($expenditures): void {
    $expenditures->destroy($req, $user, (string) ($params['id'] ?? ''));
}));
$router->add('POST', '/api/expenditures/{id}/void', $authed(static function (Request $req, array $user, array $params) use ($expenditures): void {
    $expenditures->voidRecord($req, $user, (string) ($params['id'] ?? ''));
}));
$router->add('POST', '/api/expenditures/{id}/attachments', $authed(static function (Request $req, array $user, array $params) use ($expenditures): void {
    $expenditures->uploadAttachment($req, $user, (string) ($params['id'] ?? ''));
}));
$router->add('GET', '/api/expenditures/{id}/attachments/{attachmentId}', $authed(static function (Request $req, array $user, array $params) use ($expenditures): void {
    $expenditures->downloadAttachment(
        $req,
        $user,
        (string) ($params['id'] ?? ''),
        (string) ($params['attachmentId'] ?? '')
    );
}));
$router->add('GET', '/api/users', $authed(static function (Request $req, array $user) use ($users): void {
    $users->index($req, $user);
}));
$router->add('POST', '/api/users', $authed(static function (Request $req, array $user) use ($users): void {
    $users->store($req, $user);
}));
$router->add('PUT', '/api/users/{id}', $authed(static function (Request $req, array $user, array $params) use ($users): void {
    $users->update($req, $user, (string) ($params['id'] ?? ''));
}));

$router->add('GET', '/api/reports/employees', $authed(static function (Request $req, array $user) use ($reports): void {
    $reports->employees($req, $user);
}));
$router->add('GET', '/api/reports/employees/{id}', $authed(static function (Request $req, array $user, array $params) use ($reports): void {
    $reports->employeeShow($req, $user, (string) ($params['id'] ?? ''));
}));
$router->add('GET', '/api/reports/inventory', $authed(static function (Request $req, array $user) use ($reports): void {
    $reports->inventory($req, $user);
}));
$router->add('GET', '/api/reports/pc-specs', $authed(static function (Request $req, array $user) use ($reports): void {
    $reports->pcSpecs($req, $user);
}));
$router->add('GET', '/api/reports/branch-assets', $authed(static function (Request $req, array $user) use ($reports): void {
    $reports->branchAssets($req, $user);
}));
$router->add('GET', '/api/reports/branch-assets/items', $authed(static function (Request $req, array $user) use ($reports): void {
    $reports->branchAssetItems($req, $user);
}));
$router->add('GET', '/api/reports/stock', $authed(static function (Request $req, array $user) use ($reports): void {
    $reports->stock($req, $user);
}));

$router->add('GET', '/api/notifications', $authed(static function (Request $req, array $user) use ($notifications): void {
    $notifications->index($req, $user);
}));
$router->add('POST', '/api/notifications/read-all', $authed(static function (Request $req, array $user) use ($notifications): void {
    $notifications->markAllRead($req, $user);
}));
$router->add('POST', '/api/notifications/{id}/read', $authed(static function (Request $req, array $user, array $params) use ($notifications): void {
    $notifications->markRead($req, $user, (string) ($params['id'] ?? ''));
}));

$router->add('GET', '/api/audit-logs', $authed(static function (Request $req, array $user) use ($audit): void {
    $audit->systemLogs($req, $user);
}));
$router->add('GET', '/api/audit-logs/sessions', $authed(static function (Request $req, array $user) use ($audit): void {
    $audit->sessions($req, $user);
}));
$router->add('GET', '/api/credentials/access-logs', $authed(static function (Request $req, array $user) use ($audit): void {
    $audit->credentialAccessLogs($req, $user);
}));

$router->add('GET', '/api/backups', $authed(static function (Request $req, array $user) use ($backups): void {
    $backups->index($req, $user);
}));
$router->add('POST', '/api/backups', $authed(static function (Request $req, array $user) use ($backups): void {
    $backups->create($req, $user);
}));
$router->add('GET', '/api/backups/download', $authed(static function (Request $req, array $user) use ($backups): void {
    $backups->download($req, $user, (string) $req->input('file', ''));
}));
$router->add('POST', '/api/backups/restore', $authed(static function (Request $req, array $user) use ($backups): void {
    $backups->restore($req, $user);
}));
$router->add('POST', '/api/backups/restore-upload', $authed(static function (Request $req, array $user) use ($backups): void {
    $backups->restoreUpload($req, $user);
}));

$router->add('GET', '/api/handovers', $authed(static function (Request $req, array $user) use ($handovers): void {
    $handovers->index($req, $user);
}));
$router->add('GET', '/api/handovers/available-devices', $authed(static function (Request $req, array $user) use ($handovers): void {
    $handovers->availablePersonDevices($req, $user);
}));
$router->add('POST', '/api/handovers/available-devices/hide', $authed(static function (Request $req, array $user) use ($handovers): void {
    $handovers->hideFromReports($req, $user);
}));
$router->add('GET', '/api/handovers/{id}/acceptance-form', $authed(static function (Request $req, array $user, array $params) use ($handovers): void {
    $handovers->acceptanceForm($req, $user, $params);
}));
$router->add('POST', '/api/handovers/acceptance-form', $authed(static function (Request $req, array $user) use ($handovers): void {
    $handovers->acceptanceFormCombined($req, $user);
}));
$router->add('POST', '/api/handovers/acceptance-form/printed', $authed(static function (Request $req, array $user) use ($handovers): void {
    $handovers->markAcceptanceFormPrinted($req, $user);
}));
$router->add('POST', '/api/handovers/checkout', $authed(static function (Request $req, array $user) use ($handovers): void {
    $handovers->checkout($req, $user);
}));
$router->add('PUT', '/api/handovers/{id}', $authed(static function (Request $req, array $user, array $params) use ($handovers): void {
    $handovers->update($req, $user, $params);
}));
$router->add('POST', '/api/handovers/{id}/checkin', $authed(static function (Request $req, array $user, array $params) use ($handovers): void {
    $handovers->checkin($req, $user, $params);
}));

$router->add('GET', '/api/credentials', $authed(static function (Request $req, array $user) use ($pdo, $makeVault): void {
    (new CredentialVaultController($pdo, $makeVault()))->index($req, $user);
}));
$router->add('POST', '/api/credentials', $authed(static function (Request $req, array $user) use ($pdo, $makeVault): void {
    (new CredentialVaultController($pdo, $makeVault()))->store($req, $user);
}));
$router->add('POST', '/api/credentials/{id}/reveal', $authed(static function (Request $req, array $user, array $params) use ($pdo, $makeVault): void {
    (new CredentialVaultController($pdo, $makeVault()))->reveal($req, $user, $params);
}));
$router->add('PUT', '/api/credentials/{id}/password', $authed(static function (Request $req, array $user, array $params) use ($pdo, $makeVault): void {
    (new CredentialVaultController($pdo, $makeVault()))->updatePassword($req, $user, $params);
}));
$router->add('PUT', '/api/credentials/{id}', $authed(static function (Request $req, array $user, array $params) use ($pdo, $makeVault): void {
    (new CredentialVaultController($pdo, $makeVault()))->update($req, $user, $params);
}));
$router->add('DELETE', '/api/credentials/{id}', $authed(static function (Request $req, array $user, array $params) use ($pdo, $makeVault): void {
    (new CredentialVaultController($pdo, $makeVault()))->destroy($req, $user, $params);
}));

$router->add('GET', '/api/email-accounts', $authed(static function (Request $req, array $user) use ($pdo, $makeVault): void {
    (new EmailAccountController($pdo, $makeVault()))->index($req, $user);
}));
$router->add('POST', '/api/email-accounts', $authed(static function (Request $req, array $user) use ($pdo, $makeVault): void {
    (new EmailAccountController($pdo, $makeVault()))->store($req, $user);
}));
$router->add('POST', '/api/email-accounts/{id}/reveal', $authed(static function (Request $req, array $user, array $params) use ($pdo, $makeVault): void {
    (new EmailAccountController($pdo, $makeVault()))->reveal($req, $user, $params);
}));
$router->add('PUT', '/api/email-accounts/users/{id}', $authed(static function (Request $req, array $user, array $params) use ($pdo, $makeVault): void {
    (new EmailAccountController($pdo, $makeVault()))->updateUser($req, $user, $params);
}));
$router->add('DELETE', '/api/email-accounts/users/{id}', $authed(static function (Request $req, array $user, array $params) use ($pdo, $makeVault): void {
    (new EmailAccountController($pdo, $makeVault()))->destroyUser($req, $user, $params);
}));

try {
    $router->dispatch($request);
} catch (Throwable $e) {
    Response::error(
        ($config['app']['debug'] ?? false) ? $e->getMessage() : 'Internal server error',
        500
    );
}
