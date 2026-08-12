import type { IncomingMessage, ServerResponse } from "node:http";

export const readBody = async (req: IncomingMessage, maxBytes = 2 * 1024 * 1024) => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBytes) throw new Error("Request body too large");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
};

export const sendJson = (res: ServerResponse, status: number, body: unknown) => {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(json),
  });
  res.end(json);
};
