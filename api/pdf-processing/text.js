/**
 * Extrae el texto de un PDF recibido como buffer.
 * Compatible con Render Cloud (usa /tmp/outputs para depuración).
 * @param {Buffer} pdfBuffer - El buffer del PDF recibido desde el API.
 * @returns {Promise<string>} - Texto extraído del PDF.
 */
import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function extractTextFromPDF(pdfBuffer) {
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
    throw new Error('extractTextFromPDF: se requiere un Buffer de PDF válido');
  }

  // Importar pdf-parse dinámicamente (ESM / CJS)
  let pdfParse;
  try {
    const mod = await import('pdf-parse');
    pdfParse = mod.default || mod;
  } catch (importErr) {
    try {
      const { createRequire } = await import('module');
      const require = createRequire(import.meta.url);
      const mod = require('pdf-parse');
      pdfParse = mod.default || mod;
    } catch (requireErr) {
      throw new Error(
        `pdf-parse no disponible. Instala con: npm install pdf-parse\nImport error: ${importErr?.message}\nRequire error: ${requireErr?.message}`
      );
    }
  }

  try {
    const data = await pdfParse(pdfBuffer);
    const text = data?.text || data?.content || '';

    // Guardar texto extraído en /tmp/outputs/ para Render
    try {
      const outDir = path.join('/tmp', 'outputs');
      await fs.mkdir(outDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const outFile = path.join(outDir, `extracted-${ts}.txt`);
      await fs.writeFile(outFile, String(text), 'utf8');
    } catch (wErr) {
      console.error('No se pudo guardar archivo de texto extraído:', wErr.message || wErr);
    }

    return String(text);
  } catch (err) {
    throw new Error('Error extrayendo texto del PDF: ' + (err.message || err));
  }
}
