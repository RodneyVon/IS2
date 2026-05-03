const express = require('express');
const session = require('express-session'); 
const { setup } = require('./database');
const app = express();

// ==========================================
// --- CONFIGURACIÓN Y MIDDLEWARES ---
// ==========================================
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: 'mi-clave-secreta', 
    resave: false,
    saveUninitialized: false
}));

// Middleware global para que las vistas siempre tengan acceso al usuario y carrito
app.use((req, res, next) => {
    if (!req.session.carrito) {
        req.session.carrito = [];
    }
    res.locals.carrito = req.session.carrito;
    
    if (req.session.usuario) {
        res.locals.usuario = req.session.usuario;
        res.locals.nombre = req.session.usuario.nombre;
        res.locals.rol = req.session.usuario.rol;
    } else {
        res.locals.usuario = null;
        res.locals.nombre = null;
        res.locals.rol = null;
    }
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
// 2. AUTENTICACIÓN
// ==========================================

app.get('/', (req, res) => res.redirect('/catalogo'));

app.get('/registro', (req, res) => res.render('registro'));

app.post('/registro', async (req, res) => {
    const { nombre, email, password, rol, taller_nombre, bio } = req.body;
    try {
        await db.run(
            `INSERT INTO usuarios (nombre, email, password, rol, taller_nombre, bio) 
             VALUES (?, ?, ?, ?, ?, ?)`,
            [nombre, email, password, rol || 'cliente', taller_nombre || null, bio || null]
        );
        res.redirect('/login');
    } catch (error) {
        res.status(400).send("Error en el registro.");
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

app.get('/perfil', verificarSesion, (req, res) => {
    res.render('perfil', { 
        usuario: req.session.usuario,
        nombre: req.session.usuario.nombre,
        rol: req.session.usuario.rol
    });
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

// Detalle de producto
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

app.get('/ventas', verificarSesion, async (req, res) => {
    if (req.session.usuario.rol !== 'artesano') return res.redirect('/catalogo');
    const ventas = await db.all(`
        SELECT ped.id, pd.cantidad, p.nombre AS producto_nombre, ped.estado, ped.fecha, u.nombre AS cliente_nombre, pd.precio_unitario
        FROM pedido_detalles pd
        JOIN productos p ON pd.producto_id = p.id
        JOIN pedidos ped ON pd.pedido_id = ped.id
        JOIN usuarios u ON ped.usuario_id = u.id
        WHERE p.vendedor_id = ?
        ORDER BY ped.fecha DESC
    `, [req.session.usuario.id]);
    res.render('mis-ventas', { ventas });
});

app.get('/mis-ventas', (req, res) => res.redirect('/ventas'));

app.get('/ventas/editar/:id', verificarSesion, async (req, res) => {
    const venta = await db.get(`
        SELECT ped.id, p.nombre AS producto_nombre, ped.estado 
        FROM pedidos ped
        JOIN pedido_detalles pd ON ped.id = pd.pedido_id
        JOIN productos p ON pd.producto_id = p.id
        WHERE ped.id = ?
    `, [req.params.id]);
    res.render('editar-venta', { venta });
});

app.post('/ventas/actualizar-estado/:id', verificarSesion, async (req, res) => {
    await db.run('UPDATE pedidos SET estado = ? WHERE id = ?', [req.body.estado, req.params.id]);
    res.redirect('/ventas');
});

app.get('/mis-productos', verificarSesion, async (req, res) => {
    const productos = await db.all('SELECT * FROM productos WHERE vendedor_id = ?', [req.session.usuario.id]);
    res.render('panel-artesano', { productos });
});

app.get('/productos/editar/:id', verificarSesion, async (req, res) => {
    const producto = await db.get('SELECT * FROM productos WHERE id = ? AND vendedor_id = ?', [req.params.id, req.session.usuario.id]);
    res.render('editar-producto', { producto });
});

app.post('/productos/editar/:id', verificarSesion, async (req, res) => {
    const { nombre, descripcion, precio, stock, categoria, variantes } = req.body;
    await db.run(`UPDATE productos SET nombre=?, descripcion=?, precio=?, stock=?, categoria=?, variantes=? WHERE id=?`,
        [nombre, descripcion, precio, stock, categoria, variantes, req.params.id]);
    res.redirect('/mis-productos');
});

// ==========================================
// 5. CARRITO Y COMPRAS (CLIENTE)
// ==========================================

app.post('/carrito/agregar/:id', verificarSesion, async (req, res) => {
    const producto = await db.get('SELECT * FROM productos WHERE id = ?', [req.params.id]);
    if (producto) {
        req.session.carrito.push({ 
            id: producto.id, 
            nombre: producto.nombre, 
            precio: parseFloat(producto.precio), 
            cantidad: 1 
        });
    }
    res.redirect('/catalogo');
});

app.get('/carrito', verificarSesion, (req, res) => {
    let total = req.session.carrito.reduce((sum, item) => sum + (Number(item.precio) * Number(item.cantidad)), 0);
    res.render('carrito', { items: req.session.carrito, total });
});

app.get('/checkout', verificarSesion, (req, res) => {
    let total = req.session.carrito.reduce((sum, item) => sum + (Number(item.precio) * Number(item.cantidad)), 0);
    res.render('checkout', { total });
});

app.post('/carrito/finalizar', verificarSesion, async (req, res) => {
    const { direccion, telefono, metodo_pago } = req.body;
    let total = req.session.carrito.reduce((sum, item) => sum + (Number(item.precio) * Number(item.cantidad)), 0);
    
    const result = await db.run(`INSERT INTO pedidos (usuario_id, total, estado, metodo_pago, direccion, telefono) VALUES (?, ?, ?, ?, ?, ?)`,
        [req.session.usuario.id, total, 'pendiente', metodo_pago, direccion, telefono]);
    
    const pedidoId = result.lastID;
    for (const item of req.session.carrito) {
        await db.run('INSERT INTO pedido_detalles (pedido_id, producto_id, cantidad, precio_unitario) VALUES (?, ?, ?, ?)',
            [pedidoId, item.id, item.cantidad, item.precio]);
    }
    req.session.carrito = [];
    res.render('confirmacion', { pedidoId });
});

//Ver historial de compras del cliente
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

// Esta ruta nueva maneja el clic en un pedido específico
app.get('/mis-compras/:id', verificarSesion, async (req, res) => {
    try {
        const pedidoId = req.params.id;
        const usuarioId = req.session.usuario.id;

        const pedido = await db.get(`
            SELECT * FROM pedidos 
            WHERE id = ? AND usuario_id = ?`, 
            [pedidoId, usuarioId]
        );

        if (!pedido) {
            return res.status(404).send("Pedido no encontrado");
        }

        // Cambiamos el nombre de la variable a 'detalles'
        const detalles = await db.all(`
            SELECT pd.*, p.nombre AS producto_nombre 
            FROM pedido_detalles pd
            JOIN productos p ON pd.producto_id = p.id
            WHERE pd.pedido_id = ?`, 
            [pedidoId]
        );

        // Pasamos 'detalles' a la vista
        res.render('compra-detalle', { pedido, detalles }); 
    } catch (error) {
        console.error(error);
        res.status(500).send("Error al obtener el detalle de la compra");
    }
});