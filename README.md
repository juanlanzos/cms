# CMS para HTML plano (versión 0.1)

Un panel tipo "Elementor simple" para cualquier sitio hecho en HTML, **sin WordPress y sin base de datos**.

## La idea en 4 pasos

1. **Copiás la carpeta `cms/`** al lado de los `.html` del cliente (en el servidor).
2. **Escanear**: el sistema encuentra todas las páginas `.html` y guarda una copia intacta de cada una (el "molde").
3. **Admin principal** (vos): hacés clic en cualquier parte de la página (un título, una foto, un botón, una sección) y decidís:
   - si se puede editar o no,
   - con qué nombre la ve el cliente ("Título principal"),
   - **qué** se puede cambiar: texto, link, imagen, color, tamaño de letra, filtro de la foto, ancho/alto, bordes redondeados, espacio por dentro (padding), espacio por fuera (margin), mostrar/ocultar…
4. **Admin de contenidos** (el cliente): ve la página con las partes habilitadas marcadas en verde, hace clic, cambia lo permitido y toca **Guardar y publicar**.

Al publicar, el sistema arma el HTML final (molde + cambios) y lo escribe encima del `.html` real. Antes guarda una copia de seguridad.

## Cómo instalarlo en un cliente (forma fácil)

1. Entrá al panel de cualquier sitio que ya tenga el CMS (por ejemplo cms.habi.ar), andá a **Usuarios** y tocá **⬇ Descargar instalador**. Baja un solo archivo: `instalar.php`.
   (También se puede armar desde la terminal: `php cms/installer/build.php > instalar.php`.)
2. Subí `instalar.php` a la carpeta donde está el `index.html` del cliente (FTP o administrador de archivos del hosting).
3. Abrí `https://sitio-del-cliente.com/instalar.php`, poné el nombre del sitio, tu usuario y tu contraseña, y tocá **Instalar**.
4. Listo: se crea la carpeta `cms/`, tu usuario de admin principal, se escanean las páginas y el instalador se borra solo. Desde **Usuarios** creás el usuario del cliente como "Admin de contenidos".

Requisitos: hosting con PHP 8. Con Apache la carpeta `cms/data` queda protegida sola (`.htaccess`). Con Nginx el instalador avisa si hay que agregar el bloqueo a mano.

La forma manual (copiar la carpeta `cms/` y poner una clave en `setup_code` de `cms/config.php`) sigue funcionando.

## Actualizar el código (botón ⟳ Actualizar)

El admin principal tiene un botón **⟳ Actualizar** arriba. Busca en GitHub la última versión del CMS y, si hay una nueva, la instala:

- Reemplaza **solo el código** de `cms/`. **Nunca toca** los contenidos, usuarios, moldes (`cms/data/`), las fotos (`cms/uploads/`) ni `cms/config.php`.
- Antes guarda una copia del código viejo en `cms/data/backups/codigo-<fecha>/`.
- De dónde baja se configura en `cms/config.php`: `update_repo` (ej. `juanlanzos/cms`) y `update_branch` (normalmente `main`).
- Si el repositorio es **privado**, hace falta `update_token`: un token de GitHub de **solo lectura** para ese repo. Se escribe en el `config.php` del servidor, nunca se manda por chat.

## Dónde queda cada cosa

| Carpeta / archivo | Qué guarda |
|---|---|
| `cms/data/originals/` | El molde de cada página (nunca se toca) |
| `cms/data/schema/` | Qué partes y qué propiedades habilitó el admin principal |
| `cms/data/content/` | Los valores que cargó el admin de contenidos |
| `cms/data/backups/` | Las últimas 20 versiones publicadas de cada página |
| `cms/data/users.json` | Usuarios (contraseñas cifradas) |
| `cms/uploads/` | Fotos subidas desde el panel |

## Si el cliente cambia su HTML

Subís el `.html` nuevo y tocás **Escanear sitio**: el sistema detecta que el archivo cambió y lo toma como molde nuevo.
Ojo: si la estructura de la página cambió mucho, conviene revisar las partes habilitadas, porque cada parte se ubica por su posición en la página.

## Carpeta de ejemplo

`index.html`, `nosotros.html`, `css/` e `img/` son un sitio de prueba ("Café La Esquina") para ver el sistema andando. En `docs/capturas/` hay fotos de cómo se ve.

## Novedades v0.2

- **Listas de bloques**: el admin principal marca un contenedor (por ejemplo, la grilla de tarjetas) como "Lista de bloques". El admin de contenidos puede **duplicar, borrar y ordenar** las tarjetas. Lo que el principal habilita dentro de una tarjeta (el título, la foto) se aplica igual a todas.
- **Celular y compu**: arriba hay un botón 🖥 Compu / 📱 Celular. En modo celular, los colores, tamaños, espacios y "mostrar/ocultar" que se cambien valen solo para celular (pantallas de hasta 767px). Los textos y fotos son los mismos en los dos.
- **Vista previa real**: los cambios se ven tal cual van a quedar antes de tocar "Guardar y publicar".

## Lo que todavía no hace (próximos pasos)

- Agregar bloques nuevos desde una biblioteca (por ahora se duplica uno que ya existe).
- Volver a una versión anterior desde el panel (las copias ya se guardan).
- Editar textos con negritas/links adentro (hoy el texto se reemplaza como texto simple).
- Tipografías, sombras, bordes y animaciones.
