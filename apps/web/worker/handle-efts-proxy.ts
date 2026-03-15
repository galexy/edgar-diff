import type { Env } from './types';
import { addCorsHeaders } from './cors';

export async function handleEftsProxy(
  request: Request,
  env: Env,
  url: URL,
): Promise<Response> {
  // /api/sec/efts/search-index?q=... → https://efts.sec.gov/LATEST/search-index?q=...
  const secPath = url.pathname.replace('/api/sec/efts/', '');
  const secUrl = `https://efts.sec.gov/LATEST/${secPath}${url.search}`;

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
      headers: { 'Content-Type': secResponse.headers.get('Content-Type') ?? 'application/json' },
    }),
    request,
  );
}
