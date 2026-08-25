const express = require("express");
const mysql = require("mysql2");
const bodyParser = require("body-parser");
const cors = require("cors");
const { generarQRMateriales } = require("./generar_qr.js");

const app = express();

app.use(bodyParser.json());
app.use(cors());

const conexion = mysql.createConnection({
    host: "b7mbqylgdnfyz4tlqekm-mysql.services.clever-cloud.com",
    user: "uea1zze9enn2xxe4",
    password: "d9MgB6DCy5Bp4tPNWnPd",
    database: "b7mbqylgdnfyz4tlqekm"
});

conexion.connect(err => {
    if (err) throw err;
    console.log("Conectado a MariaDB (XAMPP)");
});

app.get("/", (req, res) => {
    res.send("Bienvenido a Inventario API");
});

// =============================================================================
// Guía 11: Generación de códigos QR para materiales.
// -----------------------------------------------------------------------------
// La lógica de generación vive en el archivo aparte "generar_qr.js"; aquí
// solo se importa y se expone como endpoint.
//
// CAMBIO (Vercel): los QR ya NO se guardan en disco ni se sirven como
// archivos estáticos locales (Vercel no permite escribir en el filesystem
// del proyecto). Ahora "generarQRMateriales" sube cada PNG a Vercel Blob,
// dentro de la carpeta "qr_materiales/", y devuelve directamente las URLs
// públicas de Blob. Por eso ya no existe el app.use("/qr", express.static(...))
// ni la carpeta física "qr_materiales" en el servidor: las URLs que llegan
// en "archivos" ya son enlaces completos y listos para usar (<img src=...>,
// descarga directa, etc.).
//
// Cómo usarlo:
//   1) Instala las librerías una sola vez: npm install qrcode @vercel/blob
//   2) Conecta un Blob Store al proyecto en Vercel (Storage > Blob > Connect
//      Project) para que exista la variable de entorno BLOB_READ_WRITE_TOKEN.
//   3) Con el servidor corriendo (o desplegado), visita:
//        https://<tu-dominio>.vercel.app/generar-qr
//   4) La respuesta trae "archivos": un arreglo de URLs de Vercel Blob, una
//      por cada material, ej:
//        https://<store>.public.blob.vercel-storage.com/qr_materiales/material_1_taladro.png
//   5) Repite el paso 3 cada vez que agregues materiales nuevos.
// =============================================================================
app.get("/qr_materiales", (req, res) => {
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

    conexion.query(
        sql,
        [nombre, cantidad, estado],
        (err, result) => {
            if (err) {
                res.json({ status: "error", mensaje: err });
            } else {
                res.json({ status: "ok", mensaje: "Material registrado" });
            }
        }
    );
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

// Lista los usuarios con rol "maestro" para poblar el selector en
// RegistroPrestamo — así el nombre siempre coincide EXACTO con
// usuarios.usuario y las notificaciones nunca vuelven a desincronizarse.
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
// Guía 10: Roles avanzados y permisos
// -----------------------------------------------------------------------------
// Tabla "permisos" (crear en MySQL Workbench / phpMyAdmin de Xampp):
//
// CREATE TABLE permisos (
//   id INT AUTO_INCREMENT PRIMARY KEY,
//   maestro VARCHAR(50),
//   material_id INT,
//   puede_ver BOOLEAN DEFAULT TRUE,
//   puede_prestar BOOLEAN DEFAULT FALSE,
//   puede_devolver BOOLEAN DEFAULT FALSE,
//   FOREIGN KEY (material_id) REFERENCES materiales(id)
// );
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
                (err2, result2) => {
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
                (err2, result2) => {
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

// Endpoint de diagnóstico (temporal): muestra todos los permisos con el
// nombre EXACTO del maestro (con corchetes para ver espacios ocultos) y el
// tipo real de cada valor puede_*, para detectar por qué un permiso ya
// asignado no está siendo reconocido por /prestamos o /prestamos/devolver-qr.
// Visítalo en el navegador: http://192.168.1.101:3000/debug/permisos
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
    conexion.query(sql, [req.params.id], (err, result) => {
        if (err) {
            res.json({ status: "error", mensaje: err });
        } else {
            res.json({ status: "ok", mensaje: "Permiso eliminado" });
        }
    });
});

// Guía 10: valida puede_prestar antes de insertar el préstamo.
// Guía 8: no se inserta fecha_devolucion. Queda NULL y devuelto = 0.
// Guía 11: este mismo endpoint es el que llama la pantalla EscaneoQR al
// escanear el QR de un material para registrar el préstamo.
app.post("/prestamos", (req, res) => {
    const { material_id, fecha_prestamo, maestro } = req.body;

    // Excepción: el maestro "juan" puede prestar cualquier material sin
    // necesidad de tener un permiso asignado en la tabla permisos.
    const esMaestroSinRestriccion =
        maestro && maestro.toString().trim().toLowerCase() === "juan";

    if (esMaestroSinRestriccion) {
        console.log(`[prestamos] "${maestro}" es maestro sin restricción — se omite validación de permiso`);
        const sqlDirecto = `
            INSERT INTO prestamos (material_id, fecha_prestamo, maestro, devuelto)
            VALUES (?, ?, ?, 0)
        `;
        conexion.query(sqlDirecto, [material_id, fecha_prestamo, maestro], (errDirecto) => {
            if (errDirecto) {
                res.json({ status: "error", mensaje: errDirecto });
            } else {
                res.json({ status: "ok", mensaje: "Préstamo registrado" });
            }
        });
        return;
    }

    // Se usa LOWER(TRIM(...)) en ambos lados para que diferencias de
    // mayúsculas o espacios entre el usuario logueado y el "maestro"
    // guardado en la tabla permisos no provoquen un falso "sin permiso".
    // También se acepta puede_prestar como 1, '1' o true (no solo TRUE),
    // por si el valor llegó como texto desde algún cliente.
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

        const sql = `
            INSERT INTO prestamos (material_id, fecha_prestamo, maestro, devuelto)
            VALUES (?, ?, ?, 0)
        `;
        conexion.query(sql, [material_id, fecha_prestamo, maestro], (err2, result2) => {
            if (err2) {
                res.json({ status: "error", mensaje: err2 });
            } else {
                res.json({ status: "ok", mensaje: "Préstamo registrado" });
            }
        });
    });
});

app.get("/prestamos", (req, res) => {
    const sql = `
        SELECT prestamos.id, materiales.nombre AS material,
        prestamos.fecha_prestamo, prestamos.fecha_devolucion, prestamos.maestro, prestamos.devuelto
        FROM prestamos
        INNER JOIN materiales ON prestamos.material_id = materiales.id
        WHERE prestamos.devuelto = 0
    `;

    conexion.query(sql, (err, result) => {
        if (err) {
            res.json({ status: "error", mensaje: err });
        } else {
            res.json(result);
        }
    });
});

// Devolución manual por ID de préstamo (botón "Devolver" en ListaPrestamos).
// Guía 10: valida puede_devolver antes de actualizar.
app.put("/prestamos/devolver/:id", (req, res) => {
    const idPrestamo = req.params.id;

    const sqlPrestamo = "SELECT material_id, maestro FROM prestamos WHERE id = ?";

    conexion.query(sqlPrestamo, [idPrestamo], (err, resultPrestamo) => {
        if (err) {
            res.json({ status: "error", mensaje: err });
            return;
        }

        if (resultPrestamo.length === 0) {
            res.json({ status: "fail", mensaje: "Préstamo no encontrado" });
            return;
        }

        const { material_id, maestro } = resultPrestamo[0];

        function marcarDevuelto() {
            const sqlActualizar = "UPDATE prestamos SET devuelto = 1, fecha_devolucion = NOW() WHERE id = ?";
            conexion.query(sqlActualizar, [idPrestamo], (err3, result3) => {
                if (err3) {
                    res.json({ status: "error", mensaje: err3 });
                } else {
                    res.json({ status: "ok", mensaje: "Material devuelto" });
                }
            });
        }

        // Excepción: el maestro "juan" puede devolver cualquier material
        // sin necesidad de tener un permiso asignado en la tabla permisos.
        const esMaestroSinRestriccion =
            maestro && maestro.toString().trim().toLowerCase() === "juan";

        if (esMaestroSinRestriccion) {
            console.log(`[prestamos/devolver] "${maestro}" es maestro sin restricción — se omite validación de permiso`);
            marcarDevuelto();
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

            marcarDevuelto();
        });
    });
});

// =============================================================================
// Guía 11: Devolución automática vía escaneo de QR.
// -----------------------------------------------------------------------------
// El maestro escanea el mismo QR del material que usó para el préstamo.
// A diferencia de /prestamos/devolver/:id (que usa el ID del préstamo), este
// endpoint recibe el ID del MATERIAL y busca el préstamo pendiente (devuelto
// = 0) más reciente de ESE maestro para ese material. Esto es necesario
// porque el QR pegado en el material solo contiene el material_id, no el id
// del préstamo específico.
//
// También se valida puede_devolver, igual que el endpoint manual, para
// mantener consistente el sistema de permisos de la Guía 10.
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
            const sqlActualizar = "UPDATE prestamos SET devuelto = 1, fecha_devolucion = NOW() WHERE id = ?";
            conexion.query(sqlActualizar, [idPrestamo], (err3) => {
                if (err3) {
                    res.json({ status: "error", mensaje: err3 });
                } else {
                    res.json({ status: "ok", mensaje: "Material devuelto correctamente" });
                }
            });
        });
    }

    // Excepción: el maestro "juan" puede devolver cualquier material sin
    // necesidad de tener un permiso asignado en la tabla permisos.
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

// =============================================================================
// Guía 9: Notificaciones automáticas de préstamos pendientes por maestro.
// =============================================================================
app.get("/notificaciones/:maestro", (req, res) => {
    const maestro = req.params.maestro.trim();
    console.log(`[notificaciones] Consultando pendientes para maestro: "${maestro}"`);

    const sql = `
        SELECT prestamos.id, materiales.nombre AS material,
        prestamos.fecha_prestamo, prestamos.fecha_devolucion, prestamos.maestro
        FROM prestamos
        INNER JOIN materiales ON prestamos.material_id = materiales.id
        WHERE LOWER(TRIM(prestamos.maestro)) = LOWER(TRIM(?))
        AND prestamos.fecha_devolucion IS NULL
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
// Guía 12: Reportes filtrados con exportación a PDF/Excel
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
        prestamos.fecha_prestamo, prestamos.fecha_devolucion,
        prestamos.maestro, prestamos.devuelto
        FROM prestamos
        INNER JOIN materiales ON prestamos.material_id = materiales.id
        WHERE 1=1 ${whereSQL}
        ORDER BY prestamos.fecha_prestamo DESC
    `;

    conexion.query(sql, valores, (err, result) => {
        if (err) {
            res.status(500).json({ status: "error", mensaje: err });
            return;
        }

        const doc = new PDFDocument({ margin: 40 });
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", "attachment; filename=reporte.pdf");
        doc.pipe(res);

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
            doc.text(`Devolución: ${p.fecha_devolucion || "Pendiente"}`);
            doc.text(`Estado: ${p.devuelto ? "Devuelto" : "Pendiente"}`);
            doc.moveDown(0.8);
            doc.fillColor("black").fontSize(11);
        });

        if (result.length === 0) {
            doc.text("No se encontraron registros con los filtros aplicados.");
        }

        doc.end();
    });
});

app.get("/reportes/excel", async (req, res) => {
    const { whereSQL, valores } = construirFiltro(req);

    const sql = `
        SELECT prestamos.id, materiales.nombre AS material,
        prestamos.fecha_prestamo, prestamos.fecha_devolucion,
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

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Préstamos");

        sheet.columns = [
            { header: "Material", key: "material", width: 25 },
            { header: "Maestro", key: "maestro", width: 20 },
            { header: "Fecha Préstamo", key: "fecha_prestamo", width: 22 },
            { header: "Fecha Devolución", key: "fecha_devolucion", width: 22 },
            { header: "Estado", key: "estado", width: 15 },
        ];

        sheet.getRow(1).font = { bold: true };
        sheet.getRow(1).fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FF2F6FED" },
        };
        sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };

        result.forEach((p) => {
            sheet.addRow({
                material: p.material,
                maestro: p.maestro,
                fecha_prestamo: p.fecha_prestamo,
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
    });
});

app.listen(3000, () => {
    console.log("Servidor en http://192.168.1.101:3000");
});