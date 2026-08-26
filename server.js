const express = require("express");
const mysql = require("mysql2");
const bodyParser = require("body-parser");
const cors = require("cors");
const { generarQRMateriales } = require("./generar_qr.js");

const app = express();

app.use(bodyParser.json());
app.use(cors());

// =============================================================================
// Pool de conexiones (igual que ya tenías, sin cambios).
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
// FIX NECESARIO EN LA BASE DE DATOS (ejecutar una sola vez en tu MySQL):
// -----------------------------------------------------------------------------
// La tabla "prestamos" necesita una columna para guardar la fecha límite de
// devolución (fecha_prestamo + 5 días). Sin esta columna no se puede saber
// cuándo vence un préstamo.
//
//   ALTER TABLE prestamos ADD COLUMN fecha_limite DATETIME NULL;
//
// Si tu tabla "materiales" NO tiene ya una columna "cantidad" (sí la tiene,
// según tu código original), no hace falta nada más ahí.
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

app.post("/login", (req, res) => {
    const { usuario, clave } = req.body;
    const sql = "SELECT * FROM usuarios WHERE usuario = ? AND clave = ?";

    conexion.query(sql, [usuario, clave], (err, result) => {
        if (err) {
            res.json({ status: "error", mensaje: err });
        } else if (result.length > 0) {
            res.json({ status: "ok", rol: result[0].rol });
        } else {
            res.json({ status: "fail", mensaje: "Credenciales incorrectas" });
        }
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
// FIX PRINCIPAL — POST /prestamos
// -----------------------------------------------------------------------------
// Ahora este endpoint, al registrar un préstamo:
//   1) Verifica que el material tenga stock (cantidad > 0). Si no, rechaza.
//   2) Calcula fecha_limite = fecha_prestamo + 5 días.
//   3) Inserta el préstamo con fecha_prestamo (hora exacta del escaneo) y
//      fecha_limite.
//   4) Descuenta 1 unidad de materiales.cantidad.
// Todo en una transacción para evitar inconsistencias si algo falla a mitad
// de camino (p. ej. se inserta el préstamo pero no se descuenta el stock).
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

                // Bloquea la fila del material para evitar condiciones de
                // carrera si dos escaneos llegan casi al mismo tiempo.
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
// FIX — Devolución manual por ID de préstamo (botón "Devolver" en Flutter).
// Ahora también repone 1 unidad al inventario, en transacción.
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
// FIX PRINCIPAL — PUT /prestamos/devolver-qr/:material_id
// -----------------------------------------------------------------------------
// Este es el endpoint que llama EscaneoQR en el SEGUNDO escaneo. Ahora también
// repone 1 unidad al inventario dentro de una transacción, además de marcar
// el préstamo como devuelto (igual que antes).
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

app.get("/reportes/total", (req, res) => {
    const sql = "SELECT COUNT(*) AS total FROM prestamos";
    conexion.query(sql, (err, result) => {
        if (err) res.json({ status: "error", mensaje: err });
        else res.json(result[0]);
    });
});

app.get("/reportes/pendientes", (req, res) => {
    const sql = "SELECT COUNT(*) AS pendientes FROM prestamos WHERE devuelto = 0";
    conexion.query(sql, (err, result) => {
        if (err) res.json({ status: "error", mensaje: err });
        else res.json(result[0]);
    });
});

app.get("/reportes/devueltos", (req, res) => {
    const sql = "SELECT COUNT(*) AS devueltos FROM prestamos WHERE devuelto = 1";
    conexion.query(sql, (err, result) => {
        if (err) res.json({ status: "error", mensaje: err });
        else res.json(result[0]);
    });
});

// =============================================================================
// Guía 12: Reportes filtrados con exportación a PDF/Excel (sin cambios)
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

app.get("/reportes/pdf", (req, res) => {
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

app.get("/reportes/excel", async (req, res) => {
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

if (require.main === module) {
    app.listen(3000, () => {
        console.log("Servidor local en http://localhost:3000");
    });
}

module.exports = app;