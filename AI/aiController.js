import { GoogleGenerativeAI } from '@google/generative-ai';
import fs from 'fs/promises';
import path from 'path';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

/**
 * Procesa texto extraído con Gemini AI
 * @param {string} extractedText - Texto extraído del PDF
 * @param {string} fileName - Nombre del archivo para logging
 * @returns {Promise<Object>} Datos extraídos estructurados
 */
export async function processWithGemini(extractedText, fileName) {
  const jobId = Date.now().toString();
  
  try {
    const prompt = `
You are an expert extractor of information from invoices and shipping documents.
INSTRUCTIONS:
1. Extract EXACTLY the fields listed below using the exact keys (capitalization and punctuation) shown. If a field is not present in the DOCUMENT, set its value to null.
2. Dates must be formatted as YYYY-MM-DD. If no date is present, use null.
3. For multi-value fields (e.g. container numbers), return an array of strings or null.
4. Return ONLY a single valid JSON object and NOTHING else.
5. Do NOT hallucinate: use only information present in the DOCUMENT.
6. You are not allowed to answer outside of the JSON object.
7. Ensure the JSON is syntactically valid.
8. The Document may have errors or not valid information, extract only what is clearly present. Else return null for that field.

FIELDS TO RETURN (types):
{
  "HBL#": "string or null",
  "FWD": "string or null",
  "Origin Country": "string or null",
  "Shipper address": "string or null",
  "Destination Country": "string or null",
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
${extractedText}
`;

    const model = genAI.getGenerativeModel({ 
      model: process.env.GEMINI_MODEL || 'gemini-2.0-flash' 
    });
    
    const result = await model.generateContent(prompt);
    let jsonText = result.response.text().trim();

    // Guardar respuesta raw para debugging
    await saveDebugFile(`${jobId}-raw.txt`, jsonText);

    // Limpiar markdown code blocks
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    }
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```\n?/g, '');
    }

    const extractedData = JSON.parse(jsonText);

    // Guardar resultado parseado
    await saveDebugFile(`${jobId}.json`, JSON.stringify(extractedData, null, 2));

    return {
      success: true,
      jobId,
      fileName,
      data: extractedData,
      processedAt: new Date().toISOString()
    };

  } catch (err) {
    // Guardar error para debugging
    await saveDebugFile(`${jobId}-error.json`, JSON.stringify({
      message: err.message,
      stack: err.stack
    }, null, 2));

    throw new Error(`Gemini processing failed: ${err.message}`);
  }
}

/**
 * Guarda archivos de debug en la carpeta outputs
 */
async function saveDebugFile(filename, content) {
  try {
    const outDir = path.join(process.cwd(), 'outputs');
    await fs.mkdir(outDir, { recursive: true });
    await fs.writeFile(path.join(outDir, filename), content, 'utf8');
  } catch (err) {
    console.error('Failed to write debug file:', err);
  }
}