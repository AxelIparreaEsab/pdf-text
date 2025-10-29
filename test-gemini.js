// test-gemini.js
import dotenv from 'dotenv';
import { GoogleGenerativeAI } from '@google/generative-ai';

// Load environment variables from .env at project root
dotenv.config();

async function main() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    console.error('GEMINI_API_KEY no está definida en el entorno');
    process.exit(2);
  }
  // Ensure global fetch is available for the SDK. If Node doesn't provide fetch,
  // attempt to dynamically import `node-fetch` and set globalThis.fetch.
  if (typeof globalThis.fetch !== 'function') {
    try {
      const nf = await import('node-fetch');
      // node-fetch v3 exports default
      globalThis.fetch = nf.default || nf;
    } catch (err) {
      console.error('fetch is not defined and node-fetch could not be imported.');
      console.error('Run: npm install node-fetch --save');
      process.exit(1);
    }
  }

  const client = new GoogleGenerativeAI(key);
  const model = client.getGenerativeModel({ model: process.env.GEMINI_MODEL || 'gemini-2.0-flash' });

  try {
    const prompt = 'Say "hello" and then the current timestamp as JSON: {"hello": "world"}';
    const result = await model.generateContent(prompt);
    // SDK puede exponer .response.text() o .response[...], dependiente de versión
    let text;
    if (result && result.response && typeof result.response.text === 'function') {
      // si es una función async que retorna el texto
      text = await result.response.text();
    } else if (result && result.response && result.response.text) {
      // si ya es una cadena
      text = result.response.text;
    } else {
      text = JSON.stringify(result, null, 2);
    }
    console.log('=== OK: respuesta del modelo ===');
    console.log(text);
  } catch (err) {
    console.error('=== ERROR al llamar a Gemini ===');
    console.error(err && err.message ? err.message : String(err));
    // imprime objeto completo para depuración
    console.error(err);
    process.exit(1);
  }
}

main();