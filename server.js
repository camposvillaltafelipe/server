const express = require("express");
const mysql = require("mysql2");
const bodyParser = require("body-parser");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { generarQRMateriales } = require("./generar_qr.js");

const app = express();

app.use(bodyParser.json());
app.use(cors());

// =============================================================================
// Guía 13: clave secreta para firmar/verificar tokens JWT.
// En un proyecto real esto iría en una variable de entorno, pero para el
// curso se deja aquí como constante, igual que en la guía.
// =============================================================================
const SECRET = "clave_secreta_inventario";

// =============================================================================
// Pool de conexiones (sin cambios).
// =============================================================================
const conexion = mysql.createPool({
    host: "b7mbqylgdnfyz4tlqekm-mysql.services.clever-cloud.com",
    user: "uea1zze9enn2xxe4",
    password: "d9MgB6DCy5Bp4tPNWnPd",
    database: "b7mbqylgdnfyz4tlqekm",
    waitForConnections: true,
    connectionLimit: 5,
    queueLimit: 0,
    connectTimeout: 10000,
    enableKeepAlive: true,
    keepAliveInitialDelay: 10000
});

conexion.getConnection((err, connTest) => {
    if (err) {
        console.error("No se pudo conectar al pool de MariaDB:", err.message);
        return;
    }
    console.log("Conectado a MariaDB (pool)");
    connTest.release();
});

app.get("/", (req, res) => {
    res.send("Bienvenido a Inventario API");
});

// =============================================================================
// Guía 13 — MIDDLEWARE de autenticación
// -----------------------------------------------------------------------------
// Se usa en las rutas que quieras proteger. Lee el token del header
// "Authorization", lo valida, y si es correcto continúa la petición dejando
// disponible req.usuario = { usuario, rol } para la ruta siguiente.
//
// El Flutter envía el token así en cada petición protegida:
//   headers: {"Authorization": token}
// =============================================================================
function verificarToken(req, res, next) {
    const token = req.headers["authorization"];
    if (!token) {
        return res.status(401).json({ status: "error", mensaje: "Token requerido" });
    }
    jwt.verify(token, SECRET, (err, decoded) => {
        if (err) {
            return res.status(401).json({ status: "error", mensaje: "Token inválido o expirado" });
        }
        req.usuario = decoded;
        next();
    });
}

// Middleware adicional: solo deja pasar si el rol es "administrador".
function soloAdmin(req, res, next) {
    if (!req.usuario || req.usuario.rol !== "administrador") {
        return res.status(403).json({ status: "error", mensaje: "Acceso denegado: solo administradores" });
    }
    next();
}

// =============================================================================
// FIX NECESARIO EN LA BASE DE DATOS (ejecutar una sola vez, ver
// guia13_ajuste_usuarios.sql):
//   ALTER TABLE usuarios MODIFY COLUMN clave VARCHAR(255) NOT NULL;
// =============================================================================

app.get("/generar_qr", (req, res) => {
    conexion.query("SELECT id, nombre FROM materiales", (err, materiales) => {
        if (err) {
            res.json({ status: "error", mensaje: err });
            return;
        }

        if (materiales.length === 0) {
            res.json({ status: "fail", mensaje: "No hay materiales registrados todavía" });
            return;
        }

        generarQRMateriales(materiales, (errQR, archivos) => {
            if (errQR) {
                res.json({ status: "error", mensaje: errQR.message || errQR });
                return;
            }
            res.json({
                status: "ok",
                mensaje: `${materiales.length} código(s) QR generado(s)`,
                archivos: archivos
            });
        });
    });
});

app.post("/materiales", (req, res) => {
    const { nombre, cantidad, estado } = req.body;

    const sql = `
        INSERT INTO materiales (nombre, cantidad, estado)
        VALUES (?, ?, ?)
    `;

    conexion.query(sql, [nombre, cantidad, estado], (err, result) => {
        if (err) {
            res.json({ status: "error", mensaje: err });
        } else {
            res.json({ status: "ok", mensaje: "Material registrado" });
        }
    });
});

app.get("/materiales", (req, res) => {
    const sql = "SELECT id, nombre, cantidad, estado FROM materiales";
    conexion.query(sql, (err, result) => {
        if (err) {
            res.json({ status: "error", mensaje: err });
        } else {
            res.json(result);
        }
    });
});

// =============================================================================
// Guía 13 — REGISTRO de usuario con clave encriptada.
// -----------------------------------------------------------------------------
// Adaptado a TU esquema real: usuario (no correo), clave (no password),
// rol = 'administrador' | 'maestro' (no 'admin').
// =============================================================================
app.post("/registro", (req, res) => {
    const { usuario, clave, rol } = req.body;

    if (!usuario || !clave || !rol) {
        res.json({ status: "fail", mensaje: "Faltan datos: usuario, clave y rol son requeridos" });
        return;
    }

    if (rol !== "administrador" && rol !== "maestro") {
        res.json({ status: "fail", mensaje: "Rol inválido: debe ser 'administrador' o 'maestro'" });
        return;
    }

    const claveEncriptada = bcrypt.hashSync(clave, 8);
    const sql = "INSERT INTO usuarios (usuario, clave, rol) VALUES (?, ?, ?)";

    conexion.query(sql, [usuario, claveEncriptada, rol], (err, result) => {
        if (err) {
            if (err.code === "ER_DUP_ENTRY") {
                res.json({ status: "fail", mensaje: "Ese nombre de usuario ya existe" });
            } else {
                res.json({ status: "error", mensaje: err.message || err });
            }
        } else {
            res.json({ status: "ok", mensaje: "Usuario registrado" });
        }
    });
});

// =============================================================================
// Guía 13 — LOGIN con bcrypt + JWT.
// -----------------------------------------------------------------------------
// Reemplaza el login anterior (que comparaba la clave en texto plano).
// Ahora compara el hash con bcrypt.compareSync y devuelve un token JWT válido
// por 4 horas (suficiente para una jornada de clases).
// =============================================================================
app.post("/login", (req, res) => {
    const { usuario, clave } = req.body;

    if (!usuario || !clave) {
        res.json({ status: "fail", mensaje: "Ingresa usuario y contraseña" });
        return;
    }

    const sql = "SELECT * FROM usuarios WHERE usuario = ?";

    conexion.query(sql, [usuario], (err, result) => {
        if (err) {
            res.json({ status: "error", mensaje: err.message || err });
            return;
        }

        if (result.length === 0) {
            res.json({ status: "fail", mensaje: "Credenciales incorrectas" });
            return;
        }

        const usuarioDb = result[0];
        const claveValida = bcrypt.compareSync(clave, usuarioDb.clave);

        if (!claveValida) {
            res.json({ status: "fail", mensaje: "Credenciales incorrectas" });
            return;
        }

        const token = jwt.sign(
            { usuario: usuarioDb.usuario, rol: usuarioDb.rol },
            SECRET,
            { expiresIn: "4h" }
        );

        res.json({
            status: "ok",
            rol: usuarioDb.rol,
            token: token
        });
    });
});

app.get("/maestros", (req, res) => {
    const sql = "SELECT usuario FROM usuarios WHERE rol = 'maestro'";
    conexion.query(sql, (err, result) => {
        if (err) {
            res.json({ status: "error", mensaje: err });
        } else {
            res.json(result);
        }
    });
});

// =============================================================================
// Guía 10: Roles avanzados y permisos (sin cambios respecto a tu versión)
// =============================================================================

app.post("/permisos", (req, res) => {
    const { maestro, material_id, puede_ver, puede_prestar, puede_devolver } = req.body;

    if (!maestro || !material_id) {
        res.json({ status: "fail", mensaje: "Faltan datos: maestro y material_id son requeridos" });
        return;
    }

    const sqlBuscar = "SELECT id FROM permisos WHERE maestro = ? AND material_id = ?";

    conexion.query(sqlBuscar, [maestro, material_id], (err, result) => {
        if (err) {
            res.json({ status: "error", mensaje: err });
            return;
        }

        if (result.length > 0) {
            const sqlActualizar = `
                UPDATE permisos
                SET puede_ver = ?, puede_prestar = ?, puede_devolver = ?
                WHERE maestro = ? AND material_id = ?
            `;
            conexion.query(
                sqlActualizar,
                [puede_ver, puede_prestar, puede_devolver, maestro, material_id],
                (err2) => {
                    if (err2) {
                        res.json({ status: "error", mensaje: err2 });
                    } else {
                        res.json({ status: "ok", mensaje: "Permiso actualizado" });
                    }
                }
            );
        } else {
            const sqlInsertar = `
                INSERT INTO permisos (maestro, material_id, puede_ver, puede_prestar, puede_devolver)
                VALUES (?, ?, ?, ?, ?)
            `;
            conexion.query(
                sqlInsertar,
                [maestro, material_id, puede_ver, puede_prestar, puede_devolver],
                (err2) => {
                    if (err2) {
                        res.json({ status: "error", mensaje: err2 });
                    } else {
                        res.json({ status: "ok", mensaje: "Permiso asignado" });
                    }
                }
            );
        }
    });
});

app.get("/permisos", (req, res) => {
    const sql = `
        SELECT permisos.id, permisos.maestro, permisos.material_id,
        materiales.nombre AS material, permisos.puede_ver,
        permisos.puede_prestar, permisos.puede_devolver
        FROM permisos
        INNER JOIN materiales ON permisos.material_id = materiales.id
        ORDER BY permisos.maestro, materiales.nombre
    `;
    conexion.query(sql, (err, result) => {
        if (err) {
            res.json({ status: "error", mensaje: err });
        } else {
            res.json(result);
        }
    });
});

app.get("/debug/permisos", (req, res) => {
    const sql = `
        SELECT permisos.id, permisos.maestro, permisos.material_id,
        materiales.nombre AS material, permisos.puede_ver,
        permisos.puede_prestar, permisos.puede_devolver
        FROM permisos
        INNER JOIN materiales ON permisos.material_id = materiales.id
    `;
    conexion.query(sql, (err, result) => {
        if (err) {
            res.json({ status: "error", mensaje: err });
            return;
        }
        const detalle = result.map(p => ({
            id: p.id,
            maestro_exacto: `[${p.maestro}]`,
            material_id: p.material_id,
            material: p.material,
            puede_ver: `${p.puede_ver} (tipo: ${typeof p.puede_ver})`,
            puede_prestar: `${p.puede_prestar} (tipo: ${typeof p.puede_prestar})`,
            puede_devolver: `${p.puede_devolver} (tipo: ${typeof p.puede_devolver})`,
        }));
        res.json(detalle);
    });
});

app.delete("/permisos/:id", (req, res) => {
    const sql = "DELETE FROM permisos WHERE id = ?";
    conexion.query(sql, [req.params.id], (err) => {
        if (err) {
            res.json({ status: "error", mensaje: err });
        } else {
            res.json({ status: "ok", mensaje: "Permiso eliminado" });
        }
    });
});

// =============================================================================
// POST /prestamos — descuenta inventario y calcula fecha_limite (+5 días).
// =============================================================================
app.post("/prestamos", (req, res) => {
    const { material_id, fecha_prestamo, maestro } = req.body;

    if (!material_id || !maestro) {
        res.json({ status: "fail", mensaje: "Faltan datos: material_id y maestro son requeridos" });
        return;
    }

    const fechaPrestamoFinal = fecha_prestamo ? new Date(fecha_prestamo) : new Date();
    const fechaLimite = new Date(fechaPrestamoFinal);
    fechaLimite.setDate(fechaLimite.getDate() + 5);

    const esMaestroSinRestriccion =
        maestro && maestro.toString().trim().toLowerCase() === "juan";

    function continuarConPermisoValidado() {
        conexion.getConnection((errConn, cn) => {
            if (errConn) {
                res.json({ status: "error", mensaje: errConn.message || errConn });
                return;
            }

            cn.beginTransaction((errTx) => {
                if (errTx) {
                    cn.release();
                    res.json({ status: "error", mensaje: errTx.message || errTx });
                    return;
                }

                const sqlStock = "SELECT cantidad FROM materiales WHERE id = ? FOR UPDATE";
                cn.query(sqlStock, [material_id], (errStock, resultStock) => {
                    if (errStock) {
                        return cn.rollback(() => {
                            cn.release();
                            res.json({ status: "error", mensaje: errStock.message || errStock });
                        });
                    }

                    if (resultStock.length === 0) {
                        return cn.rollback(() => {
                            cn.release();
                            res.json({ status: "fail", mensaje: "Material no encontrado" });
                        });
                    }

                    const stockActual = resultStock[0].cantidad;

                    if (stockActual <= 0) {
                        return cn.rollback(() => {
                            cn.release();
                            res.json({ status: "fail", mensaje: "No hay unidades disponibles de este material" });
                        });
                    }

                    const sqlInsertar = `
                        INSERT INTO prestamos (material_id, fecha_prestamo, fecha_limite, maestro, devuelto)
                        VALUES (?, ?, ?, ?, 0)
                    `;
                    cn.query(
                        sqlInsertar,
                        [material_id, fechaPrestamoFinal, fechaLimite, maestro],
                        (errInsert) => {
                            if (errInsert) {
                                return cn.rollback(() => {
                                    cn.release();
                                    res.json({ status: "error", mensaje: errInsert.message || errInsert });
                                });
                            }

                            const sqlDescontar = "UPDATE materiales SET cantidad = cantidad - 1 WHERE id = ?";
                            cn.query(sqlDescontar, [material_id], (errUpdate) => {
                                if (errUpdate) {
                                    return cn.rollback(() => {
                                        cn.release();
                                        res.json({ status: "error", mensaje: errUpdate.message || errUpdate });
                                    });
                                }

                                cn.commit((errCommit) => {
                                    if (errCommit) {
                                        return cn.rollback(() => {
                                            cn.release();
                                            res.json({ status: "error", mensaje: errCommit.message || errCommit });
                                        });
                                    }

                                    cn.release();
                                    res.json({
                                        status: "ok",
                                        mensaje: `Préstamo registrado. Devolver antes del ${fechaLimite.toLocaleString()}`,
                                        fecha_limite: fechaLimite
                                    });
                                });
                            });
                        }
                    );
                });
            });
        });
    }

    if (esMaestroSinRestriccion) {
        console.log(`[prestamos] "${maestro}" es maestro sin restricción — se omite validación de permiso`);
        continuarConPermisoValidado();
        return;
    }

    const sqlPermiso = `
        SELECT * FROM permisos
        WHERE LOWER(TRIM(maestro)) = LOWER(TRIM(?))
        AND material_id = ?
        AND (puede_prestar = 1 OR puede_prestar = TRUE OR puede_prestar = '1')
    `;

    conexion.query(sqlPermiso, [maestro, material_id], (err, result) => {
        if (err) {
            res.json({ status: "error", mensaje: err });
            return;
        }

        console.log(`[prestamos] Verificando permiso -> maestro: "${maestro}", material_id: ${material_id}, resultado: ${result.length} fila(s)`);

        if (result.length === 0) {
            res.json({ status: "fail", mensaje: "No tienes permiso para prestar este material" });
            return;
        }

        continuarConPermisoValidado();
    });
});

app.get("/prestamos", (req, res) => {
    const sql = `
        SELECT prestamos.id, prestamos.material_id, materiales.nombre AS material,
        prestamos.fecha_prestamo, prestamos.fecha_limite, prestamos.fecha_devolucion,
        prestamos.maestro, prestamos.devuelto
        FROM prestamos
        INNER JOIN materiales ON prestamos.material_id = materiales.id
        WHERE prestamos.devuelto = 0
        ORDER BY prestamos.fecha_prestamo DESC
    `;

    conexion.query(sql, (err, result) => {
        if (err) {
            res.json({ status: "error", mensaje: err });
        } else {
            res.json(result);
        }
    });
});

// =============================================================================
// Devolución manual por ID — repone inventario, en transacción.
// =============================================================================
app.put("/prestamos/devolver/:id", (req, res) => {
    const idPrestamo = req.params.id;

    const sqlPrestamo = "SELECT material_id, maestro, devuelto FROM prestamos WHERE id = ?";

    conexion.query(sqlPrestamo, [idPrestamo], (err, resultPrestamo) => {
        if (err) {
            res.json({ status: "error", mensaje: err });
            return;
        }

        if (resultPrestamo.length === 0) {
            res.json({ status: "fail", mensaje: "Préstamo no encontrado" });
            return;
        }

        const { material_id, maestro, devuelto } = resultPrestamo[0];

        if (devuelto === 1) {
            res.json({ status: "fail", mensaje: "Este préstamo ya fue devuelto" });
            return;
        }

        function marcarDevueltoYReponer() {
            conexion.getConnection((errConn, cn) => {
                if (errConn) {
                    res.json({ status: "error", mensaje: errConn.message || errConn });
                    return;
                }

                cn.beginTransaction((errTx) => {
                    if (errTx) {
                        cn.release();
                        res.json({ status: "error", mensaje: errTx.message || errTx });
                        return;
                    }

                    const sqlActualizar = "UPDATE prestamos SET devuelto = 1, fecha_devolucion = NOW() WHERE id = ?";
                    cn.query(sqlActualizar, [idPrestamo], (err3) => {
                        if (err3) {
                            return cn.rollback(() => {
                                cn.release();
                                res.json({ status: "error", mensaje: err3.message || err3 });
                            });
                        }

                        const sqlReponer = "UPDATE materiales SET cantidad = cantidad + 1 WHERE id = ?";
                        cn.query(sqlReponer, [material_id], (err4) => {
                            if (err4) {
                                return cn.rollback(() => {
                                    cn.release();
                                    res.json({ status: "error", mensaje: err4.message || err4 });
                                });
                            }

                            cn.commit((errCommit) => {
                                if (errCommit) {
                                    return cn.rollback(() => {
                                        cn.release();
                                        res.json({ status: "error", mensaje: errCommit.message || errCommit });
                                    });
                                }
                                cn.release();
                                res.json({ status: "ok", mensaje: "Material devuelto" });
                            });
                        });
                    });
                });
            });
        }

        const esMaestroSinRestriccion =
            maestro && maestro.toString().trim().toLowerCase() === "juan";

        if (esMaestroSinRestriccion) {
            console.log(`[prestamos/devolver] "${maestro}" es maestro sin restricción — se omite validación de permiso`);
            marcarDevueltoYReponer();
            return;
        }

        const sqlPermiso = `
            SELECT * FROM permisos
            WHERE LOWER(TRIM(maestro)) = LOWER(TRIM(?))
            AND material_id = ?
            AND (puede_devolver = 1 OR puede_devolver = TRUE OR puede_devolver = '1')
        `;

        conexion.query(sqlPermiso, [maestro, material_id], (err2, resultPermiso) => {
            if (err2) {
                res.json({ status: "error", mensaje: err2 });
                return;
            }

            console.log(`[prestamos/devolver] Verificando permiso -> maestro: "${maestro}", material_id: ${material_id}, resultado: ${resultPermiso.length} fila(s)`);

            if (resultPermiso.length === 0) {
                res.json({ status: "fail", mensaje: "No tienes permiso para devolver este material" });
                return;
            }

            marcarDevueltoYReponer();
        });
    });
});

// =============================================================================
// Devolución vía escaneo QR (segundo escaneo) — repone inventario.
// =============================================================================
app.put("/prestamos/devolver-qr/:material_id", (req, res) => {
    const materialId = req.params.material_id;
    const { maestro } = req.body;

    if (!maestro) {
        res.json({ status: "fail", mensaje: "Falta el maestro que realiza la devolución" });
        return;
    }

    function buscarYDevolverPrestamo() {
        const sqlBuscarPrestamo = `
            SELECT id FROM prestamos
            WHERE material_id = ?
            AND LOWER(TRIM(maestro)) = LOWER(TRIM(?))
            AND devuelto = 0
            ORDER BY fecha_prestamo DESC
            LIMIT 1
        `;

        conexion.query(sqlBuscarPrestamo, [materialId, maestro], (err2, resultPrestamo) => {
            if (err2) {
                res.json({ status: "error", mensaje: err2 });
                return;
            }

            if (resultPrestamo.length === 0) {
                res.json({ status: "fail", mensaje: "No hay un préstamo pendiente de este material para este maestro" });
                return;
            }

            const idPrestamo = resultPrestamo[0].id;

            conexion.getConnection((errConn, cn) => {
                if (errConn) {
                    res.json({ status: "error", mensaje: errConn.message || errConn });
                    return;
                }

                cn.beginTransaction((errTx) => {
                    if (errTx) {
                        cn.release();
                        res.json({ status: "error", mensaje: errTx.message || errTx });
                        return;
                    }

                    const sqlActualizar = "UPDATE prestamos SET devuelto = 1, fecha_devolucion = NOW() WHERE id = ?";
                    cn.query(sqlActualizar, [idPrestamo], (err3) => {
                        if (err3) {
                            return cn.rollback(() => {
                                cn.release();
                                res.json({ status: "error", mensaje: err3.message || err3 });
                            });
                        }

                        const sqlReponer = "UPDATE materiales SET cantidad = cantidad + 1 WHERE id = ?";
                        cn.query(sqlReponer, [materialId], (err4) => {
                            if (err4) {
                                return cn.rollback(() => {
                                    cn.release();
                                    res.json({ status: "error", mensaje: err4.message || err4 });
                                });
                            }

                            cn.commit((errCommit) => {
                                if (errCommit) {
                                    return cn.rollback(() => {
                                        cn.release();
                                        res.json({ status: "error", mensaje: errCommit.message || errCommit });
                                    });
                                }
                                cn.release();
                                res.json({ status: "ok", mensaje: "Material devuelto correctamente" });
                            });
                        });
                    });
                });
            });
        });
    }

    const esMaestroSinRestriccion =
        maestro && maestro.toString().trim().toLowerCase() === "juan";

    if (esMaestroSinRestriccion) {
        console.log(`[prestamos/devolver-qr] "${maestro}" es maestro sin restricción — se omite validación de permiso`);
        buscarYDevolverPrestamo();
        return;
    }

    const sqlPermiso = `
        SELECT * FROM permisos
        WHERE LOWER(TRIM(maestro)) = LOWER(TRIM(?))
        AND material_id = ?
        AND (puede_devolver = 1 OR puede_devolver = TRUE OR puede_devolver = '1')
    `;

    conexion.query(sqlPermiso, [maestro, materialId], (err, resultPermiso) => {
        if (err) {
            res.json({ status: "error", mensaje: err });
            return;
        }

        console.log(`[prestamos/devolver-qr] Verificando permiso -> maestro: "${maestro}", material_id: ${materialId}, resultado: ${resultPermiso.length} fila(s)`);

        if (resultPermiso.length === 0) {
            res.json({ status: "fail", mensaje: "No tienes permiso para devolver este material" });
            return;
        }

        buscarYDevolverPrestamo();
    });
});

app.get("/notificaciones/:maestro", (req, res) => {
    const maestro = req.params.maestro.trim();
    console.log(`[notificaciones] Consultando pendientes para maestro: "${maestro}"`);

    const sql = `
        SELECT prestamos.id, materiales.nombre AS material,
        prestamos.fecha_prestamo, prestamos.fecha_limite, prestamos.fecha_devolucion, prestamos.maestro
        FROM prestamos
        INNER JOIN materiales ON prestamos.material_id = materiales.id
        WHERE LOWER(TRIM(prestamos.maestro)) = LOWER(TRIM(?))
        AND prestamos.devuelto = 0
    `;

    conexion.query(sql, [maestro], (err, result) => {
        if (err) {
            res.json({ status: "error", mensaje: err });
        } else {
            console.log(`[notificaciones] ${result.length} pendiente(s) encontrados`);
            res.json(result);
        }
    });
});

// =============================================================================
// Guía 13 — Rutas protegidas de ejemplo, tal como pide la guía:
//   "el administrador accede a funciones avanzadas (reportes, permisos)"
// Se protegen los reportes agregados con verificarToken + soloAdmin.
// Si tu Flutter aún no envía el header Authorization en estas rutas, estas
// llamadas devolverán 401; más abajo se explica cómo lo hace el nuevo main.dart.
// =============================================================================
app.get("/reportes/total", verificarToken, soloAdmin, (req, res) => {
    const sql = "SELECT COUNT(*) AS total FROM prestamos";
    conexion.query(sql, (err, result) => {
        if (err) res.json({ status: "error", mensaje: err });
        else res.json(result[0]);
    });
});

app.get("/reportes/pendientes", verificarToken, soloAdmin, (req, res) => {
    const sql = "SELECT COUNT(*) AS pendientes FROM prestamos WHERE devuelto = 0";
    conexion.query(sql, (err, result) => {
        if (err) res.json({ status: "error", mensaje: err });
        else res.json(result[0]);
    });
});

app.get("/reportes/devueltos", verificarToken, soloAdmin, (req, res) => {
    const sql = "SELECT COUNT(*) AS devueltos FROM prestamos WHERE devuelto = 1";
    conexion.query(sql, (err, result) => {
        if (err) res.json({ status: "error", mensaje: err });
        else res.json(result[0]);
    });
});

// =============================================================================
// Guía 12: Reportes filtrados con exportación a PDF/Excel — también
// protegidos, solo administrador.
// =============================================================================
const PDFDocument = require("pdfkit");
const ExcelJS = require("exceljs");

function construirFiltro(req) {
    const { maestro, fecha_inicio, fecha_fin } = req.query;
    let condiciones = [];
    let valores = [];

    if (maestro) {
        condiciones.push("LOWER(TRIM(prestamos.maestro)) = LOWER(TRIM(?))");
        valores.push(maestro);
    }
    if (fecha_inicio) {
        condiciones.push("prestamos.fecha_prestamo >= ?");
        valores.push(fecha_inicio);
    }
    if (fecha_fin) {
        condiciones.push("prestamos.fecha_prestamo <= ?");
        valores.push(fecha_fin);
    }

    const whereSQL = condiciones.length > 0 ? "AND " + condiciones.join(" AND ") : "";
    return { whereSQL, valores };
}

app.get("/reportes/pdf", verificarToken, soloAdmin, (req, res) => {
    const { whereSQL, valores } = construirFiltro(req);

    const sql = `
        SELECT prestamos.id, materiales.nombre AS material,
        prestamos.fecha_prestamo, prestamos.fecha_limite, prestamos.fecha_devolucion,
        prestamos.maestro, prestamos.devuelto
        FROM prestamos
        INNER JOIN materiales ON prestamos.material_id = materiales.id
        WHERE 1=1 ${whereSQL}
        ORDER BY prestamos.fecha_prestamo DESC
    `;

    let respondido = false;

    const timeoutId = setTimeout(() => {
        if (!respondido) {
            respondido = true;
            res.status(504).json({
                status: "error",
                mensaje: "Tiempo de espera agotado consultando la base de datos"
            });
        }
    }, 15000);

    conexion.query(sql, valores, (err, result) => {
        if (respondido) return;
        clearTimeout(timeoutId);

        if (err) {
            respondido = true;
            res.status(500).json({ status: "error", mensaje: err.message || err });
            return;
        }

        try {
            const doc = new PDFDocument({ margin: 40 });
            const chunks = [];

            doc.on("data", (chunk) => chunks.push(chunk));

            doc.on("end", () => {
                if (respondido) return;
                respondido = true;
                const pdfBuffer = Buffer.concat(chunks);
                res.setHeader("Content-Type", "application/pdf");
                res.setHeader("Content-Disposition", "attachment; filename=reporte.pdf");
                res.setHeader("Content-Length", pdfBuffer.length);
                res.status(200).send(pdfBuffer);
            });

            doc.on("error", (errPdf) => {
                if (respondido) return;
                respondido = true;
                res.status(500).json({ status: "error", mensaje: errPdf.message });
            });

            doc.fontSize(18).text("Reporte de Préstamos - Inventario Escolar", { align: "center" });
            doc.moveDown();
            doc.fontSize(10).fillColor("gray").text(`Generado: ${new Date().toLocaleString()}`, { align: "center" });
            doc.moveDown(1.5);

            doc.fillColor("black").fontSize(11);
            result.forEach((p, i) => {
                doc.font("Helvetica-Bold").text(`${i + 1}. ${p.material}`);
                doc.font("Helvetica").fontSize(10).fillColor("#333");
                doc.text(`Maestro: ${p.maestro}`);
                doc.text(`Préstamo: ${p.fecha_prestamo}`);
                doc.text(`Límite: ${p.fecha_limite || "N/A"}`);
                doc.text(`Devolución: ${p.fecha_devolucion || "Pendiente"}`);
                doc.text(`Estado: ${p.devuelto ? "Devuelto" : "Pendiente"}`);
                doc.moveDown(0.8);
                doc.fillColor("black").fontSize(11);
            });

            if (result.length === 0) {
                doc.text("No se encontraron registros con los filtros aplicados.");
            }

            doc.end();
        } catch (errGen) {
            if (respondido) return;
            respondido = true;
            res.status(500).json({ status: "error", mensaje: errGen.message || String(errGen) });
        }
    });
});

app.get("/reportes/excel", verificarToken, soloAdmin, async (req, res) => {
    const { whereSQL, valores } = construirFiltro(req);

    const sql = `
        SELECT prestamos.id, materiales.nombre AS material,
        prestamos.fecha_prestamo, prestamos.fecha_limite, prestamos.fecha_devolucion,
        prestamos.maestro, prestamos.devuelto
        FROM prestamos
        INNER JOIN materiales ON prestamos.material_id = materiales.id
        WHERE 1=1 ${whereSQL}
        ORDER BY prestamos.fecha_prestamo DESC
    `;

    conexion.query(sql, valores, async (err, result) => {
        if (err) {
            res.status(500).json({ status: "error", mensaje: err });
            return;
        }

        try {
            const workbook = new ExcelJS.Workbook();
            const sheet = workbook.addWorksheet("Préstamos");

            sheet.columns = [
                { header: "Material", key: "material", width: 25 },
                { header: "Maestro", key: "maestro", width: 20 },
                { header: "Fecha Préstamo", key: "fecha_prestamo", width: 22 },
                { header: "Fecha Límite", key: "fecha_limite", width: 22 },
                { header: "Fecha Devolución", key: "fecha_devolucion", width: 22 },
                { header: "Estado", key: "estado", width: 15 },
            ];

            sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
            sheet.getRow(1).fill = {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FF2F6FED" },
            };

            result.forEach((p) => {
                sheet.addRow({
                    material: p.material,
                    maestro: p.maestro,
                    fecha_prestamo: p.fecha_prestamo,
                    fecha_limite: p.fecha_limite || "N/A",
                    fecha_devolucion: p.fecha_devolucion || "Pendiente",
                    estado: p.devuelto ? "Devuelto" : "Pendiente",
                });
            });

            res.setHeader(
                "Content-Type",
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            );
            res.setHeader("Content-Disposition", "attachment; filename=reporte.xlsx");

            await workbook.xlsx.write(res);
            res.end();
        } catch (errGen) {
            res.status(500).json({ status: "error", mensaje: errGen.message || String(errGen) });
        }
    });
});

// =============================================================================
// Guía 13 — Endpoint de ejemplo protegido, tal como muestra la guía:
//   GET /admin/reportes → solo accesible con token de administrador.
// =============================================================================
app.get("/admin/reportes", verificarToken, (req, res) => {
    if (req.usuario.rol !== "administrador") {
        return res.status(403).json({ status: "error", mensaje: "Acceso denegado" });
    }
    res.json({ status: "ok", mensaje: `Bienvenido administrador ${req.usuario.usuario}` });
});

app.get("/dashboard", verificarToken, soloAdmin, (req, res) => {
    const sql = `
        SELECT
            (SELECT COUNT(*) FROM materiales) AS total_materiales,
            (SELECT COUNT(*) FROM prestamos WHERE devuelto = 0) AS prestados,
            (SELECT COUNT(*) FROM prestamos WHERE devuelto = 1) AS devueltos,
            (SELECT COUNT(*) FROM materiales WHERE estado = 'Dañado') AS danados
    `;

    conexion.query(sql, (err, result) => {
        if (err) {
            res.status(500).json({ status: "error", mensaje: err.message || err });
            return;
        }

        const fila = result[0] || {};
        res.json({
            status: "ok",
            total_materiales: fila.total_materiales ?? 0,
            prestados: fila.prestados ?? 0,
            devueltos: fila.devueltos ?? 0,
            danados: fila.danados ?? 0
        });
    });
});

if (require.main === module) {
    app.listen(3000, () => {
        console.log("Servidor local en http://localhost:3000");
    });
}

module.exports = app;