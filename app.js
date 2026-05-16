const express = require('express');
const session = require('express-session'); 
const flash = require('connect-flash');
const path = require('path'); // [NUEVO] Necesario para manejar extensiones de archivos
const multer = require('multer'); // [NUEVO] Para subir los comprobantes
const { setup } = require('./database');
const app = express();

// ==========================================
// --- CONFIGURACIÓN DE MULTER (SUBIDA DE ARCHIVOS) ---
// ==========================================
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

// ==========================================
// --- CONFIGURACIÓN Y MIDDLEWARES ---
// ==========================================
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Hace que la carpeta de comprobantes sea accesible desde el navegador
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads/comprobantes')));

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
    console.log("Datos recibidos del formulario:", req.body);
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

app.get('/catalogo', verificarSesion, async (req, res) => {
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
        const categorias = await db.all('SELECT DISTINCT categoria FROM productos');
        res.render('catalogo', { productos, categorias, buscar, categoriaSeleccionada: categoria });
    } catch (error) {
        res.status(500).send("Error en el catálogo");
    }
});

app.get('/producto/:id', verificarSesion, async (req, res) => {
    try {
        const producto = await db.get(`
            SELECT productos.*, usuarios.taller_nombre 
            FROM productos 
            JOIN usuarios ON productos.vendedor_id = usuarios.id 
            WHERE productos.id = ?`, [req.params.id]);
        
        if (!producto) return res.status(404).send("Producto no encontrado");
        res.render('producto-detalle', { producto });
    } catch (error) {
        res.status(500).send("Error al cargar el producto");
    }
});

// ==========================================
// 4. VENTAS Y PRODUCTOS (ARTESANO)
// ==========================================

// [MODIFICADO] Ahora mostramos también el estado del pago y el comprobante
app.get('/ventas', verificarSesion, async (req, res) => {
    if (req.session.usuario.rol !== 'artesano') return res.redirect('/catalogo');
    const ventas = await db.all(`
        SELECT ped.id, pd.cantidad, p.nombre AS producto_nombre, ped.estado, ped.fecha, 
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

app.get('/mis-productos', verificarSesion, async (req, res) => {
    const productos = await db.all('SELECT * FROM productos WHERE vendedor_id = ?', [req.session.usuario.id]);
    res.render('panel-artesano', { productos });
});

app.post('/productos/nuevo', verificarSesion, async (req, res) => {
    try {
        const { nombre, descripcion, precio, stock, categoria } = req.body;
        if (req.session.usuario.rol !== 'artesano') return res.status(403).send("No tienes permiso");

        await db.run(`
            INSERT INTO productos (nombre, descripcion, precio, stock, categoria, vendedor_id)
            VALUES (?, ?, ?, ?, ?, ?)`,
            [nombre, descripcion, precio, stock, categoria, req.session.usuario.id]
        );
        res.redirect('/mis-productos');
    } catch (error) {
        res.status(500).send("Error al publicar");
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

        // 1. Buscamos qué productos y qué cantidades hay que devolver
        const productosAReponer = await db.all(
            "SELECT producto_id, cantidad FROM pedido_detalles WHERE pedido_id = ? AND vendedor_id = ?",
            [pedidoId, artesanoId]
        );

        // 2. Devolvemos el stock a cada producto
        for (const item of productosAReponer) {
            await db.run(
                "UPDATE productos SET stock = stock + ? WHERE id = ?",
                [item.cantidad, item.producto_id]
            );
        }

        // 3. Marcamos el pedido como cancelado
        await db.run(
            "UPDATE pedidos SET estado = 'cancelado', estado_pago = 'rechazado' WHERE id = ?",
            [pedidoId]
        );

        res.redirect('/mis-ventas');
    } catch (error) {
        console.error(error);
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
        const producto = await db.get(
            'SELECT * FROM productos WHERE id = ? AND vendedor_id = ?', 
            [req.params.id, req.session.usuario.id]
        );

        if (!producto) {
            req.flash('error_msg', 'Producto no encontrado o no tienes permiso.');
            return res.redirect('/mis-productos');
        }

        res.render('editar-producto', { producto });
    } catch (error) {
        console.error(error);
        res.status(500).send("Error al cargar el formulario de edición");
    }
});

app.post('/productos/editar/:id', verificarSesion, async (req, res) => {
    try {
        const { nombre, descripcion, precio, stock, categoria, variantes } = req.body;
        
        await db.run(
            `UPDATE productos 
             SET nombre=?, descripcion=?, precio=?, stock=?, categoria=?, variantes=? 
             WHERE id=? AND vendedor_id=?`,
            [nombre, descripcion, precio, stock, categoria, variantes, req.params.id, req.session.usuario.id]
        );

        req.flash('success_msg', 'Producto actualizado correctamente. ✨');
        res.redirect('/mis-productos');
    } catch (error) {
        console.error(error);
        req.flash('error_msg', 'Error al actualizar el producto.');
        res.redirect('/mis-productos');
    }
});

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
                vendedor_id: producto.vendedor_id, // <--- Esto faltaba en tu rollback
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
    let total = req.session.carrito.reduce((sum, item) => sum + (Number(item.precio) * Number(item.cantidad)), 0);
    res.render('carrito', { items: req.session.carrito, total });
});

app.get('/checkout', verificarSesion, (req, res) => {
    res.redirect('/carrito/confirmar');
});

// [NUEVO] Esta es la página donde el usuario ve los datos de transferencia y sube el archivo
app.get('/carrito/confirmar', verificarSesion, async (req, res) => {
    try {
        const carrito = req.session.carrito || [];
        if (carrito.length === 0) return res.redirect('/catalogo');

        // Calculamos el total
        const total = carrito.reduce((t, i) => t + (i.precio * i.cantidad), 0);

        // OBTENEMOS LOS DATOS DEL VENDEDOR (del primer producto del carrito)
        const primerProductoId = carrito[0].id;
        const vendedor = await db.get(`
            SELECT 
                u.nombre, 
                u.nombre_titular, -- [NUEVO] Agregamos el nombre legal del dueño de la cuenta
                u.banco_nombre, 
                u.cuenta_numero, 
                u.cuenta_tipo, 
                u.titular_documento, 
                u.alias_pago
            FROM productos p
            JOIN usuarios u ON p.vendedor_id = u.id
            WHERE p.id = ?
        `, [primerProductoId]);

        res.render('confirmar-pago', { 
            total, 
            carrito,
            vendedor // Pasamos el objeto vendedor a la vista
        });
    } catch (error) {
        console.error("Error al cargar confirmar-pago:", error);
        res.status(500).send("Error interno");
    }
});

// [MODIFICADO INTEGRALMENTE] Esta ruta ahora procesa el comprobante y guarda todo en la DB
app.post('/carrito/finalizar', verificarSesion, upload.single('comprobante'), async (req, res) => {
    try {
        const { direccion, telefono } = req.body;
        const carritoActual = req.session.carrito;
        const usuarioId = req.session.usuario.id;
        const nombreArchivo = req.file ? req.file.filename : null;

        // Validación de seguridad: carrito vacío
        if (!carritoActual || carritoActual.length === 0) {
            return res.redirect('/catalogo');
        }

        const totalVenta = carritoActual.reduce((t, i) => t + (i.precio * i.cantidad), 0);

        // 1. Insertar Pedido (Cabecera)
        const result = await db.run(
            `INSERT INTO pedidos (usuario_id, total, estado, metodo_pago, direccion, telefono, comprobante_ruta, estado_pago) 
             VALUES (?, ?, 'pendiente', 'transferencia', ?, ?, ?, 'verificación pendiente')`,
            [usuarioId, totalVenta, direccion, telefono, nombreArchivo]
        );
        
        const pedidoId = result.lastID;

        // 2. Insertar Detalles y Actualizar Stock
        for (const item of carritoActual) {
            // Obtenemos el ID del artesano/vendedor para el registro
            const prodInfo = await db.get('SELECT vendedor_id FROM productos WHERE id = ?', [item.id]);

            if (prodInfo) {
                // Registro del detalle de la venta
                await db.run(
                    `INSERT INTO pedido_detalles (pedido_id, producto_id, vendedor_id, cantidad, precio_unitario) 
                     VALUES (?, ?, ?, ?, ?)`,
                    [pedidoId, item.id, prodInfo.vendedor_id, item.cantidad, item.precio]
                );

                // --- DESCUENTO AUTOMÁTICO DE STOCK ---
                // Se descuenta aquí para asegurar que el producto quede reservado tras subir el comprobante
                await db.run(
                    'UPDATE productos SET stock = stock - ? WHERE id = ?',
                    [item.cantidad, item.id]
                );
            }
        }

        // 3. Limpiar carrito y guardar sesión antes de renderizar
        req.session.carrito = [];
        req.session.save((err) => {
            if (err) {
                console.error("Error al guardar sesión post-venta:", err);
            }
            // Renderiza la vista de éxito pasando el ID del pedido generado
            res.render('confirmacion', { pedidoId }); 
        });

    } catch (error) {
        // Log detallado en consola para depuración técnica
        console.error("ERROR CRÍTICO EN PROCESO DE VENTA:", error); 
        
        // Respuesta amigable pero informativa para el usuario
        res.status(500).send(`
            <h2>Error al procesar la compra</h2>
            <p style="color: red;">${error.message}</p>
            <a href="/carrito">Volver al carrito</a>
        `);
    }
});

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
            SELECT pd.*, p.nombre AS producto_nombre 
            FROM pedido_detalles pd
            JOIN productos p ON pd.producto_id = p.id
            WHERE pd.pedido_id = ?`, [req.params.id]);

        res.render('compra-detalle', { pedido, detalles }); 
    } catch (error) {
        res.status(500).send("Error al obtener detalle");
    }
});