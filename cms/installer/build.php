<?php
declare(strict_types=1);
/**
 * Arma "instalar.php": un solo archivo con todo el CMS adentro.
 *
 *  - Desde la terminal:  php cms/installer/build.php > instalar.php
 *  - Desde el panel:     botón "Descargar instalador" (en Usuarios), que usa
 *                        cms/installer/descargar.php
 *
 * Se empaqueta el codigo de cms/ tal como esta en este servidor, SIN los
 * datos de este sitio (data/, uploads/, config.php no viajan).
 */

function cms_installer_files(string $cmsDir): array
{
    $files = [];
    $it = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($cmsDir, FilesystemIterator::SKIP_DOTS));
    foreach ($it as $f) {
        if (!$f->isFile()) continue;
        $rel = str_replace('\\', '/', substr($f->getPathname(), strlen($cmsDir) + 1));
        $first = explode('/', $rel, 2)[0];
        if (in_array($rel, ['config.php', 'config.local.php'], true)) continue;
        if ($first === 'uploads') continue;
        if ($first === 'data' && !in_array($rel, ['data/.htaccess', 'data/.gitignore'], true)) continue;
        if (basename($rel) === '.DS_Store' || str_contains($rel, '.nuevo-')) continue;
        $files[$rel] = base64_encode((string) file_get_contents($f->getPathname()));
    }
    ksort($files);
    return $files;
}

function cms_build_installer(string $cmsDir, array $meta): string
{
    $tpl = (string) file_get_contents($cmsDir . '/installer/instalar.tpl');
    $payload = base64_encode((string) gzdeflate(json_encode(['meta' => $meta, 'files' => cms_installer_files($cmsDir)],
        JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), 9));
    return str_replace("'/*__PAYLOAD__*/'", "'" . $payload . "'", $tpl);
}

/* uso por terminal */
if (PHP_SAPI === 'cli' && realpath((string) ($_SERVER['SCRIPT_FILENAME'] ?? '')) === __FILE__) {
    $cmsDir = dirname(__DIR__);
    $conf = is_file($cmsDir . '/config.php') ? (array) require $cmsDir . '/config.php' : [];
    $meta = ['repo' => $conf['update_repo'] ?? 'juanlanzos/cms', 'branch' => $conf['update_branch'] ?? 'main',
             'sha' => '', 'date' => '', 'message' => ''];
    $git = @shell_exec('git -C ' . escapeshellarg($cmsDir) . ' log -1 --format=%H%n%cI%n%s 2>/dev/null');
    if ($git) [$meta['sha'], $meta['date'], $meta['message']] = array_pad(explode("\n", trim($git), 3), 3, '');
    echo cms_build_installer($cmsDir, $meta);
}
