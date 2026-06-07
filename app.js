const express = require('express');
const session = require('express-session'); 
const flash = require('connect-flash');
const path = require('path'); // Necesario para manejar extensiones de archivos
const multer = require('multer'); // Para subir los comprobantes
const { setup } = require('./database');
const app = express();

// ==========================================
// --- CONFIGURACIÓN DE MULTER (SUBIDA DE ARCHIVOS) ---
// ==========================================
// Multer para subida de comprobantes
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/comprobantes'); // Asegúrate de crear esta carpeta
    },
    filename: (req, file, cb) => {
        // Guarda el archivo con un nombre único: timestamp-nombreoriginal
        cb(null, Date.now() + path.extname(file.originalname));
    }
});
const upload = multer({ storage: storage });

// Multer para subida de fotos de productos
const storageProductos = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, 'public/uploads/productos'); // ⚠️ Recuerda crear esta carpeta
    },
    filename: (req, file, cb) => {
        // 1. Limpiamos el nombre original quitando espacios y caracteres especiales
        const nombreLimpio = path.parse(file.originalname).name
            .replace(/\s+/g, '-') 
            .replace(/[^a-zA-Z0-9_-]/g, '');

        // 2. Generamos un número aleatorio entre 0 y 9999
        const numeroAleatorio = Math.floor(Math.random() * 10000);

        // 3. Combinamos todo: prod- + nombre + timestamp + aleatorio + extensión
        // Esto soluciona definitivamente el problema de las imágenes duplicadas o sobrescritas
        cb(null, 'prod-' + nombreLimpio + '-' + Date.now() + '-' + numeroAleatorio + path.extname(file.originalname));
    }
});

// Usamos .array() en lugar de .single() para permitir hasta 5 fotos juntas
const uploadProducto = multer({ storage: storageProductos }).array('imagenes', 5);

// ==========================================
// --- CONFIGURACIÓN Y MIDDLEWARES ---
// ==========================================
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Hace que la carpeta de comprobantes sea accesible desde el navegador
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads/comprobantes')));

// Hace que la carpeta de fotos de productos sea accesible desde el navegador
app.use('/uploads/productos', express.static(path.join(__dirname, 'public/uploads/productos')));

app.use(session({
    secret: 'mi-clave-secreta', 
    resave: false,
    saveUninitialized: false
}));

app.use(flash());

// ==========================================
// --- MIDDLEWARE GLOBAL (UNIFICADO) ---
// ==========================================
app.use((req, res, next) => {
    // 1. Carrito: Asegura que exista y lo pasa a las vistas
    if (!req.session.carrito) {
        req.session.carrito = [];
    }
    res.locals.carrito = req.session.carrito;

    // 2. Usuario: Pasa los datos de sesión a las vistas
    res.locals.usuario = req.session.usuario || null;

    // 3. Mensajes: Extrae los mensajes flash UNA SOLA VEZ
    // Esto es lo que permite que aparezcan en rojo/verde
    res.locals.success_msg = req.flash('success_msg');
    res.locals.error_msg = req.flash('error_msg');

    next();
});

// Middleware de seguridad
function verificarSesion(req, res, next) {
    if (req.session.usuario && req.session.usuario.id) {
        return next();
    } else {
        res.redirect('/login');
    }
}

// --- CONEXIÓN A BASE DE DATOS ---
let db;
setup().then(database => {
    db = database;
    app.listen(3000, () => {
        console.log("Servidor corriendo en http://localhost:3000");
    });
});

// ==========================================
// 2. AUTENTICACIÓN (Sin cambios significativos)
// ==========================================
app.get('/', (req, res) => res.redirect('/catalogo'));
app.get('/registro', (req, res) => res.render('registro'));

app.post('/registro', async (req, res) => {
    const { nombre, email, password, rol, taller_nombre, bio } = req.body;

    try {
        // 1. VALIDACIÓN DE CONTRASEÑA (Mínimo 6 caracteres)
        if (!password || password.length < 6) {
            req.flash('error_msg', 'La contraseña debe tener al menos 6 caracteres.');
            // Usamos return para que no intente ejecutar el INSERT
            return res.redirect('/registro'); 
        }

        // 2. INSERTAR EN LA BASE DE DATOS
        await db.run(
            `INSERT INTO usuarios (nombre, email, password, rol, taller_nombre, bio) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [nombre, email, password, rol || 'cliente', taller_nombre || null, bio || null]
        );

        req.flash('success_msg', 'Registro exitoso. ¡Ya puedes iniciar sesión!');
        res.redirect('/login');

    } catch (error) {
        console.error("Error en registro:", error);
        // Es mejor redirigir al registro con un mensaje que enviar un texto plano con .send
        req.flash('error_msg', 'Hubo un problema con el registro. El correo podría ya estar en uso.');
        res.redirect('/registro');
    }
});

app.get('/login', (req, res) => res.render('login', { error: null }));

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const usuario = await db.get('SELECT * FROM usuarios WHERE email = ? AND password = ?', [email, password]);

    if (usuario) {
        req.session.usuario = usuario; 
        res.redirect('/perfil');
    } else {
        res.render('login', { error: 'Credenciales incorrectas' });
    }
});

app.get('/logout', (req, res) => {
    req.session.destroy(() => {
        res.clearCookie('connect.sid');
        res.redirect('/login');
    });
});

// ==========================================
// 3. PERFIL Y CATÁLOGO
// ==========================================
app.get('/perfil', verificarSesion, async (req, res) => {
    try {
        // Buscamos los datos actuales en la base de datos
        const usuario = await db.get("SELECT * FROM usuarios WHERE id = ?", [req.session.usuario.id]);
        
        // PASAMOS TODO EL OBJETO USUARIO A LA VISTA
        res.render('perfil', { 
            nombre: usuario.nombre, 
            rol: usuario.rol, 
            usuario: usuario  // <-- ESTO ES LO QUE TE FALTABA
        });
    } catch (error) {
        console.error(error);
        res.status(500).send("Error al cargar perfil");
    }
});

// --- RUTA PARA GUARDAR DATOS BANCARIOS DEL ARTESANO ---
app.post('/perfil/actualizar-datos-cobro', verificarSesion, async (req, res) => {
    // Seguridad: Si no es artesano, no procesamos nada
    if (req.session.usuario.rol !== 'artesano') {
        return res.status(403).send("No tienes permiso para realizar esta acción");
    }

    const { 
        banco_nombre, 
        cuenta_numero, 
        cuenta_tipo, 
        nombre_titular,
        titular_documento, 
        alias_pago 
    } = req.body;

    try {
        await db.run(`
            UPDATE usuarios SET 
                banco_nombre = ?, 
                cuenta_numero = ?, 
                cuenta_tipo = ?, 
                nombre_titular = ?,    -- [NUEVO] Agregado a la consulta
                titular_documento = ?, 
                alias_pago = ? 
            WHERE id = ?`, 
            [
                banco_nombre, 
                cuenta_numero, 
                cuenta_tipo, 
                nombre_titular,    // [NUEVO] Pasado como parámetro
                titular_documento, 
                alias_pago, 
                req.session.usuario.id
            ]
        );

        res.redirect('/perfil');
    } catch (error) {
        console.error("Error al actualizar datos bancarios:", error);
        res.status(500).send("Error interno al guardar los datos de cobro");
    }
});

// MODIFICADO: Quitamos 'verificarSesion' para que el catálogo sea público y cualquiera pueda ver los productos
app.get('/catalogo', async (req, res) => {
    try {
        const { buscar, categoria } = req.query;
        let query = `SELECT productos.*, usuarios.taller_nombre FROM productos JOIN usuarios ON productos.vendedor_id = usuarios.id WHERE 1=1`;
        let params = [];
        
        if (buscar) {
            query += ` AND (productos.nombre LIKE ? OR productos.descripcion LIKE ?)`;
            params.push(`%${buscar}%`, `%${buscar}%`);
        }
        if (categoria) {
            query += ` AND productos.categoria = ?`;
            params.push(categoria);
        }
        
        const productos = await db.all(query, params);
        const categorias = await db.all('SELECT DISTINCT categoria FROM productos WHERE categoria IS NOT NULL AND categoria != ""');
        
        // CORREGIDO: Añadimos 'usuario' al render para que el Navbar de catalogo.ejs sepa quién está navegando
        res.render('catalogo', { 
            productos, 
            categorias, 
            buscar, 
            categoriaSeleccionada: categoria,
            usuario: req.session.usuario || null // 👈 ESTA LÍNEA REPARA TU NAV
        });
        
    } catch (error) {
        console.error("Error en catálogo:", error);
        res.status(500).send("Error en el catálogo");
    }
});

app.get('/dashboard', verificarSesion, async (req, res) => {
    try {
        // 1. Contar total de productos en la plataforma
        const totalProductos = await db.get('SELECT COUNT(*) AS total FROM productos');

        // 2. Contar artesanos registrados
        const totalArtesanos = await db.get("SELECT COUNT(*) AS total FROM usuarios WHERE rol = 'artesano'");

        // 3. Calcular el Stock total general de productos disponibles
        const totalStock = await db.get('SELECT SUM(stock) AS total FROM productos');

        // 4. CORREGIDO: Ventas Totales Sumando la columna 'total' de tu tabla 'pedidos' (Filtrando cancelados/rechazados)
        const ventasCalculadas = await db.get("SELECT SUM(total) AS total_ventas FROM pedidos WHERE estado != 'cancelado' AND estado != 'rechazado'");
        const totalVentas = ventasCalculadas.total_ventas || 0;

        // 5. CORREGIDO: Artesanías Favoritas usando tu tabla 'pedido_detalles' (pd) (Filtrando cancelados/rechazados)
        const artesaniasFavoritas = await db.all(`
            SELECT p.id, p.nombre, p.precio, SUM(pd.cantidad) AS veces_vendido,
                   (SELECT ruta FROM producto_imagenes WHERE producto_id = p.id LIMIT 1) AS imagen_principal
            FROM pedido_detalles pd
            JOIN productos p ON pd.producto_id = p.id
            JOIN pedidos ped ON pd.pedido_id = ped.id
            WHERE ped.estado != 'cancelado' AND ped.estado != 'rechazado'
            GROUP BY pd.producto_id
            ORDER BY veces_vendido DESC
            LIMIT 3
        `);

        // 6. Top de categorías con más productos (Mantenido)
        const topCategorias = await db.all(`
            SELECT categoria, COUNT(*) AS cantidad 
            FROM productos 
            WHERE categoria IS NOT NULL AND categoria != ''
            GROUP BY categoria 
            ORDER BY cantidad DESC 
            LIMIT 5
        `);

        // Renderizamos pasándole las estadísticas reales de tu base de datos
        res.render('dashboard', {
            estadisticas: {
                productos: totalProductos.total || 0,
                artesanos: totalArtesanos.total || 0,
                stockGeneral: totalStock.total || 0,
                ventasTotales: totalVentas,
                favoritos: artesaniasFavoritas,
                categorias: topCategorias
            },
            usuario: req.session.usuario || null // Control de sesión para el navbar
        });

    } catch (error) {
        console.error("====== ERROR CRÍTICO EN /dashboard ======");
        console.error(error);
        console.error("=========================================");
        res.status(500).send("Error al cargar las estadísticas del sitio");
    }
});

// ROUTE: Dashboard Personal del Artesano
app.get('/mis-estadisticas', verificarSesion, async (req, res) => {
    try {
        // SEGURIDAD CRÍTICA: Si no es artesano, no tiene nada que hacer aquí
        if (req.session.usuario.rol !== 'artesano') {
            req.flash('error_msg', '❌ Acceso denegado. Esta sección es exclusiva para vendedores.');
            return res.redirect('/catalogo');
        }

        const vendedorId = req.session.usuario.id;

        // 1. Total de productos propios publicados por este artesano
        const totalProductos = await db.get('SELECT COUNT(*) AS total FROM productos WHERE vendedor_id = ?', [vendedorId]);

        // 2. Calcular el Stock total de sus propios productos en depósito
        const totalStock = await db.get('SELECT SUM(stock) AS total FROM productos WHERE vendedor_id = ?', [vendedorId]);

        // 3. CORREGIDO: Ventas Totales en Guaraníes (₲) filtrando pedidos cancelados o rechazados
        // Sumamos el subtotal (cantidad * precio_unitario) cruzando con la tabla 'pedidos' (ped)
        const ventasCalculadas = await db.get(`
            SELECT SUM(pd.cantidad * pd.precio_unitario) AS total_ventas 
            FROM pedido_detalles pd
            JOIN pedidos ped ON pd.pedido_id = ped.id
            WHERE pd.vendedor_id = ? AND ped.estado != 'cancelado' AND ped.estado != 'rechazado'`, 
            [vendedorId]
        );
        const totalVentas = ventasCalculadas.total_ventas || 0;

        // 4. CORREGIDO: Sus 3 artesanías más vendidas filtrando pedidos cancelados o rechazados
        const misFavoritos = await db.all(`
            SELECT p.id, p.nombre, p.precio, SUM(pd.cantidad) AS veces_vendido,
                   (SELECT ruta FROM producto_imagenes WHERE producto_id = p.id LIMIT 1) AS imagen_principal
            FROM pedido_detalles pd
            JOIN productos p ON pd.producto_id = p.id
            JOIN pedidos ped ON pd.pedido_id = ped.id
            WHERE pd.vendedor_id = ? AND ped.estado != 'cancelado' AND ped.estado != 'rechazado'
            GROUP BY pd.producto_id
            ORDER BY veces_vendido DESC
            LIMIT 3
        `, [vendedorId]);

        // 5. Categorías en las que este artesano tiene presencia
        const misCategorias = await db.all(`
            SELECT categoria, COUNT(*) AS cantidad 
            FROM productos 
            WHERE vendedor_id = ? AND categoria IS NOT NULL AND categoria != ''
            GROUP BY categoria 
            ORDER BY cantidad DESC
        `, [vendedorId]);

        // Renderizamos una nueva vista enfocada en su negocio
        res.render('dashboard-vendedor', {
            estadisticas: {
                productos: totalProductos.total || 0,
                stockGeneral: totalStock.total || 0,
                ventasTotales: totalVentas,
                favoritos: misFavoritos,
                categorias: misCategorias
            },
            usuario: req.session.usuario
        });

    } catch (error) {
        console.error("Error en dashboard de vendedor:", error);
        res.status(500).send("Error al cargar las estadísticas de tu tienda");
    }
});

app.get('/producto/:id', verificarSesion, async (req, res) => {
    try {
        const productoId = req.params.id;

        // 1. Consulta Principal: Traemos los datos del producto y el nombre del taller del artesano
        const producto = await db.get(`
            SELECT productos.*, usuarios.taller_nombre 
            FROM productos 
            JOIN usuarios ON productos.vendedor_id = usuarios.id 
            WHERE productos.id = ?`, 
            [productoId]
        );
        
        // Si por algún motivo el ID no existe, devolvemos un error 404
        if (!producto) {
            return res.status(404).send("Producto no encontrado");
        }

        // 2. Consulta Secundaria: Traemos todas las filas de fotos asociadas a este producto
        const imagenes = await db.all(
            'SELECT * FROM producto_imagenes WHERE producto_id = ?', 
            [productoId]
        );

        // Pasamos AMBOS datos a tu plantilla EJS para que los renderice
        res.render('producto-detalle', { producto, imagenes });

    } catch (error) {
        console.error("Error al cargar la vista de detalle:", error);
        res.status(500).send("Error interno al cargar la página del producto");
    }
});

// ==========================================
// 4. VENTAS Y PRODUCTOS (ARTESANO)
// ==========================================

// [MODIFICADO] Ahora mostramos también el estado del pago y el comprobante
app.get('/ventas', verificarSesion, async (req, res) => {
    if (req.session.usuario.rol !== 'artesano') return res.redirect('/catalogo');
    const ventas = await db.all(`
        SELECT ped.id AS pedido_id, pd.cantidad, p.nombre AS producto_nombre, ped.estado, ped.fecha, 
               u.nombre AS cliente_nombre, pd.precio_unitario, ped.comprobante_ruta, ped.estado_pago
        FROM pedido_detalles pd
        JOIN productos p ON pd.producto_id = p.id
        JOIN pedidos ped ON pd.pedido_id = ped.id
        JOIN usuarios u ON ped.usuario_id = u.id
        WHERE p.vendedor_id = ?
        ORDER BY ped.fecha DESC
    `, [req.session.usuario.id]);
    res.render('mis-ventas', { ventas });
});

app.post('/ventas/actualizar-estado/:id', verificarSesion, async (req, res) => {
    // [MODIFICADO] Puedes actualizar el estado del pedido y el estado del pago si viniera en el body
    const { estado, estado_pago } = req.body;
    await db.run('UPDATE pedidos SET estado = ?, estado_pago = ? WHERE id = ?', 
        [estado, estado_pago || 'verificación pendiente', req.params.id]);
    res.redirect('/ventas');
});

//RUTA: Procesar la creación de cupones desde el panel de Ventas
app.post('/ventas/crear-cupon', verificarSesion, async (req, res) => {
    try {
        if (req.session.usuario.rol !== 'artesano') return res.redirect('/catalogo');

        const { codigo, porcentaje } = req.body;

        // Validaciones de seguridad básicas
        if (!codigo || !porcentaje || porcentaje <= 0 || porcentaje > 100) {
            return res.status(400).send("Datos del cupón inválidos (El porcentaje debe estar entre 1 y 100)");
        }

        // Insertamos el cupón (forzando mayúsculas y limpiando espacios en blanco)
        await db.run(
            "INSERT INTO cupones (codigo, descuento_porcentaje, activo) VALUES (?, ?, 1)",
            [codigo.toUpperCase().trim(), parseFloat(porcentaje)]
        );

        // Volvemos a recargar el panel de ventas para ver el cambio
        res.redirect('/ventas');
    } catch (error) {
        console.error("Error al crear cupón desde ventas:", error);
        if (error.message.includes("UNIQUE constraint failed")) {
            return res.status(400).send("Error: Ese código de cupón ya existe en el sistema.");
        }
        res.status(500).send("Error interno al generar el cupón");
    }
});

app.get('/mis-productos', verificarSesion, async (req, res) => {
    const productos = await db.all('SELECT * FROM productos WHERE vendedor_id = ?', [req.session.usuario.id]);
    res.render('panel-artesano', { productos });
});

//Agregamos 'uploadProducto' para que Multer procese las fotos antes de entrar a la lógica
app.post('/productos/nuevo', verificarSesion, (req, res, next) => {
    // Ejecutamos Multer manualmente aquí para poder capturar el error ANTES de que rompa Express
    uploadProducto(req, res, function (error) {
        if (error) {
            // Si el usuario seleccionó más de 5 fotos, Multer lanzará este error
            if (error instanceof multer.MulterError && error.code === 'LIMIT_UNEXPECTED_FILE') {
                console.error("⚠️ Intento de subida masiva detectado (Más de 5 imágenes).");
                req.flash('error_msg', '❌ No puedes subir más de 5 archivos. Por favor, inténtalo de nuevo seleccionando un máximo de 5 imágenes.');
                return res.redirect('/mis-productos');
            }
            
            // Si es otro error de Multer diferente
            console.error("Error de Multer:", error);
            req.flash('error_msg', '❌ Ocurrió un error al procesar las imágenes.');
            return res.redirect('/mis-productos');
        }
        // Si no hay errores con las fotos, pasamos al siguiente bloque (la lógica de la base de datos)
        next();
    });
}, async (req, res) => {
    try {
        // 1. Extracción de datos (Mantenido intacto)
        const { nombre, descripcion, precio, stock, categoria, variantes } = req.body;

        if (req.session.usuario.rol !== 'artesano') {
            return res.status(403).send("No tienes permiso");
        }

        // 2. Insertar en la tabla 'productos'
        const result = await db.run(`
            INSERT INTO productos (nombre, descripcion, precio, stock, categoria, variantes, vendedor_id)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
                nombre, 
                descripcion, 
                precio, 
                stock, 
                categoria, 
                variantes || null, 
                req.session.usuario.id
            ]
        );

        // Capturamos el ID del producto recién insertado
        const productoId = result.lastID;

        // Registramos todas las imágenes subidas en la tabla 'producto_imagenes'
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                await db.run(
                    'INSERT INTO producto_imagenes (producto_id, ruta) VALUES (?, ?)',
                    [productoId, file.filename]
                );
            }
        } else {
            // Imagen de respaldo por si no se subieron fotos
            await db.run(
                'INSERT INTO producto_imagenes (producto_id, ruta) VALUES (?, ?)',
                [productoId, 'default-producto.png']
            );
        }

        // 3. Mensaje de éxito para el artesano
        req.flash('success_msg', '¡Producto publicado correctamente con sus imágenes! 🏺');
        res.redirect('/mis-productos');

    } catch (error) {
        console.error("====== ERROR CRÍTICO EN /productos/nuevo ======");
        console.error(error);
        console.error("===============================================");
        res.status(500).send("Error al publicar");
    }
});

// RUTA PARA ELIMINAR PRODUCTO
app.get('/productos/eliminar/:id', verificarSesion, async (req, res) => {
    const productoId = req.params.id;
    const vendedorId = req.session.usuario.id; // El ID del artesano logueado

    try {
        // 1. Verificamos que el producto exista y que pertenezca al artesano que intenta borrarlo
        // Esto evita que alguien borre productos ajenos cambiando el ID en la URL
        const producto = await db.get(
            'SELECT * FROM productos WHERE id = ? AND vendedor_id = ?', 
            [productoId, vendedorId]
        );

        if (!producto) {
            req.flash('error_msg', 'No tienes permiso para eliminar este producto o no existe.');
            return res.redirect('/mis-productos');
        }

        // 2. Si la validación pasa, procedemos a borrar
        await db.run('DELETE FROM productos WHERE id = ?', [productoId]);

        // 3. Avisamos al usuario y redirigimos
        req.flash('success_msg', 'Producto eliminado correctamente 🗑️');
        res.redirect('/mis-productos');

    } catch (error) {
        console.error("Error al eliminar producto:", error);
        req.flash('error_msg', 'Ocurrió un error al intentar eliminar el producto.');
        res.redirect('/mis-productos');
    }
});

app.get('/mis-ventas', verificarSesion, async (req, res) => {
    // Verificamos que sea artesano
    if (req.session.usuario.rol !== 'artesano') return res.redirect('/catalogo');
    
    try {
        const ventas = await db.all(`
            SELECT 
                ped.id AS pedido_id, 
                p.nombre AS producto_nombre, 
                pd.cantidad, 
                pd.precio_unitario,
                ped.fecha, 
                ped.estado, 
                ped.direccion,      -- Dato real del formulario de compra
                ped.telefono,       -- Dato real del formulario de compra
                ped.comprobante_ruta,
                u.nombre AS cliente_nombre,
                u.email AS cliente_email -- Email de la cuenta del comprador
            FROM pedido_detalles pd
            JOIN productos p ON pd.producto_id = p.id
            JOIN pedidos ped ON pd.pedido_id = ped.id
            JOIN usuarios u ON ped.usuario_id = u.id
            WHERE pd.vendedor_id = ?
            ORDER BY ped.fecha DESC
        `, [req.session.usuario.id]);

        res.render('mis-ventas', { ventas });
    } catch (error) {
        console.error("Error en SQL:", error);
        res.status(500).send("Error al cargar los datos de ventas");
    }
});

app.post('/ventas/cancelar/:id', verificarSesion, async (req, res) => {
    try {
        const pedidoId = req.params.id;
        const artesanoId = req.session.usuario.id;
        
        // 1. CAPTURAMOS EL COMENTARIO: Si viene vacío, asignamos un mensaje por defecto
        const { comentario } = req.body;
        const motivo = comentario && comentario.trim() !== "" ? comentario.trim() : "El artesano no especificó un motivo.";

        // 2. Buscamos qué productos y qué cantidades hay que devolver
        const productosAReponer = await db.all(
            "SELECT producto_id, cantidad FROM pedido_detalles WHERE pedido_id = ? AND vendedor_id = ?",
            [pedidoId, artesanoId]
        );

        // 3. Devolvemos el stock a cada producto
        for (const item of productosAReponer) {
            await db.run(
                "UPDATE productos SET stock = stock + ? WHERE id = ?",
                [item.cantidad, item.producto_id]
            );
        }

        // 4. CORREGIDO: Marcamos el pedido como cancelado y GUARDAMOS EL COMENTARIO
        await db.run(
            "UPDATE pedidos SET estado = 'cancelado', estado_pago = 'rechazado', comentario_vendedor = ? WHERE id = ?",
            [motivo, pedidoId]
        );

        res.redirect('/mis-ventas');
    } catch (error) {
        console.error("Error al cancelar la venta:", error);
        res.status(500).send("Error al cancelar la venta");
    }
});

// Ruta para ver el formulario de edición de una venta
app.get('/ventas/editar/:id', verificarSesion, async (req, res) => {
    try {
        const pedido = await db.get("SELECT * FROM pedidos WHERE id = ?", [req.params.id]);
        if (!pedido) return res.redirect('/mis-ventas');
        res.render('editar-venta', { pedido });
    } catch (error) {
        res.status(500).send("Error al abrir edición");
    }
});

app.post('/ventas/editar/:id', verificarSesion, async (req, res) => {
    try {
        await db.run("UPDATE pedidos SET estado = ? WHERE id = ?", [req.body.estado, req.params.id]);
        res.redirect('/mis-ventas');
    } catch (error) {
        res.status(500).send("Error al actualizar estado");
    }
});

app.post('/ventas/confirmar-pago/:id', verificarSesion, async (req, res) => {
    try {
        // Actualizamos el estado del pago a 'aprobado'
        await db.run(
            "UPDATE pedidos SET estado_pago = 'aprobado', estado = 'preparando envío' WHERE id = ?",
            [req.params.id]
        );
        req.flash('success_msg', 'Pago confirmado. ¡A preparar el envío! 📦');
        res.redirect('/mis-ventas');
    } catch (error) {
        res.status(500).send("Error al confirmar pago");
    }
});

// Ruta para mostrar el formulario de edición con los datos actuales
app.get('/productos/editar/:id', verificarSesion, async (req, res) => {
    try {
        // 1. Buscamos el producto asegurando que pertenezca al artesano (Mantenido intacto)
        const producto = await db.get(
            'SELECT * FROM productos WHERE id = ? AND vendedor_id = ?', 
            [req.params.id, req.session.usuario.id]
        );

        if (!producto) {
            req.flash('error_msg', 'Producto no encontrado o no tienes permiso.');
            return res.redirect('/mis-productos');
        }

        // NUEVO: Buscamos todas las imágenes asociadas a este producto para la galería de edición
        const imagenes = await db.all(
            'SELECT * FROM producto_imagenes WHERE producto_id = ?', 
            [req.params.id]
        );

        // 2. Renderizamos la vista pasando tanto el producto como sus imágenes
        res.render('editar-producto', { 
            producto, 
            imagenes 
        });

    } catch (error) {
        console.error(error);
        res.status(500).send("Error al cargar el formulario de edición");
    }
});

// Envolvemos la ruta para ejecutar Multer manualmente y atajar errores de subida masiva antes de tocar la BD
// 🚀 BLOQUE 1: Nueva ruta para eliminar imágenes automáticamente al instante
app.post('/productos/eliminar-imagen/:id', verificarSesion, async (req, res) => {
    try {
        const imagenId = req.params.id;
        const { productoId } = req.body; // Recibimos el ID del producto para saber a dónde regresar
        const vendedorId = req.session.usuario.id;

        const fs = require('fs');
        const path = require('path');

        // 1. Validamos que la imagen exista y pertenezca a un producto del artesano logueado
        const imagenValida = await db.get(`
            SELECT pi.ruta 
            FROM producto_imagenes pi
            JOIN productos p ON pi.producto_id = p.id
            WHERE pi.id = ? AND p.vendedor_id = ?
        `, [imagenId, vendedorId]);

        if (!imagenValida) {
            req.flash('error_msg', '❌ No tienes permisos para eliminar esta imagen o no existe.');
            return res.redirect(`/productos/editar/${productoId}`);
        }

        // 2. Borramos el archivo físico del disco del servidor
        const rutaArchivo = path.join(__dirname, 'public', 'uploads', imagenValida.ruta);
        if (fs.existsSync(rutaArchivo)) {
            fs.unlinkSync(rutaArchivo);
        }

        // 3. Borramos la fila de la base de datos
        await db.run('DELETE FROM producto_imagenes WHERE id = ?', [imagenId]);

        req.flash('success_msg', 'Imagen eliminada de inmediato. ✨');
        res.redirect(`/productos/editar/${productoId}`);

    } catch (error) {
        console.error("Error al eliminar imagen individual:", error);
        req.flash('error_msg', 'Hubo un error al intentar quitar la imagen.');
        res.redirect('/mis-productos');
    }
});

// BLOQUE 2: Tu ruta de edición modificada (Limpia y enfocada solo en actualizar)
app.post('/productos/editar/:id', verificarSesion, (req, res, next) => {
    uploadProducto(req, res, function (error) {
        if (error) {
            if (error instanceof multer.MulterError && error.code === 'LIMIT_UNEXPECTED_FILE') {
                req.flash('error_msg', '❌ No puedes subir más de 5 imágenes simultáneamente.');
                return res.redirect(`/productos/editar/${req.params.id}`);
            }
            req.flash('error_msg', '❌ Ocurrió un error al procesar las nuevas imágenes.');
            return res.redirect(`/productos/editar/${req.params.id}`);
        }
        next();
    });
}, async (req, res) => {
    try {
        const { nombre, descripcion, precio, stock, categoria, variantes } = req.body;
        const productoId = req.params.id;
        const sellerId = req.session.usuario.id;
        
        // 1. Tu UPDATE original (Mantenido 100% idéntico)
        await db.run(
            `UPDATE productos 
             SET nombre=?, descripcion=?, precio=?, stock=?, categoria=?, variantes=? 
             WHERE id=? AND vendedor_id=?`,
            [nombre, descripcion, precio, stock, categoria, variantes || null, productoId, sellerId]
        );

        // 2. Controlamos el límite neto de 5 imágenes contando las que ya quedan en la BD
        const imagenesActuales = await db.get('SELECT COUNT(*) as total FROM producto_imagenes WHERE producto_id = ?', [productoId]);
        const cantidadNuevas = req.files ? req.files.length : 0;
        
        if (imagenesActuales.total + cantidadNuevas > 5) {
            if (req.files && req.files.length > 0) {
                const fs = require('fs');
                req.files.forEach(file => {
                    if (fs.existsSync(file.path)) fs.unlinkSync(file.path);
                });
            }
            req.flash('error_msg', '❌ El producto no puede tener más de 5 imágenes en total.');
            return res.redirect(`/productos/editar/${productoId}`);
        }

        // 3. Procesar inserción de nuevas imágenes si el artesano cargó archivos
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                await db.run(
                    'INSERT INTO producto_imagenes (producto_id, ruta) VALUES (?, ?)',
                    [productoId, file.filename]
                );
            }
        }

        req.flash('success_msg', 'Producto actualizado correctamente. ✨');
        res.redirect('/mis-productos');
        
    } catch (error) {
        console.error("====== ERROR EN POST /productos/editar/:id ======");
        console.error(error);
        console.error("=================================================");
        req.flash('error_msg', 'Error al actualizar el producto.');
        res.redirect('/mis-productos');
    } // 👈 Se cerró correctamente el bloque catch
}); // 👈 Se cerró correctamente la ruta de Express

// ==========================================
// 5. CARRITO Y COMPRAS (CLIENTE)
// ==========================================

app.post('/carrito/agregar/:id', verificarSesion, async (req, res) => {
    try {
        const productoIdStr = String(req.params.id);
        const cantidadASumar = req.body.cantidad ? Number(req.body.cantidad) : 1;
        const accion = req.body.accion; // Captura si es 'carrito' o 'comprar'

        // 1. Buscamos el producto en la DB para obtener su vendedor_id y datos actuales
        const producto = await db.get('SELECT * FROM productos WHERE id = ?', [req.params.id]);
        
        if (!producto) {
            req.flash('error_msg', 'El producto no existe.');
            return res.redirect('/catalogo');
        }

        if (!req.session.carrito) req.session.carrito = [];

        // 2. VALIDACIÓN CRÍTICA: Impedir productos de diferentes vendedores
        if (req.session.carrito.length > 0) {
            const primerItem = req.session.carrito[0];
            // Comparamos el vendedor del producto nuevo con el que ya está en el carrito
            if (producto.vendedor_id !== primerItem.vendedor_id) {
                req.flash('error_msg', 'Solo puedes agregar productos de un mismo artesano por compra. Finaliza tu pedido actual primero.');
                return req.session.save(() => res.redirect(req.get('Referrer') || '/catalogo'));
            }
        }

        // 3. Lógica para añadir o actualizar cantidad
        const indiceExistente = req.session.carrito.findIndex(item => String(item.id) === productoIdStr);

        if (indiceExistente !== -1) {
            req.session.carrito[indiceExistente].cantidad += cantidadASumar;
        } else {
            // IMPORTANTE: Guardamos el vendedor_id aquí para futuras validaciones
            req.session.carrito.push({ 
                id: producto.id, 
                nombre: producto.nombre, 
                precio: parseFloat(producto.precio), 
                vendedor_id: producto.vendedor_id, 
                cantidad: cantidadASumar 
            });
        }

        // 4. Redirección según el botón pulsado
        req.session.save(() => {
            if (accion === 'comprar') {
                res.redirect('/carrito/confirmar');
            } else {
                req.flash('success_msg', '¡Producto añadido al carrito! ✨');
                res.redirect(req.get('Referrer') || '/catalogo');
            }
        });

    } catch (error) {
        console.error("Error al agregar al carrito:", error);
        res.redirect('/catalogo');
    }
});

app.get('/carrito', verificarSesion, (req, res) => {
    let total = req.session.carrito ? req.session.carrito.reduce((sum, item) => sum + (Number(item.precio) * Number(item.cantidad)), 0) : 0;
    
    res.render('carrito', { 
        items: req.session.carrito || [], 
        total: total,
        descuento: req.session.descuento || 0,
        cupon_codigo: req.session.cupon_codigo || null,
        error_cupon: req.session.error_cupon || null
    });

    // Limpiamos el error de cupón tras renderizar para que no se quede fijo
    req.session.error_cupon = null;
});

app.get('/checkout', verificarSesion, (req, res) => {
    res.redirect('/carrito/confirmar');
});

// MODIFICACIÓN 2: Modificamos para calcular el total restándole el cupón activo
app.get('/carrito/confirmar', verificarSesion, async (req, res) => {
    try {
        const carrito = req.session.carrito || [];
        if (carrito.length === 0) return res.redirect('/catalogo');

        // 1. Calculamos el subtotal base 
        const subtotal = carrito.reduce((t, i) => t + (i.precio * i.cantidad), 0);
        
        // 2. Conectamos con el sistema de cupones activos en la sesión
        const cuponAplicado = req.session.cupon || null;
        const porcentajeDescuento = cuponAplicado ? cuponAplicado.descuento_porcentaje : 0;
        
        // Redondeamos para manejar números enteros limpios en Guaraníes (₲)
        const descuento = Math.round(subtotal * (porcentajeDescuento / 100));
        const totalConDescuento = subtotal - descuento;

        // 3. OBTENEMOS LOS DATOS DEL VENDEDOR 
        const primerProductoId = carrito[0].id;
        const vendedor = await db.get(`
            SELECT 
                u.nombre, 
                u.nombre_titular, 
                u.banco_nombre, 
                u.cuenta_numero, 
                u.cuenta_tipo, 
                u.titular_documento, 
                u.alias_pago
            FROM productos p
            JOIN usuarios u ON p.vendedor_id = u.id
            WHERE p.id = ?
        `, [primerProductoId]);

        // 4. Renderizamos pasando el desglose completo
        res.render('confirmar-pago', { 
            subtotal: subtotal,               
            descuento: descuento,             
            total: totalConDescuento,         
            carrito,
            vendedor,
            cupon_aplicado: cuponAplicado     
        });

    } catch (error) {
        console.error("Error al cargar confirmar-pago:", error);
        res.status(500).send("Error interno");
    }
});

// RUTA: Validar y aplicar el cupón al carrito del comprador
app.post('/carrito/aplicar-cupon', verificarSesion, async (req, res) => {
    try {
        const { codigo } = req.body;

        if (!codigo) {
            req.flash('error_msg', '❌ Por favor, ingresa un código de cupón.');
            return res.redirect('/carrito/confirmar'); 
        }

        // Buscamos el cupón en la base de datos 
        const cupon = await db.get(
            "SELECT * FROM cupones WHERE UPPER(codigo) = ? AND activo = 1",
            [codigo.toUpperCase().trim()]
        );

        if (!cupon) {
            req.flash('error_msg', '❌ El cupón ingresado no existe o ya no está vigente.');
            return res.redirect('/carrito/confirmar');
        }

        // Guardamos el cupón válido en la sesión para usarlo en el cálculo final
        req.session.cupon = {
            id: cupon.id,
            codigo: cupon.codigo,
            descuento_porcentaje: cupon.descuento_porcentaje
        };

        req.flash('success_msg', `🎉 ¡Cupón ${cupon.codigo} aplicado! Se descontará el ${cupon.descuento_porcentaje}%.`);
        res.redirect('/carrito/confirmar');

    } catch (error) {
        console.error("Error al aplicar el cupón:", error);
        req.flash('error_msg', 'Hubo un error interno al procesar el descuento.');
        res.redirect('/carrito/confirmar');
    }
});

// MODIFICACIÓN 3: Al guardar el pedido final en la base de datos se guarda el precio rebajado
app.post('/carrito/finalizar', verificarSesion, upload.single('comprobante'), async (req, res) => {
    try {
        const { direccion, telefono } = req.body;
        const carritoActual = req.session.carrito;
        const usuarioId = req.session.usuario.id;
        const nombreArchivo = req.file ? req.file.filename : null;

        if (!carritoActual || carritoActual.length === 0) {
            return res.redirect('/catalogo');
        }

        // 1. Calculamos el subtotal original base
        const subtotalVenta = carritoActual.reduce((t, i) => t + (i.precio * i.cantidad), 0);
        
        // 2. NUEVO: Leemos el porcentaje desde el objeto de cupón de la sesión
        const cuponAplicado = req.session.cupon || null;
        const porcentajeDescuento = cuponAplicado ? cuponAplicado.descuento_porcentaje : 0;
        
        // Calculamos el descuento y el total final redondeado a enteros para Guaraníes (₲)
        const montoDescuento = Math.round(subtotalVenta * (porcentajeDescuento / 100));
        const totalVentaFinal = subtotalVenta - montoDescuento;

        // 3. Insertar Pedido (Cabecera)
        const result = await db.run(
            `INSERT INTO pedidos (usuario_id, total, estado, metodo_pago, direccion, telefono, comprobante_ruta, estado_pago) 
             VALUES (?, ?, 'pendiente', 'transferencia', ?, ?, ?, 'verificación pendiente')`,
            [usuarioId, totalVentaFinal, direccion, telefono, nombreArchivo]
        );
        
        const pedidoId = result.lastID;

        // 4. Insertar Detalles y Actualizar Stock 
        for (const item of carritoActual) {
            const prodInfo = await db.get('SELECT vendedor_id FROM productos WHERE id = ?', [item.id]);

            if (prodInfo) {
                await db.run(
                    `INSERT INTO pedido_detalles (pedido_id, producto_id, vendedor_id, cantidad, precio_unitario) 
                     VALUES (?, ?, ?, ?, ?)`,
                    [pedidoId, item.id, prodInfo.vendedor_id, item.cantidad, item.precio]
                );

                await db.run(
                    'UPDATE productos SET stock = stock - ? WHERE id = ?',
                    [item.cantidad, item.id]
                );
            }
        }

        // 5. NUEVO: Limpiamos por completo el carrito y el objeto del cupón de la sesión
        req.session.carrito = [];
        req.session.cupon = null; 

        req.session.save((err) => {
            if (err) {
                console.error("Error al guardar sesión post-venta:", err);
            }
            res.render('confirmacion', { pedidoId }); 
        });

    } catch (error) {
        console.error("ERROR CRÍTICO EN PROCESO DE VENTA:", error); 
        res.status(500).send("Error interno al procesar la venta"); // 👈 ¡Arreglado aquí!
    } // 👈 Cierre del catch agregado
}); // 👈 Cierre del app.post agregado

// --- HISTORIAL DE COMPRAS ---
app.get('/mis-compras', verificarSesion, async (req, res) => {
    try {
        const pedidos = await db.all(`
            SELECT * FROM pedidos 
            WHERE usuario_id = ? 
            ORDER BY fecha DESC`, [req.session.usuario.id]);
        res.render('mis-compras', { pedidos });
    } catch (error) {
        res.status(500).send("Error al cargar tus compras");
    }
});

app.get('/mis-compras/:id', verificarSesion, async (req, res) => {
    try {
        const pedido = await db.get(`SELECT * FROM pedidos WHERE id = ? AND usuario_id = ?`, [req.params.id, req.session.usuario.id]);
        if (!pedido) return res.status(404).send("Pedido no encontrado");

        const detalles = await db.all(`
            SELECT 
                pd.*, 
                p.nombre AS producto_nombre,
                u.nombre AS vendedor_nombre
            FROM pedido_detalles pd
            JOIN productos p ON pd.producto_id = p.id
            JOIN usuarios u ON p.vendedor_id = u.id
            WHERE pd.pedido_id = ?`, [req.params.id]);

        res.render('compra-detalle', { pedido, detalles }); 
    } catch (error) {
        console.error(error);
        res.status(500).send("Error al obtener detalle");
    }
});