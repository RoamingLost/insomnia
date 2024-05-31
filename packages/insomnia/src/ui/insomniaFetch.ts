import { getApiBaseURL, getClientString, INSOMNIA_FETCH_RETRY_TIMES, INSOMNIA_FETCH_TIME_OUT, PLAYWRIGHT } from '../common/constants';
import { delay } from '../common/misc';

interface FetchConfig {
  method: 'POST' | 'PUT' | 'GET' | 'DELETE' | 'PATCH';
  path: string;
  sessionId: string | null;
  organizationId?: string | null;
  data?: unknown;
  retries?: number;
  origin?: string;
  headers?: Record<string, string>;
}

// we need to retry on 429 and 5xx errors
const needRetry = (httpCode: number, retriedCount: number): boolean => {
  return (httpCode === 429 || httpCode >= 500) && retriedCount < INSOMNIA_FETCH_RETRY_TIMES;
};

const fetchWithRetry = async ({
  url,
  init,
  retriedCount = 0,
}: {
  url: string;
  init: RequestInit;
  retriedCount?: number;
}): Promise<Response> => {
  try {
    const response = await fetch(url, init);
    if (needRetry(response.status, retriedCount)) {
      retriedCount++;
      await delay(500);
      console.log(`Received ${response.status} from ${url} retrying`);
      return fetchWithRetry({ url, init, retriedCount });
    }
    if (!response.ok) {
      // TODO: review error status code behaviour with backend, should we parse errors here and return response
      // or should we rethrow an error with a response object inside? should we be exposing errors to the app UI?
      console.log(`Response not OK: ${response.status} for ${url}`);
    }
    return response;
  } catch (err) {
    throw err;
  }
};

// Adds headers, retries and opens deep links returned from the api
export async function insomniaFetch<T = void>({ method, path, data, sessionId, organizationId, origin, headers }: FetchConfig): Promise<T> {
  const config: RequestInit = {
    method,
    headers: {
      ...headers,
      'X-Insomnia-Client': getClientString(),
      'X-Origin': origin || getApiBaseURL(),
      ...(sessionId ? { 'X-Session-Id': sessionId } : {}),
      ...(data ? { 'Content-Type': 'application/json' } : {}),
      ...(organizationId ? { 'X-Insomnia-Org-Id': organizationId } : {}),
      ...(PLAYWRIGHT ? { 'X-Mockbin-Test': 'true' } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
    signal: AbortSignal.timeout(INSOMNIA_FETCH_TIME_OUT),
  };

  if (sessionId === undefined) {
    throw new Error(`No session ID provided to ${method}:${path}`);
  }

  try {
    const response = await fetchWithRetry({ url: (origin || getApiBaseURL()) + path, init: config });
    const uri = response.headers.get('x-insomnia-command');
    if (uri) {
      window.main.openDeepLink(uri);
    }
    const isJson = response.headers.get('content-type')?.includes('application/json') || path.match(/\.json$/);
    return isJson ? response.json() : response.text();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('insomniaFetch timed out');
    } else {
      throw err;
    }
  }
}
