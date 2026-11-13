<?php
declare(strict_types=1);
/** Entrada al panel: crear el primer admin, iniciar sesion y el editor. */
require __DIR__ . '/lib.php';

cms_session();
$error  = '';
$hayUsuarios = (bool) cms_users();
$action = (string) ($_POST['action'] ?? '');

if ($action !== '' && !hash_equals(cms_csrf(), (string) ($_POST['csrf'] ?? ''))) {
    $error = 'La sesión venció, probá de nuevo.';
    $action = '';
}

if ($action === 'logout') {
    $_SESSION = [];
    session_destroy();
    header('Location: ./');
    exit;
}

if ($action === 'setup' && !$hayUsuarios) {
    $code = (string) cms_config()['setup_code'];
    $n = strtolower(trim((string) ($_POST['username'] ?? '')));
    $p = (string) ($_POST['password'] ?? '');
    if ($code === '' || !hash_equals($code, (string) ($_POST['code'] ?? ''))) $error = 'La clave de instalación no coincide con la de cms/config.php.';
    elseif (!preg_match('/^[a-z0-9._\-]{3,30}$/', $n)) $error = 'Usuario: de 3 a 30 letras o números.';
    elseif (strlen($p) < 8) $error = 'La contraseña tiene que tener 8 caracteres o más.';
    else {
        cms_save_users([$n => ['hash' => password_hash($p, PASSWORD_DEFAULT), 'role' => 'super']]);
        cms_login($n, $p);
        cms_scan(); /* primer escaneo automatico */
        header('Location: ./');
        exit;
    }
}

if ($action === 'login') {
    if (cms_login(strtolower(trim((string) ($_POST['username'] ?? ''))), (string) ($_POST['password'] ?? ''))) {
        header('Location: ./');
        exit;
    }
    $error = 'Usuario o contraseña incorrectos.';
}

$user = cms_user();
$csrf = cms_csrf();
$e = fn($s) => htmlspecialchars((string) $s, ENT_QUOTES, 'UTF-8');
?><!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>CMS · <?= $e(cms_config()['site_name']) ?></title>
<link rel="stylesheet" href="assets/admin.css?v=1">
</head>
<body>
<?php if (!$user): ?>
  <div class="login-wrap">
    <form class="login" method="post" autocomplete="on">
      <input type="hidden" name="csrf" value="<?= $e($csrf) ?>">
      <h1><?= $e(cms_config()['site_name']) ?></h1>
      <?php if (!$hayUsuarios): ?>
        <p class="sub">Primera vez: creá el <b>admin principal</b>.</p>
        <?php if (cms_config()['setup_code'] === ''): ?>
          <p class="error">Para empezar, abrí <code>cms/config.php</code> y escribí una clave en <code>setup_code</code>. Después recargá esta página.</p>
        <?php else: ?>
          <?php if ($error): ?><p class="error"><?= $e($error) ?></p><?php endif; ?>
          <input type="hidden" name="action" value="setup">
          <label>Clave de instalación (la de config.php)</label>
          <input type="password" name="code" required>
          <label>Tu usuario</label>
          <input type="text" name="username" required autocomplete="username">
          <label>Tu contraseña (8 o más)</label>
          <input type="password" name="password" required minlength="8" autocomplete="new-password">
          <button class="btn primary" type="submit">Crear y entrar</button>
        <?php endif; ?>
      <?php else: ?>
        <p class="sub">Panel de contenidos</p>
        <?php if ($error): ?><p class="error"><?= $e($error) ?></p><?php endif; ?>
        <input type="hidden" name="action" value="login">
        <label>Usuario</label>
        <input type="text" name="username" required autofocus autocomplete="username">
        <label>Contraseña</label>
        <input type="password" name="password" required autocomplete="current-password">
        <button class="btn primary" type="submit">Entrar</button>
      <?php endif; ?>
    </form>
  </div>
<?php else: ?>
  <div id="app" data-csrf="<?= $e($csrf) ?>">
    <header class="top">
      <span class="brand"><?= $e(cms_config()['site_name']) ?></span>
      <select id="pageSel" aria-label="Página"></select>
      <?php if ($user['role'] === 'super'): ?>
        <button class="btn" id="btnScan" title="Busca todos los .html del sitio">Escanear sitio</button>
        <div class="seg" id="modeSeg" title="Qué estás haciendo">
          <button data-mode="super" class="on">Definir qué se edita</button>
          <button data-mode="editor">Editar contenido</button>
        </div>
        <button class="btn" id="btnUsers">Usuarios</button>
      <?php endif; ?>
      <span class="spacer"></span>
      <a class="btn" id="btnView" target="_blank" rel="noopener">Ver sitio ↗</a>
      <span class="who"><?= $e($user['username']) ?> · <?= $e(CMS_ROLES[$user['role']]) ?></span>
      <form method="post"><input type="hidden" name="csrf" value="<?= $e($csrf) ?>"><button class="btn" name="action" value="logout">Salir</button></form>
    </header>
    <main class="work">
      <div class="stage"><iframe id="frame" title="Página"></iframe></div>
      <aside class="side" id="side"></aside>
    </main>
    <div class="toast" id="toast"></div>
  </div>
  <script src="assets/admin.js?v=1"></script>
<?php endif; ?>
</body>
</html>
