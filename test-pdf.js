import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { GoogleGenerativeAI } from '@google/generative-ai';
import dotenv from 'dotenv';

// Cargar variables de entorno desde .env en la raíz del proyecto
dotenv.config();

// Helpers para __dirname en ESM
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuración
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

async function testPDFProcessing() {
  try {
    console.log('=== INICIANDO PRUEBA DE PROCESAMIENTO PDF ===\n');

    // 1. Leer el PDF de prueba
  const pdfPath = path.join(__dirname, 'test.pdf');
  const pdfBuffer = await fs.readFile(pdfPath);
    
    console.log(`✅ PDF leído: ${pdfPath}`);
    console.log(`📄 Tamaño del PDF: ${pdfBuffer.length} bytes\n`);

    // 2. Extraer texto del PDF (usando pdf-parse si lo tienes, o una alternativa)
    let pdfText;
    try {
      // Intentamos importar con ESM dynamic import
      let pdfParse = null;
      try {
        const pdfParseModule = await import('pdf-parse');
        pdfParse = pdfParseModule.default || pdfParseModule;
      } catch (importErr) {
        // Fallback: intentar cargar con require() usando createRequire (para paquetes CJS)
        try {
          const { createRequire } = await import('module');
          const require = createRequire(import.meta.url);
          const reqModule = require('pdf-parse');
          pdfParse = reqModule.default || reqModule;
        } catch (requireErr) {
          // Ambos fallaron: re-lanzar con mensaje combinado para diagnóstico
          console.error('Error importando pdf-parse:', importErr?.message, '; require fallback:', requireErr?.message);
          throw new Error(`pdf-parse import failed: ${importErr?.message}; require fallback failed: ${requireErr?.message}`);
        }
      }

      // Usar pdfParse para extraer texto
      const pdfData = await pdfParse(pdfBuffer);
      pdfText = pdfData && (pdfData.text || pdfData.content || '');
    } catch (error) {
      console.error('❌ pdf-parse no disponible o falló. Instala con: npm install pdf-parse');
      // Rethrow para que el bloque superior guarde el error en el archivo output-pdf-test-error.json
      throw error;
    }

    // Asegurarnos de que tenemos texto extraído antes de usar substring
    if (!pdfText || typeof pdfText !== 'string') {
      throw new Error('No se pudo extraer texto del PDF. Comprueba que test.pdf existe y que pdf-parse está instalado.');
    }

    console.log('=== TEXTO EXTRAÍDO DEL PDF ===');
    console.log(pdfText.substring(0, 500) + '...');
    console.log('================================\n');

    // 3. Guardar texto extraído
    const outputDir = __dirname;
    await fs.writeFile(
      path.join(outputDir, 'output-pdf-test.txt'), 
      pdfText, 
      'utf8'
    );
    console.log('✅ Texto extraído guardado en: output-pdf-test.txt');

    // 4. Procesar con Gemini
    console.log('🔄 Enviando a Gemini...\n');
    
    const model = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.0-flash'
    });

    const prompt = `
EXTRACT shipping information from this document. Return ONLY JSON, no other text.

CRITICAL: 
- If any field is not found, use null
- Return valid JSON format only
- Use exact field names as specified

REQUIRED JSON FORMAT:
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
  "Container#": ["string"] or null,
  "Delivery status": "string or null"
}

DOCUMENT TEXT:
${pdfText}
`;

    const result = await model.generateContent(prompt);
    // Manejo robusto de la respuesta del SDK
    let jsonText = '';
    try {
      if (result && result.response && typeof result.response.text === 'function') {
        jsonText = (await result.response.text()).trim();
      } else if (typeof result === 'string') {
        jsonText = result.trim();
      } else if (result && result.output && typeof result.output === 'string') {
        jsonText = result.output.trim();
      } else {
        // Fallback: stringify
        jsonText = JSON.stringify(result);
      }
    } catch (err) {
      jsonText = String(result);
    }

    console.log('=== RESPUESTA CRUDA DE GEMINI ===');
    console.log(jsonText);
    console.log('==================================\n');

    // 5. Limpiar y parsear JSON
    if (jsonText.startsWith('```json')) {
      jsonText = jsonText.replace(/```json\n?/g, '').replace(/```\n?/g, '');
    } else if (jsonText.startsWith('```')) {
      jsonText = jsonText.replace(/```\n?/g, '');
    }

  const extractedData = JSON.parse(jsonText);

    // 6. Guardar resultado final
    await fs.writeFile(
      path.join(outputDir, 'output-pdf-test.json'),
      JSON.stringify(extractedData, null, 2),
      'utf8'
    );

    console.log('✅ Resultado JSON guardado en: output-pdf-test.json');
    console.log('\n=== RESULTADO FINAL ===');
    console.log(JSON.stringify(extractedData, null, 2));
    console.log('\n🎉 ¡Prueba completada!');

  } catch (error) {
    console.error('❌ Error en la prueba:', error);
    
    // Guardar error
    const errorOutput = {
      error: error.message,
      stack: error.stack,
      timestamp: new Date().toISOString()
    };
    
    await fs.writeFile(
      path.join(__dirname, 'output-pdf-test-error.json'),
      JSON.stringify(errorOutput, null, 2),
      'utf8'
    );
    
    console.log('📝 Detalles del error guardados en: output-pdf-test-error.json');
  }
}

// Ejecutar la prueba si este archivo es el principal
const mainFile = process.argv[1];
if (mainFile && fileURLToPath(import.meta.url) === mainFile) {
  // Verificar que la API key esté configurada
  if (!process.env.GEMINI_API_KEY) {
    console.error('❌ GEMINI_API_KEY no encontrada en variables de entorno');
    console.log('💡 En PowerShell: $env:GEMINI_API_KEY = "tu_api_key"; node test-pdf.js');
    process.exit(1);
  }

  testPDFProcessing();
}

export { testPDFProcessing };