// api/process-pdf.js - Endpoint único para procesar PDFs
import { GoogleGenerativeAI } from '@google/generative-ai';

// Inicializar Gemini
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  // Preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Solo POST
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      message: 'Method not allowed. Use POST'
    });
  }

  try {
    const { pdfText, fileName } = req.body;

    // Validación
    if (!pdfText) {
      return res.status(400).json({
        success: false,
        message: 'pdfText is required'
      });
    }

    // Verificar API key
    if (!process.env.GEMINI_API_KEY) {
      return res.status(503).json({
        success: false,
        message: 'GEMINI_API_KEY not configured'
      });
    }

    // Prompt to extract shipping/invoice fields — strict English instructions and examples
    // NOTE: field keys below use the exact capitalization / punctuation requested by the user
    const prompt = `
You are an expert extractor of information from invoices and shipping documents.

INSTRUCTIONS:
1. Extract EXACTLY the fields listed below using the exact keys (capitalization and punctuation) shown. If a field is not present in the DOCUMENT, set its value to null.
2. Dates must be formatted as YYYY-MM-DD. If no date is present, use null.
3. For multi-value fields (e.g. container numbers), return an array of strings or null.
4. Return ONLY a single valid JSON object and NOTHING else (no explanation, no markdown, no extra text).
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

EXAMPLES (five examples). Each example is a single JSON object exactly matching the fields above and using exact key capitalization.

Example 1:
{
  "HBL#": "PRGS002697",
  "FWD": "SGL",
  "Origin Country": "Czech Republic",
  "Shipper address": "Pardubice",
  "Destination COuntry": "Canada",
  "Delivery address": "Mississauga",
  "Equipment type": "FCL",
  "Consignee name": "ESAB Welding & Cutting Products CDN",
  "INCO TERMS": "Ex works",
  "Loading": "BREMERHAVEN, DE",
  "destination": "Halifax, CA",
  "Container#": ["MAGU5351379"],
  "Delivery status": null
}

Example 2:
{
  "HBL#": "PRGSE001653",
  "FWD": "SGL",
  "Origin Country": "Czech Republic",
  "Shipper address": "Helsingborg",
  "Destination COuntry": "Canada",
  "Delivery address": "Mississauga",
  "Equipment type": "FCL",
  "Consignee name": "ESAB Welding & Cutting Products CDN",
  "INCO TERMS": "Ex works",
  "Loading": "BREMERHAVEN, DE",
  "destination": "Montreal, CA",
  "Container#": ["BEAU4085003","ECMU7740829","TCNU5804373"],
  "Delivery status": null
}

Example 3:
{
  "HBL#": "HLCUPRG250804830",
  "FWD": "SGL",
  "Origin Country": "Czech Republic",
  "Shipper address": "Helsingborg",
  "Destination COuntry": "Canada",
  "Delivery address": "Mississauga",
  "Equipment type": "FCL",
  "Consignee name": "ESAB GROUP CANADA INC",
  "INCO TERMS": null,
  "Loading": "Helsingborg",
  "destination": "Montreal",
  "Container#": ["FTAU1547667"],
  "Delivery status": null
}

Example 4:
{
  "HBL#": "HLCUPRG250808205",
  "FWD": "SGL",
  "Origin Country": "Czech Republic",
  "Shipper address": "Helsingborg",
  "Destination COuntry": "Canada",
  "Delivery address": "Mississauga",
  "Equipment type": "FCL",
  "Consignee name": "ESAB GROUP CANADA INC",
  "INCO TERMS": null,
  "Loading": "Helsingborg",
  "destination": "Montreal",
  "Container#": ["TCKU3947468"],
  "Delivery status": null
}

Example 5:
{
  "HBL#": null,
  "FWD": "SGL",
  "Origin Country": "Czech Republic",
  "Shipper address": "Helsingborg",
  "Destination COuntry": "Canada",
  "Delivery address": "Mississauga",
  "Equipment type": "FCL",
  "Consignee name": "ESAB GROUP CANADA INC",
  "INCO TERMS": null,
  "Loading": "Helsingborg",
  "destination": "Montreal",
  "Container#": ["UACU3695573"],
  "Delivery status": null
}

JSON:`;

    // Llamar a Gemini
    const model = genAI.getGenerativeModel({ 
      model: process.env.GEMINI_MODEL || 'gemini-1.5-flash' 
    });
    
    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    // Limpiar respuesta (quitar markdown si existe)
    let jsonText = responseText.trim();
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    }
    if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```\n?/g, '');
    }

    // Parsear JSON
    const extractedData = JSON.parse(jsonText);

    // Respuesta final
    return res.status(200).json({
      success: true,
      fileName: fileName || 'unknown',
      data: extractedData,
      processedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error processing PDF:', error);

    // Errores específicos de Gemini
    if (error.message.includes('API_KEY_INVALID') || 
        error.message.includes('API key not valid')) {
      return res.status(503).json({
        success: false,
        message: 'Invalid Gemini API key',
        error: error.message
      });
    }

    // Error general
    return res.status(500).json({
      success: false,
      message: 'Error processing PDF',
      error: error.message
    });
  }
}