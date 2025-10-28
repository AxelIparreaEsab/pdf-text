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
    const prompt = `
You are an expert extractor of information from invoices and shipping documents.

INSTRUCTIONS:
1. Extract EXACTLY the fields listed below. If a field is not present in the DOCUMENT, set its value to null.
2. Dates must be formatted as YYYY-MM-DD. If no date is present, use null.
3. For multi-value fields (e.g. container numbers), return an array of strings or null.
4. Return ONLY a single valid JSON object and NOTHING else (no explanation, no markdown, no extra text).
5. Do NOT hallucinate: use only information present in the DOCUMENT.

FIELDS TO RETURN (types):
{
  "hbl_number": "string or null",
  "forwarder": "string or null",
  "origin_country": "string or null",
  "shipper_address": "string or null",
  "destination_country": "string or null",
  "delivery_address": "string or null",
  "equipment_type": "string or null",
  "consignee_name": "string or null",
  "incoterms": "string or null",
  "loading_port": "string or null",
  "destination_port": "string or null",
  "container_numbers": ["string", "..."] or null,
  "delivery_status": "string or null"
}

DOCUMENT:
${pdfText}

EXAMPLES (five examples). Each example is a single JSON object exactly matching the fields above.

Example 1:
{
  "hbl_number": "PRGS002697",
  "forwarder": "SGL",
  "origin_country": "Czech Republic",
  "shipper_address": "Pardubice",
  "destination_country": "Canada",
  "delivery_address": "Mississauga",
  "equipment_type": "FCL",
  "consignee_name": "ESAB Welding & Cutting Products CDN",
  "incoterms": "Ex works",
  "loading_port": "BREMERHAVEN, DE",
  "destination_port": "Halifax, CA",
  "container_numbers": ["MAGU5351379"],
  "delivery_status": null
}

Example 2:
{
  "hbl_number": "PRGSE001653",
  "forwarder": "SGL",
  "origin_country": "Czech Republic",
  "shipper_address": "Helsingborg",
  "destination_country": "Canada",
  "delivery_address": "Mississauga",
  "equipment_type": "FCL",
  "consignee_name": "ESAB Welding & Cutting Products CDN",
  "incoterms": "Ex works",
  "loading_port": "BREMERHAVEN, DE",
  "destination_port": "Montreal, CA",
  "container_numbers": ["BEAU4085003","ECMU7740829","TCNU5804373"],
  "delivery_status": null
}

Example 3:
{
  "hbl_number": "HLCUPRG250804830",
  "forwarder": "SGL",
  "origin_country": "Czech Republic",
  "shipper_address": "Helsingborg",
  "destination_country": "Canada",
  "delivery_address": "Mississauga",
  "equipment_type": "FCL",
  "consignee_name": "ESAB GROUP CANADA INC",
  "incoterms": null,
  "loading_port": "Helsingborg",
  "destination_port": "Montreal",
  "container_numbers": ["FTAU1547667"],
  "delivery_status": null
}

Example 4:
{
  "hbl_number": "HLCUPRG250808205",
  "forwarder": "SGL",
  "origin_country": "Czech Republic",
  "shipper_address": "Helsingborg",
  "destination_country": "Canada",
  "delivery_address": "Mississauga",
  "equipment_type": "FCL",
  "consignee_name": "ESAB GROUP CANADA INC",
  "incoterms": null,
  "loading_port": "Helsingborg",
  "destination_port": "Montreal",
  "container_numbers": ["TCKU3947468"],
  "delivery_status": null
}

Example 5:
{
  "hbl_number": null,
  "forwarder": "SGL",
  "origin_country": "Czech Republic",
  "shipper_address": "Helsingborg",
  "destination_country": "Canada",
  "delivery_address": "Mississauga",
  "equipment_type": "FCL",
  "consignee_name": "ESAB GROUP CANADA INC",
  "incoterms": null,
  "loading_port": "Helsingborg",
  "destination_port": "Montreal",
  "container_numbers": ["UACU3695573"],
  "delivery_status": null
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