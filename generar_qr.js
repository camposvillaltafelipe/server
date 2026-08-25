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
// CAMBIO (Vercel): en Vercel el sistema de archivos es de solo lectura
// (excepto /tmp, que además no persiste entre invocaciones), así que ya no
// se guardan los PNG en disco con fs/QRCode.toFile. Ahora cada QR se genera
// en memoria con QRCode.toBuffer(...) y se sube directamente a Vercel Blob,
// dentro de una carpeta lógica "qr_materiales/", usando la librería
// "@vercel/blob". El resultado son URLs públicas (https://...blob.vercel-
// storage.com/qr_materiales/...) que ya sirven para mostrar/descargar el QR
// sin necesidad de exponer una carpeta estática desde el servidor.
//
// Requiere:
//   npm install qrcode @vercel/blob
//
// Variables de entorno:
//   BLOB_READ_WRITE_TOKEN  -> la crea Vercel automáticamente al conectar un
//   Blob Store al proyecto (Storage > Blob > Connect Project). En local hay
//   que copiarla al archivo .env para poder probar.
// =============================================================================

const QRCode = require("qrcode");
const { put } = require("@vercel/blob");

const CARPETA_QR = "qr_materiales";

function limpiarNombre(nombre) {
    return nombre
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "") // quita acentos
        .replace(/[^a-zA-Z0-9]+/g, "_")
        .toLowerCase();
}

// Genera un PNG de QR por cada material recibido, lo sube a Vercel Blob
// (carpeta "qr_materiales/") y llama a callback(err, archivos) cuando
// termina. "materiales" debe ser el arreglo [{id, nombre}, ...] que
// devuelve la consulta "SELECT id, nombre FROM materiales".
// "archivos" es un arreglo de URLs públicas de Vercel Blob.
async function generarQRMateriales(materiales, callback) {
    if (!materiales || materiales.length === 0) {
        callback(null, []);
        return;
    }

    try {
        const archivos = [];

        for (const material of materiales) {
            const contenidoQR = String(material.id);
            const nombreArchivo = `material_${material.id}_${limpiarNombre(material.nombre)}.png`;
            const rutaBlob = `${CARPETA_QR}/${nombreArchivo}`;

            // 1) Genera el QR como buffer PNG en memoria (sin tocar disco)
            const bufferQR = await QRCode.toBuffer(contenidoQR, {
                color: { dark: "#000000", light: "#FFFFFF" },
                width: 400,
            });

            // 2) Sube el buffer a Vercel Blob dentro de "qr_materiales/"
            const blob = await put(rutaBlob, bufferQR, {
                access: "public",
                contentType: "image/png",
                addRandomSuffix: false, // mantiene el nombre fijo por material
                allowOverwrite: true,   // permite regenerar el mismo QR sin error
            });

            archivos.push(blob.url);
        }

        callback(null, archivos);
    } catch (errQR) {
        callback(errQR, null);
    }
}

module.exports = { generarQRMateriales, CARPETA_QR };