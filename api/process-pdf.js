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

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method === 'POST') {
    const contentType = (req.headers['content-type'] || '').toLowerCase();
    let pdfBuffer = null;
    let fileName = 'unknown';

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
        return res.status(400).json({ success: false, message: 'Invalid JSON body' });
      }

      if (body.fileContent) {
        try {
          pdfBuffer = Buffer.from(body.fileContent, 'base64');
          fileName = body.fileName || fileName;
        } catch (err) {
          return res.status(400).json({ success: false, message: 'Invalid base64 in fileContent' });
        }
      } else {
        return res.status(400).json({ success: false, message: 'JSON body must include fileContent' });
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
      const file = files.file;
      if (!file) return res.status(400).json({ success: false, message: 'file is required' });
      pdfBuffer = await fs.promises.readFile(file.filepath);
    }

    if (!pdfBuffer) return res.status(400).json({ success: false, message: 'No file provided' });

    const jobId = Date.now().toString();
    jobs[jobId] = { status: 'pending' };

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
        const model = genAI.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-1.5-flash' });
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
      } catch (err) {
        jobs[jobId] = { status: 'error', message: err.message };
      }
    })();

    return res.status(200).json({ success: true, jobId });
  }

  else if (req.method === 'GET') {
    const params = new URL(req.url, `http://${req.headers.host}`).searchParams;
    const jobId = params.get('jobId');
    if (!jobId || !jobs[jobId]) return res.status(404).json({ success: false, message: 'Job not found' });
    return res.status(200).json(jobs[jobId]);
  }

  else {
    return res.status(405).json({ success: false, message: 'Method not allowed' });
  }
}
