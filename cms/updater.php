<?php
declare(strict_types=1);
/**
 * Actualizar el codigo del CMS desde GitHub.
 *
 * En criollo:
 *  - Pregunta a GitHub cual es el ultimo cambio de la rama configurada.
 *  - Si es distinto al que tenemos, baja el .zip del repo y reemplaza
 *    SOLO los archivos de codigo de la carpeta cms/.
 *  - NUNCA toca: config.php, config.local.php, data/ (contenidos, usuarios,
 *    moldes) ni uploads/ (fotos).
 *  - Antes de pisar, guarda una copia del codigo viejo en
 *    data/backups/codigo-<fecha>/ por si hay que volver atras.
 *
 * Configuracion (cms/config.php):
 *   update_repo   => 'usuario/repositorio'   (ej. 'juanlanzos/cms')
 *   update_branch => 'main'
 *   update_token  => ''  (solo si el repo es privado: un token de GitHub
 *                         de SOLO LECTURA. Se escribe en el servidor, nunca
 *                         se manda por chat.)
 */

if (!function_exists('cms_config')) require __DIR__ . '/lib.php';

/** Archivos y carpetas de cms/ que la actualizacion nunca toca. */
const CMS_UPDATE_KEEP = ['config.php', 'config.local.php', 'data', 'uploads'];

function cms_update_conf(): array
{
    $c = cms_config();
    $repo = trim((string) ($c['update_repo'] ?? ''));
    if (!preg_match('~^[A-Za-z0-9_.\-]+/[A-Za-z0-9_.\-]+$~', $repo)) {
        throw new RuntimeException('Falta configurar el repositorio (update_repo en config.php)');
    }
    return [
        'repo'   => $repo,
        'branch' => trim((string) ($c['update_branch'] ?? '')) ?: 'main',
        'token'  => trim((string) ($c['update_token'] ?? '')),
    ];
}

/** GET simple a GitHub. Devuelve [codigo_http, cuerpo]. */
function cms_http_get(string $url, string $token = '', ?string $saveTo = null): array
{
    $headers = ['User-Agent: cms-html-updater', 'Accept: application/vnd.github+json'];
    if ($token !== '') $headers[] = 'Authorization: Bearer ' . $token;

    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        $fh = $saveTo ? fopen($saveTo, 'wb') : null;
        curl_setopt_array($ch, [
            CURLOPT_HTTPHEADER     => $headers,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_MAXREDIRS      => 5,
            CURLOPT_CONNECTTIMEOUT => 15,
            CURLOPT_TIMEOUT        => 120,
        ]);
        if ($fh) curl_setopt($ch, CURLOPT_FILE, $fh);
        else curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        $body = curl_exec($ch);
        $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $err  = curl_error($ch);
        curl_close($ch);
        if ($fh) fclose($fh);
        if ($body === false) throw new RuntimeException('No se pudo conectar con GitHub: ' . $err);
        return [$code, $fh ? '' : (string) $body];
    }

    $ctx = stream_context_create(['http' => ['header' => implode("\r\n", $headers), 'timeout' => 120, 'ignore_errors' => true]]);
    $body = @file_get_contents($url, false, $ctx);
    if ($body === false) throw new RuntimeException('No se pudo conectar con GitHub');
    $code = 0;
    foreach ($http_response_header ?? [] as $h) if (preg_match('~^HTTP/\S+\s+(\d+)~', $h, $m)) $code = (int) $m[1];
    if ($saveTo) { file_put_contents($saveTo, $body); $body = ''; }
    return [$code, (string) $body];
}

function cms_github_error(int $code): string
{
    if ($code === 401) return 'GitHub rechazó el token (vencido o mal copiado)';
    if ($code === 403) return 'GitHub no dejó entrar (token sin permiso o demasiadas consultas; probá en un rato)';
    if ($code === 404) return 'GitHub no encuentra el repositorio o la rama. Si el repo es privado, falta el token';
    return 'GitHub respondió con error ' . $code;
}

/** La version instalada (se guarda al instalar o actualizar). */
function cms_version(): array
{
    return cms_read_json(cms_data() . '/version.json', ['sha' => '', 'date' => '', 'message' => '']);
}

/** Pregunta a GitHub cual es la ultima version. */
function cms_update_check(): array
{
    $c = cms_update_conf();
    [$code, $body] = cms_http_get('https://api.github.com/repos/' . $c['repo'] . '/commits/' . rawurlencode($c['branch']), $c['token']);
    if ($code !== 200) throw new RuntimeException(cms_github_error($code));
    $j = json_decode($body, true);
    if (!is_array($j) || empty($j['sha'])) throw new RuntimeException('GitHub devolvió algo que no se entiende');
    $latest = [
        'sha'     => (string) $j['sha'],
        'date'    => (string) ($j['commit']['committer']['date'] ?? ''),
        'message' => strtok((string) ($j['commit']['message'] ?? ''), "\n") ?: '',
    ];
    $cur = cms_version();
    return [
        'repo'      => $c['repo'],
        'branch'    => $c['branch'],
        'current'   => $cur,
        'latest'    => $latest,
        'available' => $cur['sha'] !== $latest['sha'],
    ];
}

/** ¿Esta ruta (relativa a cms/) es algo que nunca hay que tocar? */
function cms_update_protected(string $rel): bool
{
    $first = explode('/', $rel, 2)[0];
    return in_array($first, CMS_UPDATE_KEEP, true);
}

/**
 * Baja la version indicada (o la ultima) y reemplaza el codigo.
 * Devuelve la lista de archivos actualizados.
 */
function cms_update_apply(?string $sha = null): array
{
    if (!class_exists('ZipArchive')) throw new RuntimeException('Este hosting no tiene la extensión zip de PHP');
    $c = cms_update_conf();
    $latest = cms_update_check()['latest'];
    if ($sha === null || !preg_match('/^[0-9a-f]{40}$/', $sha) || $sha === $latest['sha']) {
        $sha  = $latest['sha'];
        $meta = $latest;
    } else {
        $meta = ['sha' => $sha, 'date' => '', 'message' => ''];
    }

    $tmpDir = cms_data('tmp');
    $zipFile = $tmpDir . '/update-' . substr($sha, 0, 12) . '.zip';
    [$code] = cms_http_get('https://api.github.com/repos/' . $c['repo'] . '/zipball/' . $sha, $c['token'], $zipFile);
    if ($code !== 200) { @unlink($zipFile); throw new RuntimeException(cms_github_error($code)); }

    $zip = new ZipArchive();
    if ($zip->open($zipFile) !== true) { @unlink($zipFile); throw new RuntimeException('El archivo bajado de GitHub está dañado'); }

    /* 1) juntar los archivos nuevos de cms/ (en memoria, todavia sin escribir) */
    $nuevos = [];
    for ($i = 0; $i < $zip->numFiles; $i++) {
        $name = (string) $zip->getNameIndex($i);
        if (str_ends_with($name, '/')) continue;
        $parts = explode('/', $name, 2);           // "usuario-repo-abc123/cms/lib.php"
        $inRepo = $parts[1] ?? '';
        if (!str_starts_with($inRepo, 'cms/')) continue;
        $rel = substr($inRepo, 4);
        if ($rel === '' || str_contains($rel, '..') || cms_update_protected($rel)) continue;
        $nuevos[$rel] = $zip->getFromIndex($i);
    }
    $zip->close();
    @unlink($zipFile);

    /* control minimo: que sea de verdad el CMS */
    foreach (['index.php', 'api.php', 'lib.php', 'updater.php'] as $must) {
        if (!isset($nuevos[$must]) || $nuevos[$must] === false || $nuevos[$must] === '') {
            throw new RuntimeException('La versión de GitHub no parece el CMS (falta ' . $must . '). No se cambió nada');
        }
    }

    /* 2) copia de seguridad del codigo actual */
    $bk = cms_data('backups') . '/codigo-' . date('Ymd-His');
    foreach (array_keys($nuevos) as $rel) {
        $src = __DIR__ . '/' . $rel;
        if (!is_file($src)) continue;
        $dst = $bk . '/' . $rel;
        if (!is_dir(dirname($dst))) mkdir(dirname($dst), 0755, true);
        copy($src, $dst);
    }
    cms_write_json($bk . '/version.json', cms_version());

    /* 3) escribir (cada archivo primero a un temporal y despues se renombra) */
    $cambiados = [];
    foreach ($nuevos as $rel => $data) {
        $dst = __DIR__ . '/' . $rel;
        if (is_file($dst) && hash_file('sha256', $dst) === hash('sha256', (string) $data)) continue;
        if (!is_dir(dirname($dst))) mkdir(dirname($dst), 0755, true);
        $tmp = $dst . '.nuevo-' . bin2hex(random_bytes(3));
        if (file_put_contents($tmp, $data) === false || !rename($tmp, $dst)) {
            @unlink($tmp);
            throw new RuntimeException('No se pudo escribir ' . $rel . ' (permisos). La copia del código viejo está en data/backups');
        }
        $cambiados[] = $rel;
    }
    if (function_exists('opcache_reset')) @opcache_reset();

    cms_write_json(cms_data() . '/version.json', $meta);
    return ['changed' => $cambiados, 'version' => $meta, 'backup' => basename($bk)];
}
