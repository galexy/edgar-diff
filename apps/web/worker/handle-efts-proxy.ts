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

  const secResponse = await fetch(secUrl, {
    headers: { 'User-Agent': env.SEC_USER_AGENT },
  });

  return addCorsHeaders(
    new Response(secResponse.body, {
      status: secResponse.status,
      headers: { 'Content-Type': secResponse.headers.get('Content-Type') ?? 'application/json' },
    }),
    request,
  );
}
