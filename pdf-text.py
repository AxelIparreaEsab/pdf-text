from flask import Flask, request, jsonify
import base64
from pdfquery import PDFQuery

app = Flask(__name__)

@app.route("/", methods=["POST"])
def extract_pdf():
    data = request.json
    filename = data['filename']
    pdf_bytes = base64.b64decode(data['filecontent'])

    # Guardar PDF temporal
    with open("/tmp/input.pdf", "wb") as f:
        f.write(pdf_bytes)

    # Extraer texto con PDFQuery
    pdf = PDFQuery("/tmp/input.pdf")
    pdf.load()
    text_elements = pdf.pq('LTTextLineHorizontal')
    text = [t.text for t in text_elements if t.text]

    # Devolver JSON a Power Automate
    return jsonify({
        "filename": filename,
        "text": text 
    })

if __name__ == "__main__":
    import os
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port)
