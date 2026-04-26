const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

async function setup() {
    const db = await open({
        filename: './database.db', 
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

    console.log("Base de datos actualizada con campos para HU.");
    return db;
}

module.exports = { setup };