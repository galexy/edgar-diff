import type { Env } from './types';
import { addCorsHeaders } from './cors';

export async function handleArchivesProxy(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  // /api/sec/archives/edgar/data/{cik}/{acc}/{file}
  //   → https://www.sec.gov/Archives/edgar/data/{cik}/{acc}/{file}
  const secPath = url.pathname.replace('/api/sec/archives/', '');

  // Basic path validation: must match edgar/data/{digits}/{accession}/{filename}
  if (!/^edgar\/data\/\d+\/\d+\/[\w.-]+$/.test(secPath)) {
    return addCorsHeaders(
      new Response(JSON.stringify({ error: 'Invalid archives path' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      }),
      request,
    );
  }

  const secUrl = `https://www.sec.gov/Archives/${secPath}`;

  let secResponse: Response;
  try {
    secResponse = await fetch(secUrl, {
      headers: { 'User-Agent': env.SEC_USER_AGENT },
    });
  } catch {
    return addCorsHeaders(
      new Response(JSON.stringify({ error: 'SEC service unavailable' }), {
        status: 502,
        headers: { 'Content-Type': 'application/json' },
      }),
      request,
    );
  }

  return addCorsHeaders(
    new Response(secResponse.body, {
      status: secResponse.status,
      headers: {
        'Content-Type': secResponse.headers.get('Content-Type') ?? 'text/html',
      },
    }),
    request,
  );
}
