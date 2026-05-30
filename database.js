const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function setup() {
    const db = await open({
        filename: './database_v2.db', 
        driver: sqlite3.Database
    });

    await db.exec(`
    CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT,
        email TEXT UNIQUE,
        password TEXT,
        rol TEXT DEFAULT 'cliente',
        taller_nombre TEXT, 
        bio TEXT,
        -- Datos Bancarios para Artesanos --
        banco_nombre TEXT,      -- Ej: Visión, Itaú, Continental
        cuenta_tipo TEXT,       -- Ej: Ahorro, Corriente
        cuenta_numero TEXT,     -- El número de cuenta real
        nombre_titular TEXT,    -- [NUEVO] Nombre legal del dueño de la cuenta
        titular_documento TEXT, -- CI o RUC del titular
        alias_pago TEXT         -- Alias de transferencia (opcional)
    )
`);

    // 1. Tabla de Productos:
    await db.exec(`
        CREATE TABLE IF NOT EXISTS productos (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT,
            descripcion TEXT,
            precio REAL,
            stock INTEGER,
            variantes TEXT,   -- Ejemplo: "Rojo, Azul / S, M, L"
            categoria TEXT,   -- Ejemplo: "Cerámica", "Tejidos"
            vendedor_id INTEGER,
            FOREIGN KEY(vendedor_id) REFERENCES usuarios(id)
        )
    `);

    // 2. Tabla de Imágenes de los Productos:
    await db.exec(`
        CREATE TABLE IF NOT EXISTS producto_imagenes (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            producto_id INTEGER,
            ruta TEXT NOT NULL,
            FOREIGN KEY (producto_id) REFERENCES productos(id) ON DELETE CASCADE
        )
    `);

    // 3. Tabla de Carrito
    await db.exec(`
        CREATE TABLE IF NOT EXISTS carrito (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            usuario_id INTEGER,
            producto_id INTEGER,
            cantidad INTEGER DEFAULT 1,
            FOREIGN KEY(usuario_id) REFERENCES usuarios(id),
            FOREIGN KEY(producto_id) REFERENCES productos(id)
        )
    `);

    // 4. Tabla de Pedidos
    await db.exec(`
    CREATE TABLE IF NOT EXISTS pedidos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        usuario_id INTEGER,
        fecha TEXT DEFAULT CURRENT_TIMESTAMP,
        total REAL,
        estado TEXT DEFAULT 'pendiente', 
        metodo_pago TEXT,
        comprobante_ruta TEXT, -- [NUEVO] Para guardar el nombre del archivo .jpg/.png
        estado_pago TEXT DEFAULT 'verificación pendiente', -- [NUEVO] Control del artesano
        direccion TEXT, 
        telefono TEXT,  
        FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
    )
`);

    // 5. Detalle de Pedidos
    await db.exec(`
    CREATE TABLE IF NOT EXISTS pedido_detalles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        pedido_id INTEGER,
        producto_id INTEGER,
        vendedor_id INTEGER, 
        cantidad INTEGER,
        precio_unitario REAL, 
        FOREIGN KEY(pedido_id) REFERENCES pedidos(id),
        FOREIGN KEY(producto_id) REFERENCES productos(id),
        FOREIGN KEY(vendedor_id) REFERENCES usuarios(id)
    )
`);

    return db;
}

module.exports = { setup };