<?php

declare(strict_types=1);

$config = require dirname(__DIR__, 2) . '/backend/config/config.php';
$db = $config['db'];
$dsn = sprintf(
    'pgsql:host=%s;port=%s;dbname=%s;sslmode=%s',
    $db['host'],
    $db['port'],
    $db['name'],
    $db['sslmode'] ?? 'disable'
);
$pdo = new PDO($dsn, $db['user'], $db['pass'], [
    PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
]);

echo "=== Before ===\n";
$rows = $pdo->query(
    "SELECT work_location, COUNT(*)::int AS n
     FROM employees
     WHERE is_active = TRUE AND work_location IS NOT NULL AND btrim(work_location) <> ''
     GROUP BY work_location
     ORDER BY n DESC, work_location"
)->fetchAll();
foreach ($rows as $r) {
    echo $r['n'] . "\t" . $r['work_location'] . "\n";
}

// Strip leading company prefixes: ITL / IMS / ISP / FOTON / IT + hyphen.
// Leave "Head Office Kandy" (and any head-office location) unchanged.
$sql = <<<'SQL'
UPDATE employees
SET work_location = NULLIF(
        btrim(
            regexp_replace(
                work_location,
                '^\s*(ITL|IMS|ISP|FOTON|IT)\s*[-–—]+\s*',
                '',
                'i'
            )
        ),
        ''
    ),
    updated_at = NOW()
WHERE work_location IS NOT NULL
  AND work_location ~* '^\s*(ITL|IMS|ISP|FOTON|IT)\s*[-–—]'
  AND work_location !~* 'head\s*office'
RETURNING id, staff_id, work_location;
SQL;

$updated = $pdo->query($sql)->fetchAll();
echo "\nUpdated " . count($updated) . " rows.\n";

echo "\n=== After ===\n";
$rows = $pdo->query(
    "SELECT work_location, COUNT(*)::int AS n
     FROM employees
     WHERE is_active = TRUE AND work_location IS NOT NULL AND btrim(work_location) <> ''
     GROUP BY work_location
     ORDER BY n DESC, work_location"
)->fetchAll();
foreach ($rows as $r) {
    echo $r['n'] . "\t" . $r['work_location'] . "\n";
}
