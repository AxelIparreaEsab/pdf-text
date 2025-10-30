import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { extractTextFromPDF } from './pdf-processing/text.js';
import { extractImagesFromPDF } from './pdf-processing/image.js';
import { handler } from './api/process-pdf.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Procesa un PDF y lo pasa al módulo de IA
 * @param {Object} options
 * @param {Buffer} [options.pdfBuffer] - Buffer del PDF
 * @param {string} [options.pdfPath] - Ruta del PDF
 * @param {string} options.fileName - Nombre del archivo
 * @param {'text'|'image'} [options.type='text'] - Tipo de extracción
 */
export async function processPDF({ pdfBuffer, pdfPath, fileName, type = 'text' }) {
  if (!pdfBuffer && !pdfPath) {
    throw new Error('No PDF provided');
  }

  // Leer el PDF
  const buffer = pdfBuffer || await fs.readFile(pdfPath);

  // Extraer según tipo
  let extracted;
  switch (type) {
    case 'image':
      extracted = await extractImagesFromPDF(buffer);
      break;
    case 'text':
    default:
      extracted = await extractTextFromPDF(buffer);
      break;
  }

  // Procesar con la IA (Gemini)
  const aiResult = await handler({ extracted, fileName });

  return {
    fileName,
    extracted,
    aiResult
  };
}
