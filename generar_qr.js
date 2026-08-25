// =============================================================================
// generar_qr.js — Módulo de generación de códigos QR para materiales (Guía 11)
// -----------------------------------------------------------------------------
// Este archivo NO se ejecuta solo. Exporta una función que server.js importa
// y llama desde el endpoint GET /generar-qr.
//
// El contenido de cada QR es el "id" del material como texto plano, que es
// exactamente lo que esperan los endpoints /prestamos y
// /prestamos/devolver-qr/:material_id.
//
// Requiere: npm install qrcode
// =============================================================================

const QRCode = require("qrcode");
const fs = require("fs");
const path = require("path");

const carpetaQR = path.join(__dirname, "qr_materiales");

function limpiarNombre(nombre) {
    return nombre
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // quita acentos
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .toLowerCase();
}

// Genera un PNG de QR por cada material recibido y llama a callback(err, archivos)
// cuando termina. "materiales" debe ser el arreglo [{id, nombre}, ...] que
// devuelve la consulta "SELECT id, nombre FROM materiales".
function generarQRMateriales(materiales, callback) {
    if (!fs.existsSync(carpetaQR)) {
        fs.mkdirSync(carpetaQR);
    }

    if (!materiales || materiales.length === 0) {
        callback(null, []);
        return;
    }

    let generados = 0;
    const archivos = [];

    materiales.forEach((material) => {
        const contenidoQR = String(material.id);
        const nombreArchivo = `material_${material.id}_${limpiarNombre(material.nombre)}.png`;
        const rutaArchivo = path.join(carpetaQR, nombreArchivo);

        QRCode.toFile(
            rutaArchivo,
            contenidoQR,
            { color: { dark: "#000000", light: "#FFFFFF" }, width: 400 },
            (errQR) => {
                generados++;
                if (!errQR) {
                    archivos.push(`/qr/${nombreArchivo}`);
                }

                if (generados === materiales.length) {
                    callback(null, archivos);
                }
            }
        );
    });
}

module.exports = { generarQRMateriales, carpetaQR };