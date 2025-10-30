/**
 * extractTextFromPDF.js
 * 
 * Extracts text from a PDF buffer.
 * Compatible with Render Cloud (uses /tmp/outputs for debug).
 * @param {Buffer} pdfBuffer - PDF buffer received from API
 * @returns {Promise<string>} - Extracted text
 */

import path from 'path';
import fs from 'fs/promises';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Create require function for CommonJS modules
const require = createRequire(import.meta.url);

export async function extractTextFromPDF(pdfBuffer) {
  if (!pdfBuffer || !Buffer.isBuffer(pdfBuffer)) {
    throw new Error('extractTextFromPDF: a valid PDF Buffer is required');
  }

  let pdfParse;
  try {
    // Use require for CommonJS module
    pdfParse = require('pdf-parse');
    
    if (typeof pdfParse !== 'function') {
      throw new Error('pdf-parse did not export a function');
    }
  } catch (err) {
    throw new Error(
      `pdf-parse module is not available or not properly installed.\nError: ${err.message}`
    );
  }

  try {
    // Extract text from PDF
    const data = await pdfParse(pdfBuffer);
    const text = data?.text || '';

    // Optional debug output for Render
    try {
      const outDir = path.join('/tmp', 'outputs');
      await fs.mkdir(outDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const outFile = path.join(outDir, `extracted-${ts}.txt`);
      await fs.writeFile(outFile, text, 'utf8');
    } catch (wErr) {
      console.error('Could not save extracted text file:', wErr.message || wErr);
    }

    return text;
  } catch (err) {
    throw new Error('Error extracting text from PDF: ' + (err.message || err));
  }
}