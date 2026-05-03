const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function setup() {
    const db = await open({
        filename: './database_v2.db', 
        driver: sqlite3.Database
    });

    // Tabla de Usuarios: Añadimos campos para el Perfil Comercial (HU15)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS usuarios (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            nombre TEXT,
            email TEXT UNIQUE,
            password TEXT,
            rol TEXT DEFAULT 'cliente',
            taller_nombre TEXT, -- Nombre de la tienda del artesano
            bio TEXT            -- Descripción o historia del taller
        )
    `);

    // Tabla de Productos: Añadimos Variantes (HU12) y Categoría (HU4)
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

    // --- NUEVAS TABLAS PARA EL SPRINT 3 ---

    // 3. Tabla de Carrito: Para persistencia de compras no finalizadas (Punto 5)
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
            estado TEXT DEFAULT 'pendiente', -- pendiente, pagado, enviado, entregado
            metodo_pago TEXT,                -- efectivo, transferencia, tarjeta
            direccion TEXT, 
            telefono TEXT,  
            FOREIGN KEY(usuario_id) REFERENCES usuarios(id)
        )
    `);

    // 5. Detalle de Pedidos: Relación N:M entre Pedidos y Productos (Punto 6)
    await db.exec(`
        CREATE TABLE IF NOT EXISTS pedido_detalles (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pedido_id INTEGER,
            producto_id INTEGER,
            cantidad INTEGER,
            precio_unitario REAL, -- Guardamos el precio del momento de la compra
            FOREIGN KEY(pedido_id) REFERENCES pedidos(id),
            FOREIGN KEY(producto_id) REFERENCES productos(id)
        )
    `);

    console.log("Base de datos actualizada con campos para HU.");
    return db;
}

module.exports = { setup };