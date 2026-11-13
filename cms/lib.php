<?php
declare(strict_types=1);
/**
 * CMS HTML - nucleo.
 *
 * Idea general (en criollo):
 *  - La carpeta "cms/" se copia al lado de los .html de un cliente.
 *  - "Escanear" busca todos los .html y guarda una copia intacta de cada uno
 *    (data/originals). Esa copia NUNCA se toca: es el molde.
 *  - El admin principal marca que partes del molde se pueden editar y que
 *    propiedades de cada parte (texto, color, tamaño, filtro, padding...).
 *    Eso se guarda en data/schema/<pagina>.json
 *  - El admin de contenidos cambia los valores. Se guardan en
 *    data/content/<pagina>.json
 *  - "Publicar" arma el HTML final = molde + valores y lo escribe encima del
 *    .html del sitio (antes deja una copia en data/backups por las dudas).
 *
 * No hay base de datos: todo son archivos JSON. Funciona en cualquier hosting
 * con PHP 8.
 */

/* ───────────────────────── rutas y archivos ───────────────────────── */

function cms_site_dir(): string { return dirname(__DIR__); }

function cms_data(string $sub = ''): string
{
    $d = __DIR__ . '/data' . ($sub !== '' ? '/' . $sub : '');
    if (!is_dir($d)) mkdir($d, 0755, true);
    return $d;
}

function cms_config(): array
{
    static $c = null;
    if ($c === null) {
        $f = __DIR__ . '/config.php';
        $c = is_file($f) ? (array) require $f : [];
        $c += ['setup_code' => '', 'site_name' => 'Mi sitio',
            'update_repo' => 'juanlanzos/cms', 'update_branch' => 'main', 'update_token' => ''];
    }
    return $c;
}

/** URL donde viven los .html del sitio (la carpeta de arriba de cms/). */
function cms_site_url(): string
{
    $s = str_replace('\\', '/', dirname((string) ($_SERVER['SCRIPT_NAME'] ?? '/cms/index.php')));
    return rtrim(str_replace('\\', '/', dirname($s)), '/') . '/';
}

function cms_read_json(string $file, $default = [])
{
    if (!is_file($file)) return $default;
    $d = json_decode((string) file_get_contents($file), true);
    return is_array($d) ? $d : $default;
}

function cms_write_json(string $file, $data): void
{
    $dir = dirname($file);
    if (!is_dir($dir)) mkdir($dir, 0755, true);
    file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE), LOCK_EX);
}

/** "blog/nota.html" -> "blog__nota.html" para usarlo como nombre de archivo. */
function cms_fname(string $page): string { return str_replace('/', '__', $page); }

/* ───────────────────────── usuarios y sesion ───────────────────────── */

const CMS_ROLES = ['super' => 'Admin principal', 'editor' => 'Admin de contenidos'];

function cms_users(): array { return cms_read_json(cms_data() . '/users.json', []); }
function cms_save_users(array $u): void { cms_write_json(cms_data() . '/users.json', $u); }

function cms_session(): void
{
    if (session_status() === PHP_SESSION_ACTIVE) return;
    session_name('cmshtml');
    session_set_cookie_params(['httponly' => true, 'samesite' => 'Lax',
        'secure' => !empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off']);
    session_start();
    if (empty($_SESSION['csrf'])) $_SESSION['csrf'] = bin2hex(random_bytes(16));
}

function cms_user(): ?array
{
    cms_session();
    $n = (string) ($_SESSION['user'] ?? '');
    if ($n === '') return null;
    $u = cms_users()[$n] ?? null;
    return $u ? ['username' => $n, 'role' => $u['role']] : null;
}

function cms_login(string $user, string $pass): bool
{
    cms_session();
    $u = cms_users()[$user] ?? null;
    if (!$u || !password_verify($pass, (string) $u['hash'])) { sleep(1); return false; }
    session_regenerate_id(true);
    $_SESSION['user'] = $user;
    return true;
}

function cms_csrf(): string { cms_session(); return (string) $_SESSION['csrf']; }

/* ───────────────────────── paginas (escaneo) ───────────────────────── */

/** Todos los .html del sitio, sin entrar a cms/ ni a carpetas ocultas. */
function cms_find_html(): array
{
    $base = cms_site_dir();
    $out  = [];
    $it = new RecursiveIteratorIterator(
        new RecursiveCallbackFilterIterator(
            new RecursiveDirectoryIterator($base, FilesystemIterator::SKIP_DOTS),
            function ($f) use ($base) {
                $rel = ltrim(str_replace('\\', '/', substr($f->getPathname(), strlen($base))), '/');
                if ($f->getFilename()[0] === '.') return false;
                if ($rel === 'cms' || str_starts_with($rel, 'cms/')) return false;
                return true;
            }
        )
    );
    $it->setMaxDepth(5);
    foreach ($it as $f) {
        if (!preg_match('/\.html?$/i', $f->getFilename())) continue;
        $out[] = ltrim(str_replace('\\', '/', substr($f->getPathname(), strlen($base))), '/');
    }
    sort($out);
    return $out;
}

function cms_pages(): array { return cms_read_json(cms_data() . '/pages.json', []); }

function cms_page_ok(string $page): bool { return $page !== '' && isset(cms_pages()[$page]); }

function cms_original_file(string $page): string { return cms_data('originals') . '/' . cms_fname($page); }

/**
 * Escanea el sitio. Para cada .html:
 *  - si es nuevo, guarda su molde;
 *  - si alguien subio una version nueva del archivo (no la que publicamos
 *    nosotros), la toma como molde nuevo.
 */
function cms_scan(): array
{
    $pages  = cms_pages();
    $report = ['nuevas' => [], 'actualizadas' => [], 'sin_cambios' => [], 'borradas' => []];
    $found  = cms_find_html();

    foreach ($found as $rel) {
        $live = cms_site_dir() . '/' . $rel;
        $html = (string) file_get_contents($live);
        $hash = sha1($html);
        $orig = cms_original_file($rel);

        if (!isset($pages[$rel]) || !is_file($orig)) {
            file_put_contents($orig, $html);
            $pages[$rel] = ['title' => cms_title($html, $rel), 'published' => $hash, 'scanned' => gmdate('c')];
            $report['nuevas'][] = $rel;
        } elseif ($hash !== ($pages[$rel]['published'] ?? '')) {
            file_put_contents($orig, $html);
            $pages[$rel]['title']     = cms_title($html, $rel);
            $pages[$rel]['published'] = $hash;
            $pages[$rel]['scanned']   = gmdate('c');
            $report['actualizadas'][] = $rel;
        } else {
            $report['sin_cambios'][] = $rel;
        }
        $pages[$rel]['count'] = cms_count_parts($rel);
    }
    foreach (array_keys($pages) as $rel) {
        if (!in_array($rel, $found, true)) { unset($pages[$rel]); $report['borradas'][] = $rel; }
    }
    ksort($pages);
    cms_write_json(cms_data() . '/pages.json', $pages);
    return $report;
}

function cms_title(string $html, string $rel): string
{
    if (preg_match('#<title[^>]*>(.*?)</title>#is', $html, $m)) {
        $t = trim(html_entity_decode(strip_tags($m[1]), ENT_QUOTES, 'UTF-8'));
        if ($t !== '') return mb_substr($t, 0, 80);
    }
    return $rel;
}

/** Cuantas partes con contenido (textos + imagenes) tiene la pagina. */
function cms_count_parts(string $page): int
{
    $n = 0;
    $dom = cms_load($page);
    if (!$dom) return 0;
    cms_walk($dom['body'], '', function (DOMElement $el) use (&$n) {
        $t = cms_type($el);
        if ($t === 'texto' || $t === 'imagen' || $t === 'enlace') $n++;
    });
    return $n;
}

/* ───────────────────────── catalogo de propiedades ─────────────────────────
   Todo lo que se puede llegar a editar de un elemento. El admin principal
   elige cuales de estas habilita para cada parte. */

function cms_catalog(): array
{
    $filtros = [
        ''                                   => 'Sin filtro',
        'grayscale(100%)'                    => 'Blanco y negro',
        'sepia(100%)'                        => 'Sepia',
        'blur(3px)'                          => 'Desenfocado',
        'brightness(130%)'                   => 'Más claro',
        'brightness(70%)'                    => 'Más oscuro',
        'contrast(140%)'                     => 'Más contraste',
        'saturate(180%)'                     => 'Colores fuertes',
        'grayscale(100%) brightness(80%)'    => 'B/N oscuro',
    ];
    return [
        'texto'        => ['label' => 'Texto',               'kind' => 'textarea'],
        'enlace'       => ['label' => 'Link (a dónde va)',   'kind' => 'text'],
        'imagen'       => ['label' => 'Imagen',              'kind' => 'image'],
        'alt'          => ['label' => 'Descripción de la imagen (SEO)', 'kind' => 'text'],
        'fondo_imagen' => ['label' => 'Imagen de fondo',     'kind' => 'image'],
        'color'        => ['label' => 'Color del texto',     'kind' => 'color'],
        'fondo'        => ['label' => 'Color de fondo',      'kind' => 'color'],
        'tamano_letra' => ['label' => 'Tamaño de letra',     'kind' => 'range', 'min' => 8, 'max' => 120, 'unit' => 'px'],
        'peso'         => ['label' => 'Grosor de letra',     'kind' => 'select', 'options' => ['' => 'Como está', '300' => 'Fina', '400' => 'Normal', '700' => 'Negrita', '900' => 'Extra negrita']],
        'alineacion'   => ['label' => 'Alineación',          'kind' => 'select', 'options' => ['' => 'Como está', 'left' => 'Izquierda', 'center' => 'Centro', 'right' => 'Derecha', 'justify' => 'Justificado']],
        'ancho'        => ['label' => 'Ancho',               'kind' => 'size'],
        'alto'         => ['label' => 'Alto',                'kind' => 'size'],
        'filtro'       => ['label' => 'Filtro',              'kind' => 'select', 'options' => $filtros],
        'opacidad'     => ['label' => 'Opacidad',            'kind' => 'range', 'min' => 0, 'max' => 100, 'unit' => '%'],
        'redondeo'     => ['label' => 'Bordes redondeados',  'kind' => 'range', 'min' => 0, 'max' => 100, 'unit' => 'px'],
        'margen'       => ['label' => 'Espacio por fuera (margin)',  'kind' => 'box'],
        'relleno'      => ['label' => 'Espacio por dentro (padding)', 'kind' => 'box'],
        'visible'      => ['label' => 'Mostrar en la página', 'kind' => 'toggle'],
        'lista'        => ['label' => 'Lista de bloques (agregar, borrar y ordenar lo de adentro)', 'kind' => 'list'],
    ];
}

/** Propiedades de estilo: son las unicas que pueden ser distintas en celular. */
const CMS_STYLE_PROPS = ['color', 'fondo', 'fondo_imagen', 'tamano_letra', 'peso', 'alineacion', 'ancho', 'alto',
                         'filtro', 'opacidad', 'redondeo', 'margen', 'relleno', 'visible'];

/** Ancho a partir del cual se considera "celular". */
const CMS_MOBILE_MAX = 767;

/** Que propiedades tienen sentido para cada tipo de parte. */
function cms_props_for(string $type): array
{
    return [
        'texto'  => ['texto', 'color', 'tamano_letra', 'peso', 'alineacion', 'fondo', 'margen', 'relleno', 'visible'],
        'enlace' => ['texto', 'enlace', 'color', 'fondo', 'tamano_letra', 'peso', 'redondeo', 'relleno', 'margen', 'visible'],
        'imagen' => ['imagen', 'alt', 'ancho', 'alto', 'filtro', 'redondeo', 'opacidad', 'margen', 'relleno', 'visible'],
        'bloque' => ['lista', 'fondo', 'fondo_imagen', 'relleno', 'margen', 'alineacion', 'redondeo', 'opacidad', 'visible'],
    ][$type] ?? [];
}

/** Las que vienen tildadas por defecto cuando se habilita una parte. */
function cms_default_props(string $type): array
{
    return [
        'texto'  => ['texto'],
        'enlace' => ['texto', 'enlace'],
        'imagen' => ['imagen', 'alt'],
        'bloque' => ['fondo', 'relleno'],
    ][$type] ?? [];
}

/* ───────────────────────── saneado de valores ───────────────────────── */

/** Limpia un valor segun su tipo. Devuelve null si no sirve. */
function cms_clean_value(string $prop, $v)
{
    $cat = cms_catalog()[$prop] ?? null;
    if (!$cat) return null;
    switch ($cat['kind']) {
        case 'textarea':
            return mb_substr(str_replace("\r", '', (string) $v), 0, 5000);
        case 'text':
            $v = trim(mb_substr((string) $v, 0, 500));
            if ($prop === 'enlace' && $v !== '' && !cms_url_ok($v)) return null;
            return $v;
        case 'image':
            $v = trim((string) $v);
            return ($v === '' || cms_url_ok($v)) ? $v : null;
        case 'color':
            $v = trim((string) $v);
            return ($v === '' || preg_match('/^#[0-9a-f]{3,8}$/i', $v)) ? $v : null;
        case 'range':
            if ($v === '' || $v === null) return '';
            return max($cat['min'], min($cat['max'], (float) $v));
        case 'select':
            $v = (string) $v;
            return array_key_exists($v, $cat['options']) ? $v : null;
        case 'size':
            $v = trim((string) $v);
            return ($v === '' || $v === 'auto' || preg_match('/^\d{1,4}(\.\d+)?(px|%|vw|vh|rem|em)$/', $v)) ? $v : null;
        case 'box':
            if (!is_array($v)) return null;
            $o = [];
            foreach (['t', 'r', 'b', 'l'] as $s) {
                $x = $v[$s] ?? '';
                $o[$s] = ($x === '' || $x === null) ? '' : max(-500, min(500, (int) $x));
            }
            return $o;
        case 'toggle':
            return (bool) $v;
        case 'list':
            return null;
    }
    return null;
}

/** Links: anclas, rutas del sitio, http(s), mailto y tel. Nada de javascript:. */
function cms_url_ok(string $u): bool
{
    $u = trim($u);
    if ($u === '') return true;
    if (preg_match('/^\s*(javascript|data|vbscript):/i', $u)) return false;
    return (bool) preg_match('#^(https?://|mailto:|tel:|/|\#|\./|\.\./|[a-z0-9_\-][^:]*$)#i', $u);
}

/* ───────────────────────── HTML: leer y recorrer ───────────────────────── */

/** Etiquetas que nunca se tocan. */
function cms_blind(): array
{
    return ['script' => 1, 'style' => 1, 'noscript' => 1, 'template' => 1, 'iframe' => 1,
            'head' => 1, 'title' => 1, 'meta' => 1, 'link' => 1, 'br' => 1, 'hr' => 1,
            'source' => 1, 'track' => 1, 'input' => 1, 'select' => 1, 'option' => 1, 'textarea' => 1];
}

/**
 * Carga el molde de una pagina en un DOM.
 * Los <svg> se sacan antes (el parser les rompe el viewBox) y vuelven al final.
 */
function cms_load(string $page): ?array
{
    $f = cms_original_file($page);
    if (!is_file($f)) return null;
    $html = (string) file_get_contents($f);

    $svgs = [];
    $html = (string) preg_replace_callback('#<svg\b.*?</svg>#is', function ($m) use (&$svgs) {
        $svgs[] = $m[0];
        return '<!--cms-svg-' . (count($svgs) - 1) . '-->';
    }, $html);

    $doc  = new DOMDocument();
    $prev = libxml_use_internal_errors(true);
    $doc->loadHTML('<?xml encoding="UTF-8">' . $html, LIBXML_NOERROR | LIBXML_NOWARNING | LIBXML_HTML_NODEFDTD);
    libxml_clear_errors();
    libxml_use_internal_errors($prev);
    foreach (iterator_to_array($doc->childNodes) as $n) {
        if ($n->nodeType === XML_PI_NODE) $doc->removeChild($n);
    }
    $body = $doc->getElementsByTagName('body')->item(0);
    if (!$body) return null;
    $head = $doc->getElementsByTagName('head')->item(0);
    $doctype = preg_match('/^\s*<!doctype[^>]*>/i', (string) file_get_contents($f), $m) ? $m[0] : '<!DOCTYPE html>';
    return ['doc' => $doc, 'body' => $body, 'head' => $head, 'svgs' => $svgs, 'doctype' => $doctype];
}

function cms_save_dom(array $dom): string
{
    $doc = $dom['doc'];
    $out = '';
    foreach ($doc->childNodes as $n) {
        if ($n->nodeType === XML_DOCUMENT_TYPE_NODE) continue;
        $out .= $doc->saveHTML($n);
    }
    $out = (string) preg_replace_callback('#<!--cms-svg-(\d+)-->#', fn($m) => $dom['svgs'][(int) $m[1]] ?? '', $out);
    return $dom['doctype'] . "\n" . $out;
}

/**
 * Recorre los elementos del body y les da una "direccion" por posicion:
 * "2.0.3" = hijo 3 del hijo 0 del hijo 2 del body. Como el molde no cambia,
 * la direccion de cada parte tampoco.
 */
function cms_walk(DOMNode $parent, string $path, callable $fn): void
{
    $i = 0;
    foreach (iterator_to_array($parent->childNodes) as $n) {
        if (!($n instanceof DOMElement)) continue;
        $k = $path === '' ? (string) $i : $path . '.' . $i;
        $i++;
        if (isset(cms_blind()[strtolower($n->tagName)])) continue;
        $fn($n, $k);
        cms_walk($n, $k, $fn);
    }
}

/** Que tipo de parte es: texto, imagen, enlace o bloque. */
function cms_type(DOMElement $el): string
{
    $tag = strtolower($el->tagName);
    if ($tag === 'img' || $tag === 'picture') return 'imagen';
    if ($tag === 'a' || $tag === 'button') return 'enlace';
    foreach ($el->childNodes as $c) {
        if ($c->nodeType === XML_TEXT_NODE && trim((string) $c->nodeValue) !== '') return 'texto';
    }
    return 'bloque';
}

/* ───────────────────────── armado de la pagina ───────────────────────── */

function cms_schema(string $page): array  { return cms_read_json(cms_data('schema') . '/' . cms_fname($page) . '.json', []); }
function cms_content(string $page): array { return cms_read_json(cms_data('content') . '/' . cms_fname($page) . '.json', []); }

/**
 * Direccion "de molde" de una parte. Las copias de un bloque se llaman como el
 * original mas "@id": "2.0.1@k3f" es la parte 2.0.1 dentro de la copia k3f.
 * La configuracion del admin principal es una sola para el original y sus copias.
 */
function cms_base_key(string $k): string { return (string) preg_replace('/@.*$/', '', $k); }

const CMS_KEY_RE = '/^\d+(\.\d+)*(@[a-z0-9]{1,12})?$/';

/** Los hijos "de verdad" de un elemento, con el mismo numero que les da cms_walk. */
function cms_children(DOMElement $el): array
{
    $out = [];
    $i = 0;
    foreach ($el->childNodes as $n) {
        if (!($n instanceof DOMElement)) continue;
        if (!isset(cms_blind()[strtolower($n->tagName)])) $out[$i] = $n;
        $i++;
    }
    return $out;
}

/** Elementos de la lista tal como vienen en el molde: uno por hijo. */
function cms_list_defaults(string $page, array $schema): array
{
    $out = [];
    $lists = array_keys(array_filter($schema, fn($s) => in_array('lista', (array) ($s['props'] ?? []), true)));
    if (!$lists) return $out;
    $dom = cms_load($page);
    if (!$dom) return $out;
    cms_walk($dom['body'], '', function (DOMElement $el, string $k) use (&$out, $lists) {
        if (!in_array($k, $lists, true)) return;
        $out[$k] = [];
        foreach (array_keys(cms_children($el)) as $i) $out[$k][] = ['src' => $i, 'id' => ''];
    });
    return $out;
}

/**
 * Limpia todo lo que manda el panel antes de guardarlo o de mostrarlo.
 * Devuelve [contenido limpio, error o ''].
 */
function cms_clean_content(array $raw, array $schema): array
{
    $cat = cms_catalog();
    $out = [];
    foreach ($raw as $k => $vals) {
        $k = (string) $k;
        if (!preg_match(CMS_KEY_RE, $k) || !is_array($vals)) continue;
        $s = $schema[cms_base_key($k)] ?? null;
        if (!$s) continue;
        $props = (array) $s['props'];
        foreach ($vals as $prop => $v) {
            $prop = (string) $prop;
            if ($prop === '@m') {
                if (!is_array($v)) continue;
                foreach ($v as $mp => $mv) {
                    if (!in_array($mp, $props, true) || !in_array($mp, CMS_STYLE_PROPS, true)) continue;
                    $c = cms_clean_value((string) $mp, $mv);
                    if ($c === null) return [[], 'Valor no válido en "' . $cat[$mp]['label'] . '" (celular)'];
                    $out[$k]['@m'][$mp] = $c;
                }
                continue;
            }
            if ($prop === '_items') {
                if (!in_array('lista', $props, true) || str_contains($k, '@') || !is_array($v)) continue;
                $items = [];
                $vistos = [];
                foreach (array_slice($v, 0, 200) as $it) {
                    if (!is_array($it)) continue;
                    $src = (int) ($it['src'] ?? -1);
                    $id  = (string) ($it['id'] ?? '');
                    if ($src < 0 || $src > 5000) continue;
                    if ($id !== '' && !preg_match('/^[a-z0-9]{1,12}$/', $id)) continue;
                    $marca = $id === '' ? 'o' . $src : $id;
                    if (isset($vistos[$marca])) continue;
                    $vistos[$marca] = 1;
                    $items[] = ['src' => $src, 'id' => $id];
                }
                $out[$k]['_items'] = $items;
                continue;
            }
            if (!in_array($prop, $props, true) || $prop === 'lista') continue;
            $c = cms_clean_value($prop, $v);
            if ($c === null) return [[], 'Valor no válido en "' . ($cat[$prop]['label'] ?? $prop) . '"'];
            $out[$k][$prop] = $c;
        }
    }
    return [$out, ''];
}

/**
 * Arma el HTML de una pagina.
 *   $mode = 'live'   -> lo que ve el publico
 *           'super'  -> vista del admin principal (todo se puede marcar)
 *           'editor' -> vista del admin de contenidos (solo lo habilitado)
 * $content permite mostrar cambios todavia sin guardar (vista previa).
 */
function cms_render(string $page, string $mode = 'live', ?array $content = null): string
{
    $dom = cms_load($page);
    if (!$dom) return '';
    $schema  = cms_schema($page);
    $content = $content ?? cms_content($page);
    $doc     = $dom['doc'];
    $xp      = new DOMXPath($doc);

    /* 1. cada elemento recibe su direccion de molde */
    cms_walk($dom['body'], '', fn(DOMElement $el, string $k) => $el->setAttribute('data-cms-p', $k));

    /* 2. listas: se reordenan, duplican o borran los bloques de adentro */
    foreach ($schema as $k => $s) {
        if (!in_array('lista', (array) $s['props'], true)) continue;
        $el = $xp->query('//*[@data-cms-p="' . $k . '"]')->item(0);
        if (!($el instanceof DOMElement)) continue;
        $items = $content[$k]['_items'] ?? null;
        cms_apply_list($el, (string) $k, is_array($items) ? $items : null, $mode !== 'live');
    }

    /* 3. valores de cada parte */
    $css = ['d' => [], 'm' => []];
    foreach (iterator_to_array($xp->query('//*[@data-cms-p]')) as $el) {
        /** @var DOMElement $el */
        $k = $el->getAttribute('data-cms-p');
        $el->removeAttribute('data-cms-p');
        $s = $schema[cms_base_key($k)] ?? null;
        $v = $s ? ($content[$k] ?? []) : [];
        $props = $s ? array_flip((array) $s['props']) : [];
        $dv = array_intersect_key($v, $props);
        $mv = is_array($v['@m'] ?? null) ? array_intersect_key($v['@m'], $props) : [];

        if ($dv) cms_apply_dom($el, $dv, $doc);
        $dcss = cms_css($dv);
        $mcss = cms_css($mv, isset($dv['visible']) && $dv['visible'] === false);
        $sel = '[data-cms-k="' . $k . '"]';
        if ($dcss !== '') $css['d'][] = $sel . '{' . $dcss . '}';
        if ($mcss !== '') $css['m'][] = $sel . '{' . $mcss . '}';

        $marcar = $mode === 'super' || ($mode === 'editor' && $s) || $dcss !== '' || $mcss !== '';
        if ($marcar) $el->setAttribute('data-cms-k', $k);
        if ($mode === 'super') {
            $el->setAttribute('data-cms-t', cms_type($el));
            if ($s) $el->setAttribute('data-cms-on', '1');
        } elseif ($mode === 'editor' && $s) {
            $el->setAttribute('data-cms-t', (string) ($s['type'] ?? cms_type($el)));
            $el->setAttribute('data-cms-on', '1');
        }
    }

    $hoja = implode("\n", $css['d']);
    if ($css['m']) $hoja .= "\n@media (max-width: " . CMS_MOBILE_MAX . "px) {\n" . implode("\n", $css['m']) . "\n}";
    if ($dom['head'] && ($hoja !== '' || $mode !== 'live')) {
        $st = $doc->createElement('style');
        $st->setAttribute('id', 'cms-css');
        $st->appendChild($doc->createTextNode("\n" . $hoja . "\n"));
        $dom['head']->appendChild($st);
    }

    if ($mode !== 'live') {
        /* la vista previa vive en /cms/preview.php: con <base> las rutas
           relativas del sitio (css/, img/) siguen funcionando */
        $dir  = trim(dirname($page), './');
        $base = cms_site_url() . ($dir !== '' ? $dir . '/' : '');
        if ($dom['head']) {
            $b = $doc->createElement('base');
            $b->setAttribute('href', $base);
            $dom['head']->insertBefore($b, $dom['head']->firstChild);
            $l = $doc->createElement('link');
            $l->setAttribute('rel', 'stylesheet');
            $l->setAttribute('href', cms_site_url() . 'cms/assets/frame.css?v=3');
            $dom['head']->appendChild($l);
        }
        $js = $doc->createElement('script');
        $js->setAttribute('src', cms_site_url() . 'cms/assets/frame.js?v=3');
        $js->setAttribute('data-mode', $mode);
        $dom['body']->appendChild($js);
    }
    return cms_save_dom($dom);
}

/** Reordena / duplica / borra los bloques de una lista. */
function cms_apply_list(DOMElement $list, string $k, ?array $items, bool $marcar): void
{
    $kids = cms_children($list);
    if ($items === null) {
        $items = [];
        foreach (array_keys($kids) as $i) $items[] = ['src' => $i, 'id' => ''];
    }
    $usados = [];
    $nuevos = [];
    foreach ($items as $it) {
        $src = (int) ($it['src'] ?? -1);
        $id  = (string) ($it['id'] ?? '');
        if (!isset($kids[$src])) continue;
        if ($id === '' && !isset($usados[$src])) {
            $usados[$src] = 1;
            $nodo = $kids[$src];
        } else {
            if ($id === '') continue;
            $nodo = $kids[$src]->cloneNode(true);
            /* la copia y todo lo de adentro llevan el sufijo de la copia */
            $todos = array_merge([$nodo], iterator_to_array($nodo->getElementsByTagName('*')));
            foreach ($todos as $e) {
                if ($e->hasAttribute('data-cms-p')) $e->setAttribute('data-cms-p', $e->getAttribute('data-cms-p') . '@' . $id);
                if ($e->hasAttribute('id')) $e->removeAttribute('id'); /* no repetir ids del HTML */
            }
        }
        $nuevos[] = $nodo;
    }
    /* sale todo lo que habia (sin tocar scripts ni comentarios) y entra la lista nueva */
    foreach ($kids as $n) if ($n->parentNode === $list) $list->removeChild($n);
    $ref = null;
    foreach ($list->childNodes as $n) { if ($n instanceof DOMElement) { $ref = $n; break; } }
    foreach ($nuevos as $pos => $n) {
        if ($marcar) {
            $n->setAttribute('data-cms-list', $k);
            $n->setAttribute('data-cms-item', (string) $pos);
        }
        $list->insertBefore($n, $ref);
        $list->insertBefore($list->ownerDocument->createTextNode("\n"), $ref);
    }
}

/** Cambios que no son de estilo: texto, link, imagen y descripcion. */
function cms_apply_dom(DOMElement $el, array $v, DOMDocument $doc): void
{
    $tag = strtolower($el->tagName);

    if (isset($v['texto']) && $v['texto'] !== '' && $tag !== 'img') {
        while ($el->firstChild) $el->removeChild($el->firstChild);
        foreach (explode("\n", (string) $v['texto']) as $i => $line) {
            if ($i > 0) $el->appendChild($doc->createElement('br'));
            $el->appendChild($doc->createTextNode($line));
        }
    }
    if (isset($v['enlace']) && $v['enlace'] !== '' && $tag === 'a') $el->setAttribute('href', (string) $v['enlace']);
    if (isset($v['imagen']) && $v['imagen'] !== '') {
        if ($tag === 'img') {
            $el->setAttribute('src', (string) $v['imagen']);
            $el->removeAttribute('srcset'); /* si no, el navegador sigue mostrando la vieja */
        } elseif ($tag === 'picture') {
            foreach ($el->getElementsByTagName('img') as $img) { $img->setAttribute('src', (string) $v['imagen']); $img->removeAttribute('srcset'); }
            foreach (iterator_to_array($el->getElementsByTagName('source')) as $s) $s->parentNode->removeChild($s);
        }
    }
    if (isset($v['alt']) && $v['alt'] !== '' && $tag === 'img') $el->setAttribute('alt', (string) $v['alt']);
}

/**
 * Traduce los valores de estilo a CSS. Va con !important para ganarle a la
 * hoja de estilos del sitio. $ocultoEnCompu: si en compu esta oculto y en
 * celular se pide mostrar, hay que "des-ocultarlo".
 */
function cms_css(array $v, bool $ocultoEnCompu = false): string
{
    $c = [];
    if (!empty($v['color']))        $c[] = 'color:' . $v['color'];
    if (!empty($v['fondo']))        $c[] = 'background-color:' . $v['fondo'];
    if (!empty($v['fondo_imagen'])) {
        $c[] = "background-image:url('" . str_replace(["'", '"', ')', '(', '\\', '<', '>'], '', (string) $v['fondo_imagen']) . "')";
        $c[] = 'background-size:cover';
        $c[] = 'background-position:center';
    }
    if (($v['tamano_letra'] ?? '') !== '') $c[] = 'font-size:' . (float) $v['tamano_letra'] . 'px';
    if (!empty($v['peso']))         $c[] = 'font-weight:' . $v['peso'];
    if (!empty($v['alineacion']))   $c[] = 'text-align:' . $v['alineacion'];
    if (!empty($v['ancho']))        $c[] = 'width:' . $v['ancho'];
    if (!empty($v['alto']))         { $c[] = 'height:' . $v['alto']; $c[] = 'object-fit:cover'; }
    if (!empty($v['filtro']))       $c[] = 'filter:' . $v['filtro'];
    if (($v['opacidad'] ?? '') !== '') $c[] = 'opacity:' . ((float) $v['opacidad'] / 100);
    if (($v['redondeo'] ?? '') !== '') $c[] = 'border-radius:' . (float) $v['redondeo'] . 'px';
    foreach (['margen' => 'margin', 'relleno' => 'padding'] as $p => $css) {
        if (!is_array($v[$p] ?? null)) continue;
        foreach (['t' => 'top', 'r' => 'right', 'b' => 'bottom', 'l' => 'left'] as $s => $side) {
            if (($v[$p][$s] ?? '') !== '') $c[] = $css . '-' . $side . ':' . (int) $v[$p][$s] . 'px';
        }
    }
    if (array_key_exists('visible', $v)) {
        if ($v['visible'] === false) $c[] = 'display:none';
        elseif ($ocultoEnCompu) $c[] = 'display:revert';
    }
    return $c ? implode(' !important;', $c) . ' !important' : '';
}

/* ───────────────────────── publicar ───────────────────────── */

/** Escribe el HTML final encima del archivo del sitio, con copia de seguridad. */
function cms_publish(string $page, string $who): void
{
    $html = cms_render($page, 'live');
    if ($html === '') return;
    $live = cms_site_dir() . '/' . $page;

    $bdir = cms_data('backups/' . cms_fname($page));
    if (is_file($live)) copy($live, $bdir . '/' . gmdate('Ymd-His') . '.html');
    $todas = (array) glob($bdir . '/*.html');
    sort($todas);
    while (count($todas) > 20) @unlink((string) array_shift($todas));

    file_put_contents($live, $html, LOCK_EX);

    $pages = cms_pages();
    if (isset($pages[$page])) {
        $pages[$page]['published']    = sha1($html);
        $pages[$page]['published_at'] = gmdate('c');
        $pages[$page]['published_by'] = $who;
        cms_write_json(cms_data() . '/pages.json', $pages);
    }
}
