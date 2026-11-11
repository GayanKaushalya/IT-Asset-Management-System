<?php

declare(strict_types=1);

$root = __DIR__; // backend/

// Prefer Composer autoload when available
$composerAutoload = $root . '/vendor/autoload.php';
if (is_file($composerAutoload)) {
    require $composerAutoload;
} else {
    spl_autoload_register(static function (string $class) use ($root): void {
        $prefix = 'Indra\\Itam\\';
        if (! str_starts_with($class, $prefix)) {
            return;
        }
        $relative = str_replace('\\', DIRECTORY_SEPARATOR, substr($class, strlen($prefix)));
        $file = $root . '/src/' . $relative . '.php';
        if (is_file($file)) {
            require $file;
        }
    });
}

$configFile = $root . '/config/config.php';
if (! is_file($configFile)) {
    $example = $root . '/config/config.example.php';
    if (is_file($example)) {
        copy($example, $configFile);
    }
}
