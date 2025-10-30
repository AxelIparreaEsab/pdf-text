/**
 * process-pdf.js
 * 
 * Serverless endpoint to process PDF files:
 * - Accepts PDF via JSON (base64) or multipart/form-data
 * - Extracts text using pdf-parse (extractTextFromPDF)
 * - Processes text via Google Gemini AI (processWithGemini)
 * - Supports async job tracking and optional callback URL
 */

import formidable from 'formidable';
import fs from 'fs/promises';
import { extractTextFromPDF } from './pdf-processing/text.js';
import { processWithGemini } from './AI/AiController.js';

// In-memory job storage (for GET status)
const jobs = {};

// Disable default body parser for file handling
export const config = {
  api: { bodyParser: false }
};

/**
 * Helper to send JSON response in Node.js environments
 * Works for Serverless platforms like Render (no Express res.status())
 */
function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

/**
 * Main handler
 */
export default async function handler(req, res) {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Preflight request
  if (req.method === 'OPTIONS') return sendJson(res, 200, {});

  // ===========================
  // GET: Check job status
  // ===========================
  if (req.method === 'GET') {
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const jobId = params.get('jobId');

    if (!jobId) return sendJson(res, 400, { success: false, message: 'jobId query parameter required' });

    const job = jobs[jobId] || { status: 'pending', jobId };
    return sendJson(res, 200, job);
  }

  // ===========================
  // POST: Process PDF
  // ===========================
  if (req.method === 'POST') {
    let pdfBuffer = null;
    let fileName = 'unknown';
    let callbackUrl = null;

    const contentType = (req.headers['content-type'] || '').toLowerCase();

    try {
      // JSON base64 payload
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
      }
      // Multipart/form-data upload
      else if (contentType.includes('multipart/form-data')) {
        const form = new formidable.IncomingForm();
        const { fields, files } = await new Promise((resolve, reject) =>
          form.parse(req, (err, f, fsFiles) => (err ? reject(err) : resolve({ fields: f, files: fsFiles })))
        );

        if (!files.file) return sendJson(res, 400, { success: false, message: 'File is required' });
        pdfBuffer = await fs.readFile(files.file.filepath);
        fileName = fields.fileName || fileName;
        callbackUrl = fields.callbackUrl || null;
      } else {
        return sendJson(res, 400, { success: false, message: 'Unsupported content-type' });
      }
    } catch (err) {
      return sendJson(res, 400, { success: false, message: 'Invalid request payload', error: err.message });
    }

    // Assign job ID and mark as pending
    const jobId = Date.now().toString();
    jobs[jobId] = { status: 'pending', fileName, callbackUrl };

    // Process asynchronously
    (async () => {
      try {
        // Extract text from PDF
        const extractedText = await extractTextFromPDF(pdfBuffer);

        // Process with AI
        const result = await processWithGemini(extractedText, fileName);

        // Save result in job
        jobs[jobId] = { ...result };

        // Optional callback to external URL
        if (callbackUrl) {
          try {
            await fetch(callbackUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(result)
            });
            jobs[jobId].callbackSent = true;
          } catch (cbErr) {
            jobs[jobId].callbackError = cbErr.message;
          }
        }
      } catch (err) {
        jobs[jobId] = { status: 'error', message: err.message };
      }
    })();

    // Return immediately with job ID
    return sendJson(res, 200, { success: true, jobId });
  }

  // ===========================
  // Method not allowed
  // ===========================
  return sendJson(res, 405, { success: false, message: 'Method not allowed' });
}
