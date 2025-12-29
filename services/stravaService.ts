import { StravaActivity, StravaAuthResponse, StravaSegment, StravaSegmentEffort } from '../types';

const STRAVA_API_BASE = 'https://www.strava.com/api/v3';
const STRAVA_OAUTH_BASE = 'https://www.strava.com/oauth/token';

// Helper to handle potential CORS issues by falling back to a proxy.
// Modified to support POST for auth flow and optional token.
const fetchWithProxyFallback = async (url: string, method: 'GET' | 'POST' = 'GET', token?: string) => {
  const headers: HeadersInit = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  
  const options: RequestInit = { method, headers };

  console.log(`[Strava] ${method} Request: ${url}`);

  try {
    // Attempt 1: Direct Fetch
    const response = await fetch(url, options);
    
    if (response.ok) {
      // console.log("[Strava] Direct fetch successful");
      return response.json();
    }
    
    // If 401, propagate error immediately (auth issue)
    if (response.status === 401) {
       const err = await response.json().catch(() => ({}));
       throw new Error(err.message || "Unauthorized: Check credentials.");
    }

    // For other errors, try proxy
    throw new Error(`Direct API Error: ${response.status}`);
  } catch (err: any) {
    if (err.message && (err.message.includes("Unauthorized") || err.message.includes("401"))) throw err;

    // Attempt 2: CORS Proxy
    // console.warn("[Strava] Retrying via CORS Proxy...", err.message);
    const proxyUrl = `https://corsproxy.io/?${encodeURIComponent(url)}`;
    
    const response = await fetch(proxyUrl, options);
    
    if (!response.ok) {
      // Check specifically for 401 from the proxy response
      if (response.status === 401) {
        throw new Error("Unauthorized: Access token is invalid or expired.");
      }
      throw new Error(`API Error (via Proxy): ${response.status} ${response.statusText}`);
    }
    // console.log("[Strava] Proxy fetch successful");
    return response.json();
  }
}

export const authenticateWithCode = async (clientId: string, clientSecret: string, code: string): Promise<StravaAuthResponse> => {
  const url = `${STRAVA_OAUTH_BASE}?client_id=${clientId}&client_secret=${clientSecret}&code=${code}&grant_type=authorization_code`;
  return fetchWithProxyFallback(url, 'POST');
};

export const refreshStravaToken = async (clientId: string, clientSecret: string, refreshToken: string): Promise<StravaAuthResponse> => {
  const url = `${STRAVA_OAUTH_BASE}?client_id=${clientId}&client_secret=${clientSecret}&refresh_token=${refreshToken}&grant_type=refresh_token`;
  return fetchWithProxyFallback(url, 'POST');
};

export const getAthleteProfile = async (accessToken: string) => {
  const url = `${STRAVA_API_BASE}/athlete`;
  return fetchWithProxyFallback(url, 'GET', accessToken);
};

export const fetchActivityDetails = async (accessToken: string, id: number): Promise<StravaActivity> => {
  const url = `${STRAVA_API_BASE}/activities/${id}`;
  return fetchWithProxyFallback(url, 'GET', accessToken);
};

export const fetchSegmentDetails = async (accessToken: string, segmentId: number): Promise<StravaSegment> => {
  const url = `${STRAVA_API_BASE}/segments/${segmentId}`;
  return fetchWithProxyFallback(url, 'GET', accessToken);
};

export const fetchSegmentEfforts = async (accessToken: string, segmentId: number, progressCallback?: (count: number) => void): Promise<StravaSegmentEffort[]> => {
  let allEfforts: StravaSegmentEffort[] = [];
  let page = 1;
  const perPage = 200; // Max allowed by Strava
  let hasMore = true;

  // Loop until we get an empty array.
  // This is safer than checking (length < perPage) because Strava might ignore perPage 
  // and default to 30, causing premature termination in the previous logic.
  while (hasMore) {
    const url = `${STRAVA_API_BASE}/segment_efforts?segment_id=${segmentId}&per_page=${perPage}&page=${page}`;
    
    // Add small delay to prevent rate limit issues
    await new Promise(r => setTimeout(r, 100));

    const response = await fetchWithProxyFallback(url, 'GET', accessToken);
    
    if (Array.isArray(response)) {
        if (response.length === 0) {
            hasMore = false;
        } else {
            allEfforts = [...allEfforts, ...response];
            if (progressCallback) progressCallback(allEfforts.length);
            page++;
        }
    } else {
        console.warn("Unexpected segment efforts response:", response);
        hasMore = false; 
    }

    if (page > 50) hasMore = false; // Safety cap (approx 10k records)
  }

  return allEfforts;
};

export const fetchAthleteActivities = async (accessToken: string, page: number = 1, perPage: number = 30): Promise<StravaActivity[]> => {
  const url = `${STRAVA_API_BASE}/athlete/activities?page=${page}&per_page=${perPage}`;
  return fetchWithProxyFallback(url, 'GET', accessToken);
};

export const fetchAllActivities = async (accessToken: string, progressCallback: (count: number) => void): Promise<StravaActivity[]> => {
  let allActivities: StravaActivity[] = [];
  let page = 1;
  const perPage = 200;
  let hasMore = true;

  while (hasMore) {
    try {
      const activities = await fetchAthleteActivities(accessToken, page, perPage);
      
      if (!Array.isArray(activities)) {
        console.error("Unexpected API response:", activities);
        throw new Error("Invalid API response format.");
      }

      if (activities.length === 0) {
        hasMore = false;
      } else {
        allActivities = [...allActivities, ...activities];
        progressCallback(allActivities.length);
        page++;
        if (page > 500) break; // Safety break
      }
    } catch (e) {
      console.error("Sync interrupted:", e);
      throw e;
    }
  }
  return allActivities;
};