/**
 * process-pdf.js
 * 
 * Main API route to receive PDFs, extract text, process with Gemini AI, 
 * and optionally send callback to external URL.
 */

import formidable from 'formidable';
import fs from 'fs/promises';
import { extractTextFromPDF } from './pdf-processing/extractTextFromPDF.js';
import { processWithGemini } from './AI/AiController.js';

// Optional in-memory jobs store
const jobs = {};

export const config = { api: { bodyParser: false } };

/**
 * Send JSON response (fallback for non-Express)
 */
function sendJson(res, statusCode, payload) {
  if (res?.status && typeof res.json === 'function') {
    return res.status(statusCode).json(payload);
  }
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

/**
 * API Handler
 */
export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') return sendJson(res, 200, {});

  // GET: check job status
  if (req.method === 'GET') {
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const jobId = params.get('jobId');
    if (!jobId) return sendJson(res, 400, { success: false, message: 'jobId required' });
    return sendJson(res, 200, jobs[jobId] || { status: 'pending', jobId });
  }

  // POST: receive and process PDF
  if (req.method === 'POST') {
    let pdfBuffer = null;
    let fileName = 'unknown';
    let callbackUrl = null;

    const contentType = (req.headers['content-type'] || '').toLowerCase();

    if (contentType.includes('application/json')) {
      const raw = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => (data += chunk));
        req.on('end', () => resolve(data));
        req.on('error', reject);
      });
      const body = JSON.parse(raw || '{}');
      if (!body.fileContent) return sendJson(res, 400, { success: false, message: 'fileContent required' });
      pdfBuffer = Buffer.from(body.fileContent, 'base64');
      fileName = body.fileName || fileName;
      callbackUrl = body.callbackUrl || null;

    } else if (contentType.includes('multipart/form-data')) {
      const form = new formidable.IncomingForm();
      const { fields, files } = await new Promise((resolve, reject) =>
        form.parse(req, (err, f, fs) => (err ? reject(err) : resolve({ fields: f, files: fs })))
      );
      if (!files.file) return sendJson(res, 400, { success: false, message: 'File is required' });
      pdfBuffer = await fs.promises.readFile(files.file.filepath);
      fileName = fields.fileName || fileName;
      callbackUrl = fields.callbackUrl || null;

    } else {
      return sendJson(res, 400, { success: false, message: 'Unsupported content-type' });
    }

    const jobId = Date.now().toString();
    jobs[jobId] = { status: 'pending', fileName, callbackUrl };

    // Async processing
    (async () => {
      try {
        const extractedText = await extractTextFromPDF(pdfBuffer);
        const result = await processWithGemini(extractedText, fileName);
        jobs[jobId] = { ...result };

        // Send callback if provided
        if (callbackUrl) {
          try {
            await fetch(callbackUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(result)
            });
            jobs[jobId].callbackSent = true;
          } catch (err) {
            jobs[jobId].callbackError = err.message;
          }
        }
      } catch (err) {
        jobs[jobId] = { status: 'error', message: err.message };
      }
    })();

    return sendJson(res, 200, { success: true, jobId });
  }

  return sendJson(res, 405, { success: false, message: 'Method not allowed' });
}
