const express = require('express');
const session = require('express-session'); 
const { setup } = require('./database');
const app = express();

// --- CONFIGURACIÓN ---
app.set('view engine', 'ejs');
app.use(express.static('public'));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use(session({
    secret: 'mi-clave-secreta', 
    resave: false,
    saveUninitialized: false
}));

// ==========================================
// 1. MIDDLEWARE DE SEGURIDAD (EL GUARDIA)
// ==========================================
function verificarSesion(req, res, next) {
    if (req.session.usuarioId) {
        return next(); // Si hay sesión, adelante
    } else {
        res.redirect('/login'); // Si no, al login
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
// 2. RUTAS PÚBLICAS (Login y Registro)
// ==========================================

app.get('/', (req, res) => {
    if (req.session.usuarioId) return res.redirect('/perfil');
    res.redirect('/login');
});

app.get('/registro', (req, res) => res.render('registro'));

app.post('/registro', async (req, res) => {
    const { nombre, email, password, rol } = req.body;
    try {
        await db.run(
            'INSERT INTO usuarios (nombre, email, password, rol) VALUES (?, ?, ?, ?)',
            [nombre, email, password, rol || 'cliente']
        );
        res.redirect('/login');
    } catch (error) {
        res.status(400).send("Error: El email ya existe.");
    }
});

app.get('/login', (req, res) => res.render('login'));

app.post('/login', async (req, res) => {
    const { email, password } = req.body;
    const usuario = await db.get('SELECT * FROM usuarios WHERE email = ? AND password = ?', [email, password]);

    if (usuario) {
        req.session.usuarioId = usuario.id;
        req.session.nombre = usuario.nombre;
        req.session.rol = usuario.rol;
        
        // Todos van al perfil primero para ver la bienvenida profesional
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
// 3. RUTAS PROTEGIDAS (Usan verificarSesion)
// ==========================================

// Perfil de Bienvenida
app.get('/perfil', verificarSesion, (req, res) => {
    res.render('perfil', { 
        nombre: req.session.nombre, 
        rol: req.session.rol 
    });
});

// Catálogo Principal
app.get('/catalogo', verificarSesion, async (req, res) => {
    const { buscar, categoria } = req.query;
    
    let query = `
        SELECT productos.*, usuarios.taller_nombre 
        FROM productos 
        JOIN usuarios ON productos.vendedor_id = usuarios.id 
        WHERE 1=1
    `;
    let params = [];

    if (buscar) {
        query += ` AND (productos.nombre LIKE ? OR productos.descripcion LIKE ? OR productos.variantes LIKE ?)`;
        const busquedaTerm = `%${buscar}%`;
        params.push(busquedaTerm, busquedaTerm, busquedaTerm);
    }

    if (categoria && categoria !== "") {
        query += ` AND productos.categoria = ?`;
        params.push(categoria);
    }

    const productos = await db.all(query, params);
    const categorias = await db.all('SELECT DISTINCT categoria FROM productos WHERE categoria IS NOT NULL');

    res.render('catalogo', { productos, categorias, buscar, categoriaSeleccionada: categoria });
});

// Detalle de un producto
app.get('/producto/:id', verificarSesion, async (req, res) => {
    const producto = await db.get(`
        SELECT productos.*, usuarios.taller_nombre 
        FROM productos 
        JOIN usuarios ON productos.vendedor_id = usuarios.id 
        WHERE productos.id = ?`, [req.params.id]);

    if (!producto) return res.status(404).send("Producto no encontrado");
    res.render('producto-detalle', { producto });
});

// ==========================================
// 4. RUTAS DE ARTESANO (Protección Doble)
// ==========================================

app.get('/mis-productos', verificarSesion, async (req, res) => {
    if (req.session.rol !== 'artesano') return res.status(403).send("Acceso denegado");
    
    const misProductos = await db.all('SELECT * FROM productos WHERE vendedor_id = ?', [req.session.usuarioId]);
    res.render('panel-artesano', { productos: misProductos });
});

app.post('/productos/nuevo', verificarSesion, async (req, res) => {
    if (req.session.rol !== 'artesano') return res.send("No autorizado");
    const { nombre, descripcion, precio, stock, categoria, variantes } = req.body;

    await db.run(
        'INSERT INTO productos (nombre, descripcion, precio, stock, categoria, variantes, vendedor_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [nombre, descripcion, precio, stock, categoria, variantes, req.session.usuarioId]
    );
    res.redirect('/mis-productos');
});

app.get('/productos/editar/:id', verificarSesion, async (req, res) => {
    if (req.session.rol !== 'artesano') return res.redirect('/login');
    const producto = await db.get('SELECT * FROM productos WHERE id = ? AND vendedor_id = ?', [req.params.id, req.session.usuarioId]);
    if (!producto) return res.send("No tienes permiso.");
    res.render('editar-producto', { producto });
});

app.post('/productos/editar/:id', verificarSesion, async (req, res) => {
    if (req.session.rol !== 'artesano') return res.send("No autorizado");
    const { nombre, descripcion, precio, stock, categoria, variantes } = req.body;
    await db.run(
        `UPDATE productos SET nombre=?, descripcion=?, precio=?, stock=?, categoria=?, variantes=? 
         WHERE id=? AND vendedor_id=?`,
        [nombre, descripcion, precio, stock, categoria, variantes, req.params.id, req.session.usuarioId]
    );
    res.redirect('/mis-productos');
});

// ==========================================
// 5. RUTA DE ADMIN
// ==========================================
app.get('/admin', verificarSesion, async (req, res) => {
    if (req.session.rol !== 'admin') return res.send("Acceso denegado");
    const usuarios = await db.all('SELECT id, nombre, email, rol FROM usuarios');
    const total = await db.get('SELECT COUNT(*) as total FROM productos');
    res.render('admin-panel', { usuarios, totalProductos: total.total }); // Asumiendo que crearás admin-panel.ejs
});