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

$personFields = [
    'laptops' => [
        'allocated_person',
        'original_assigned_person',
        'handover_person_1',
        'handover_person_2',
        'handover_person_3',
        'handover_person_4',
    ],
    'mobile_phones' => [
        'allocated_person',
        'original_assigned_person',
        'first_handover_person',
        'handover_person_1',
        'handover_person_2',
        'handover_person_3',
        'handover_person_4',
    ],
];

/** Strip every leading Mr/Ms/Mrs/Miss (with or without space/dot). */
function strip_all_titles(string $s): string
{
    $s = trim($s);
    $prev = null;
    while ($prev !== $s) {
        $prev = $s;
        $s = preg_replace('/^\s*(mr|mrs|ms|miss)\.?\s*/i', '', $s) ?? $s;
        $s = trim($s);
    }
    return preg_replace('/\s+/', ' ', $s) ?? $s;
}

/**
 * Prefer the last title seen in the original string (handles Mr. Ms.Name → Ms).
 * @return 'Mr'|'Ms'|'Mrs'|null
 */
function detect_title(string $raw): ?string
{
    if (! preg_match_all('/\b(mr|mrs|ms|miss)\.?\b/i', $raw, $m)) {
        return null;
    }
    $last = strtolower((string) end($m[1]));
    return match ($last) {
        'mrs' => 'Mrs',
        'ms', 'miss' => 'Ms',
        default => 'Mr',
    };
}

function normalize_person(string $raw): string
{
    $raw = trim($raw);
    if ($raw === '') {
        return $raw;
    }

    // Don't title-case "Missing..." placeholders oddly — just strip duplicate titles
    $title = detect_title($raw);
    $core = strip_all_titles($raw);
    if ($core === '') {
        return $raw;
    }

    // Placeholders / non-person labels
    if (preg_match('/^missing\b/i', $core) || preg_match('/^it$/i', $core)) {
        return $core;
    }

    if ($title === null) {
        return $core;
    }

    return $title . '. ' . $core;
}

$pdo->beginTransaction();
$updated = 0;
$examples = [];

foreach ($personFields as $table => $fields) {
    $cols = implode(', ', $fields);
    $rows = $pdo->query("SELECT id, {$cols} FROM {$table}")->fetchAll();
    foreach ($rows as $row) {
        $sets = [];
        foreach ($fields as $f) {
            $raw = (string) ($row[$f] ?? '');
            if (trim($raw) === '') {
                continue;
            }
            // Only touch rows with duplicate/stuck titles or missing space after title
            $needs = (bool) preg_match(
                '/^\s*(mr|mrs|ms|miss)\.?\s*(mr|mrs|ms|miss)\.?/i',
                $raw
            ) || (bool) preg_match('/^\s*(mr|mrs|ms|miss)\.[A-Za-z]/i', $raw);
            if (! $needs && ! preg_match('/(mr|mrs|ms|miss)\.?\s+(mr|mrs|ms|miss)\.?/i', $raw)) {
                continue;
            }
            $fixed = normalize_person($raw);
            if ($fixed !== $raw) {
                $sets[$f] = $fixed;
                if (count($examples) < 20) {
                    $examples[] = "{$table}#{$row['id']} {$f}: [{$raw}] -> [{$fixed}]";
                }
            }
        }
        if ($sets === []) {
            continue;
        }
        $parts = [];
        $params = ['id' => (int) $row['id']];
        $i = 0;
        foreach ($sets as $f => $v) {
            $k = 'v' . $i++;
            $parts[] = "{$f} = :{$k}";
            $params[$k] = $v;
            $updated++;
        }
        $pdo->prepare(
            'UPDATE ' . $table . ' SET ' . implode(', ', $parts) . ', updated_at = NOW() WHERE id = :id'
        )->execute($params);
    }
}

$pdo->commit();

echo "Updated fields: {$updated}\n";
foreach ($examples as $e) {
    echo "  {$e}\n";
}

// Verify none left
$left = 0;
foreach ($personFields as $table => $fields) {
    foreach ($fields as $f) {
        $n = (int) $pdo->query(
            "SELECT COUNT(*) FROM {$table}
             WHERE {$f} ~* '^\\s*(Mr\\.?|Mrs\\.?|Ms\\.?|Miss\\.?)\\s*(Mr\\.?|Mrs\\.?|Ms\\.?|Miss\\.?)'"
        )->fetchColumn();
        $left += $n;
    }
}
echo "Remaining double titles: {$left}\n";
