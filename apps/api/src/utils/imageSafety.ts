import fs from "fs";
import zlib from "zlib";

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// O pdfkit decodifica PNG através do png-js, que chama zlib.inflate de forma assíncrona.
// Um PNG corrompido faz o erro estourar fora de qualquer try/catch e derruba o processo,
// por isso o conteúdo é inflado aqui, de forma síncrona, antes de chegar ao pdfkit.
function pngDecodificavel(buffer: Buffer): boolean {
  let offset = PNG_SIGNATURE.length;
  const idat: Buffer[] = [];

  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const dataStart = offset + 8;
    const dataEnd = dataStart + length;
    if (dataEnd + 4 > buffer.length) return false;

    if (type === "IDAT") idat.push(buffer.subarray(dataStart, dataEnd));
    if (type === "IEND") break;

    offset = dataEnd + 4; // pula o CRC
  }

  if (idat.length === 0) return false;

  try {
    zlib.inflateSync(Buffer.concat(idat));
    return true;
  } catch {
    return false;
  }
}

// Diz se o arquivo pode ser embutido num PDF sem risco de derrubar o servidor.
// JPEG é decodificado de forma síncrona pelo pdfkit, então um try/catch ao redor
// de doc.image() já dá conta; PNG precisa da checagem acima.
export function imagemSeguraParaPdf(filePath: string | null | undefined): boolean {
  if (!filePath) return false;

  let buffer: Buffer;
  try {
    if (!fs.existsSync(filePath)) return false;
    buffer = fs.readFileSync(filePath);
  } catch {
    return false;
  }

  return imagemBufferSeguraParaPdf(buffer);
}

export function imagemBufferSeguraParaPdf(buffer: Buffer): boolean {
  if (buffer.length < 4) return false;

  if (buffer.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)) {
    return pngDecodificavel(buffer);
  }

  // JPEG: começa com SOI (FFD8) e termina com EOI (FFD9).
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    return buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
  }

  // WEBP e outros formatos não são suportados pelo pdfkit.
  return false;
}
