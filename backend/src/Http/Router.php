<?php

declare(strict_types=1);

namespace Indra\Itam\Http;

/**
 * Minimal method + path router. Paths may include {id} or {uuid} placeholders.
 */
final class Router
{
    /** @var list<array{method:string,pattern:string,handler:callable}> */
    private array $routes = [];

    public function add(string $method, string $pattern, callable $handler): void
    {
        $this->routes[] = [
            'method' => strtoupper($method),
            'pattern' => $pattern,
            'handler' => $handler,
        ];
    }

    public function dispatch(Request $request): void
    {
        foreach ($this->routes as $route) {
            if ($route['method'] !== $request->method) {
                continue;
            }

            $regex = preg_replace('#\{([a-zA-Z_]+)\}#', '(?P<$1>[^/]+)', $route['pattern']);
            $regex = '#^' . $regex . '$#';

            if (! preg_match($regex, $request->path, $matches)) {
                continue;
            }

            $params = array_filter(
                $matches,
                static fn ($k) => ! is_int($k),
                ARRAY_FILTER_USE_KEY
            );

            ($route['handler'])($request, $params);
            return;
        }

        Response::error('Not found', 404);
    }
}
