import http from 'node:http';
import https from 'node:https';

export interface HttpRequestOptions {
  uri: string;
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  // Set to false to accept the robot's self-signed certificate.
  strictSSL?: boolean;
  timeout?: number;
}

export interface HttpResponse {
  statusCode: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

export class HttpStatusError extends Error {
  statusCode: number;
  body: string;

  constructor(statusCode: number, body: string) {
    super(statusCode + ' - ' + body);
    this.statusCode = statusCode;
    this.body = body;
  }
}

// Minimal HTTP client for the firmware 1.x robot API and the old cloud API.
// The robot serves a self-signed certificate, so certificate checks can be
// turned off with `strictSSL: false`, which fetch() can't do portably.
function send(options: HttpRequestOptions): Promise<HttpResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(options.uri);
    const transport = url.protocol === 'http:' ? http : https;
    const req = transport.request(
      url,
      {
        method: options.method || 'GET',
        headers: options.headers,
        rejectUnauthorized: options.strictSSL !== false,
        timeout: options.timeout || 30000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () =>
          resolve({
            statusCode: res.statusCode || 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString(),
          }),
        );
        res.on('error', reject);
      },
    );

    req.on('timeout', () => req.destroy(new Error('Request timed out')));
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

// Resolves with the response body, rejects on non-2xx responses.
async function request(options: HttpRequestOptions): Promise<string> {
  const res = await send(options);
  if (res.statusCode < 200 || res.statusCode >= 300) {
    throw new HttpStatusError(res.statusCode, res.body);
  }
  return res.body;
}

// Grouped in an object so callers go through it and tests can stub it.
export const httpClient = { send, request };
