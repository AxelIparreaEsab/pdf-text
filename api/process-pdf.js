import formidable from 'formidable';
import fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const jobs = {};

export const config = {
  api: {
    bodyParser: false,
  },
};

// Helpers to send JSON/status that work both with Next/Express-style `res` and
// with Node's native http.ServerResponse (used by server.js).
function sendJson(res, statusCode, payload) {
  try {
    if (res && typeof res.status === 'function' && typeof res.json === 'function') {
      return res.status(statusCode).json(payload);
    }
  } catch (e) {
    // fall through to native write
  }
  // Fallback for Node's http.ServerResponse
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body) });
  res.end(body);
}

function sendStatus(res, statusCode) {
  try {
    if (res && typeof res.status === 'function') return res.status(statusCode).end();
  } catch (e) {}
  res.writeHead(statusCode);
  res.end();
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  // Ensure responses are returned as JSON (Power Automate expects application/json)
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method === 'OPTIONS') return sendStatus(res, 200);

  if (req.method === 'POST') {
  const contentType = (req.headers['content-type'] || '').toLowerCase();
  let pdfBuffer = null;
  let fileName = 'unknown';
  let callbackUrl = null; // optional webhook (Power Automate)

    if (contentType.includes('application/json')) {
      const raw = await new Promise((resolve, reject) => {
        let data = '';
        req.on('data', chunk => (data += chunk));
        req.on('end', () => resolve(data));
        req.on('error', reject);
      });

      let body = {};
      try {
        body = JSON.parse(raw || '{}');
      } catch (err) {
        return sendJson(res, 400, { success: false, message: 'Invalid JSON body' });
      }

      if (body.fileContent) {
        try {
          pdfBuffer = Buffer.from(body.fileContent, 'base64');
          fileName = body.fileName || fileName;
          callbackUrl = body.callbackUrl || null;
        } catch (err) {
          return sendJson(res, 400, { success: false, message: 'Invalid base64 in fileContent' });
        }
      } else {
        return sendJson(res, 400, { success: false, message: 'JSON body must include fileContent' });
      }
    }

    if (!pdfBuffer && contentType.includes('multipart/form-data')) {
      const form = new formidable.IncomingForm();
      const parsed = await new Promise((resolve, reject) => {
        form.parse(req, (err, fields, files) => {
          if (err) return reject(err);
          resolve({ fields, files });
        });
      });
      const { fields, files } = parsed;
      fileName = fields.fileName || fileName;
      callbackUrl = fields.callbackUrl || callbackUrl;
      const file = files.file;
  if (!file) return sendJson(res, 400, { success: false, message: 'file is required' });
      pdfBuffer = await fs.promises.readFile(file.filepath);
    }

  if (!pdfBuffer) return sendJson(res, 400, { success: false, message: 'No file provided' });

  const jobId = Date.now().toString();
  jobs[jobId] = { status: 'pending', callbackUrl: callbackUrl || null };

    (async () => {
      try {
        const pdfText = pdfBuffer.toString('utf-8');
        const prompt = `
You are an expert extractor of information from invoices and shipping documents.
INSTRUCTIONS:
1. Extract EXACTLY the fields listed below using the exact keys (capitalization and punctuation) shown. If a field is not present in the DOCUMENT, set its value to null.
2. Dates must be formatted as YYYY-MM-DD. If no date is present, use null.
3. For multi-value fields (e.g. container numbers), return an array of strings or null.
4. Return ONLY a single valid JSON object and NOTHING else.
5. Do NOT hallucinate: use only information present in the DOCUMENT.
6. You are not allowed to dont answer outside of the JSON object.
7. Ensure the JSON is syntactically valid.
8. The Document may have errors or not valid information, extract only what is clearly present. Else return null for that field.
FIELDS TO RETURN (types):
{
  "HBL#": "string or null",
  "FWD": "string or null",
  "Origin Country": "string or null",
  "Shipper address": "string or null",
  "Destination COuntry": "string or null",
  "Delivery address": "string or null",
  "Equipment type": "string or null",
  "Consignee name": "string or null",
  "INCO TERMS": "string or null",
  "Loading": "string or null",
  "destination": "string or null",
  "Container#": ["string", "..."] or null,
  "Delivery status": "string or null"
}
DOCUMENT:
${pdfText}
`;
        const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.0-flash' });
        const result = await model.generateContent(prompt);
        let jsonText = result.response.text().trim();
        if (jsonText.startsWith('```json')) jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
        if (jsonText.startsWith('```')) jsonText = jsonText.replace(/```\n?/g, '');
        const extractedData = JSON.parse(jsonText);

        jobs[jobId] = {
          status: 'done',
          data: extractedData,
          fileName: fileName || 'unknown',
          processedAt: new Date().toISOString()
        };

        // If a callback URL was provided, POST the JSON result to that URL
        try {
          if (jobs[jobId].callbackUrl) {
            const payload = {
              success: true,
              jobId,
              fileName: jobs[jobId].fileName,
              data: jobs[jobId].data,
              processedAt: jobs[jobId].processedAt
            };
            await fetch(jobs[jobId].callbackUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            jobs[jobId].callbackSent = true;
          }
        } catch (cbErr) {
          // Log callback error but don't crash the job
          jobs[jobId].callbackError = cbErr.message || String(cbErr);
        }
      } catch (err) {
        jobs[jobId] = { status: 'error', message: err.message };
        // If a callback URL was provided, POST the error JSON to that URL
        try {
          if (jobs[jobId].callbackUrl) {
            const payload = {
              success: false,
              jobId,
              fileName: fileName || 'unknown',
              message: err.message
            };
            await fetch(jobs[jobId].callbackUrl, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload)
            });
            jobs[jobId].callbackSent = true;
          }
        } catch (cbErr) {
          jobs[jobId].callbackError = cbErr.message || String(cbErr);
        }
      }
    })();

  return sendJson(res, 200, { success: true, jobId });
  }

  else if (req.method === 'GET') {
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const jobId = params.get('jobId');

    // If jobId is missing, return a clear 400 JSON response
    if (!jobId) {
      return sendJson(res, 400, { success: false, message: 'jobId query parameter is required' });
    }

    // If job not found yet, return a 200 with a consistent JSON shape indicating pending
    if (!jobs[jobId]) {
      return sendJson(res, 200, {
        status: 'pending',
        jobId,
        fileName: null,
        data: null
      });
    }

    // Job exists: return the stored job object
    return sendJson(res, 200, jobs[jobId]);
  }

  else {
    return sendJson(res, 405, { success: false, message: 'Method not allowed' });
  }
}
