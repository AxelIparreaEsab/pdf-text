import formidable from 'formidable';
import { GoogleGenerativeAI } from '@google/generative-ai';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, message: 'Method not allowed. Use POST' });
  }

  try {
    const form = new formidable.IncomingForm();
    form.parse(req, async (err, fields, files) => {
      if (err) return res.status(500).json({ success: false, message: err.message });

      const { fileName } = fields;
      const file = files.file;
      if (!file) return res.status(400).json({ success: false, message: 'file is required' });

      const pdfBuffer = await fs.promises.readFile(file.filepath);
      const pdfText = pdfBuffer.toString('utf-8');

      if (!process.env.GEMINI_API_KEY) {
        return res.status(503).json({ success: false, message: 'GEMINI_API_KEY not configured' });
      }

      const prompt = `
You are an expert extractor of information from invoices and shipping documents.
INSTRUCTIONS:
1. Extract EXACTLY the fields listed below using the exact keys (capitalization and punctuation) shown. If a field is not present in the DOCUMENT, set its value to null.
2. Dates must be formatted as YYYY-MM-DD. If no date is present, use null.
3. For multi-value fields (e.g. container numbers), return an array of strings or null.
4. Return ONLY a single valid JSON object and NOTHING else.
5. Do NOT hallucinate: use only information present in the DOCUMENT.
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

      return res.status(200).json({
        success: true,
        fileName: fileName || 'unknown',
        data: extractedData,
        processedAt: new Date().toISOString()
      });
    });
  } catch (error) {
    console.error('Error processing PDF:', error);
    return res.status(500).json({ success: false, message: 'Error processing PDF', error: error.message });
  }
}
