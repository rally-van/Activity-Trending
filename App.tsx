import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Dashboard } from './components/Dashboard';
import { GeminiCoach } from './components/GeminiCoach';
import { ActivityMap } from './components/ActivityMap';
import { saveActivities, getAllActivities, clearDatabase } from './services/db';
import { fetchAllActivities, authenticateWithCode, refreshStravaToken, fetchActivityDetails, fetchSegmentDetails, fetchSegmentEfforts } from './services/stravaService';
import { StravaActivity, ViewMode, StravaSegment, StravaSegmentEffort } from './types';
import { LayoutDashboard, Database, Bot, Settings, RefreshCw, Key, CheckCircle, Link as LinkIcon, LogOut, AlertTriangle, ChevronDown, ChevronUp, Globe, Copy, ExternalLink, Terminal, Lock, Unlock, Slash, RotateCcw, X, Clock, Heart, Activity as ActivityIcon, MapPin, Gauge, Calendar, TrendingUp, Shuffle, Filter, Search, Layers, Loader2, Flag, Mountain } from 'lucide-react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend, ReferenceDot, ComposedChart 
} from 'recharts';

// Helper for geospatial distance (Haversine formula)
const getDistanceFromLatLonInKm = (lat1: number, lon1: number, lat2: number, lon2: number) => {
  const R = 6371; // Radius of the earth in km
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2); 
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)); 
  return R * c;
};

// Safe check for valid lat/lng array
const isValidLatLng = (coords: any): boolean => {
    return Array.isArray(coords) && coords.length === 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number';
};

// Helper to extract a display location from activity data
const getDisplayLocation = (act: StravaActivity) => {
  if (act.location_city) {
    return `${act.location_city}${act.location_state ? `, ${act.location_state}` : ''}`;
  }
  return null;
};

// Format Helpers moved to module scope to avoid hoisting issues
const formatPace = (speed: number) => {
    if (!speed || speed === 0) return '-';
    const rawPace = (1000 / speed) / 60;
    const mins = Math.floor(rawPace);
    const secs = Math.round((rawPace - mins) * 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
};

// Calculate pace in decimal minutes for charting (e.g. 5.5 = 5:30 min/km)
const getPaceDecimal = (speed: number) => {
    if (!speed) return 0;
    return (1000 / speed) / 60;
};

const formatDuration = (seconds: number) => {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
};

const App = () => {
  const [view, setView] = useState<ViewMode>(ViewMode.DASHBOARD);
  const [activities, setActivities] = useState<StravaActivity[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncProgress, setSyncProgress] = useState(0);
  
  // Detail View State (Activity)
  const [selectedActivity, setSelectedActivity] = useState<StravaActivity | null>(null);
  const [refining, setRefining] = useState(false);
  const [useSegmentMatching, setUseSegmentMatching] = useState(false);

  // Detail View State (Segment)
  const [selectedSegmentDetail, setSelectedSegmentDetail] = useState<StravaSegment | null>(null);
  const [selectedSegmentEfforts, setSelectedSegmentEfforts] = useState<StravaSegmentEffort[]>([]);
  const [loadingSegment, setLoadingSegment] = useState(false);
  const [segmentDownloadProgress, setSegmentDownloadProgress] = useState(0);

  // Filter States
  const [nameFilter, setNameFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [minDistFilter, setMinDistFilter] = useState('');
  const [maxDistFilter, setMaxDistFilter] = useState('');
  const [geoFilter, setGeoFilter] = useState<{lat: number, lng: number, name: string} | null>(null);
  
  // Sorting State for Segments
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'effortCount', direction: 'desc' });

  // Auth State
  const [clientId, setClientId] = useState(localStorage.getItem('strava_client_id') || '');
  const [clientSecret, setClientSecret] = useState(localStorage.getItem('strava_client_secret') || '');
  
  // Helper to extract clean domain for display and default value
  const getDomainOnly = () => {
    const urlStr = window.location.href;
    // Handle blob:https://... or just blob:...
    let cleanUrl = urlStr;
    if (urlStr.startsWith('blob:')) {
        cleanUrl = urlStr.replace(/^blob:/, '');
    }
    
    try {
        // If it was blob:https://... cleanUrl is now https://...
        const url = new URL(cleanUrl);
        return url.host; 
    } catch {
        // Fallback if URL parsing fails
        return window.location.host;
    }
  };

  const [redirectUri, setRedirectUri] = useState(localStorage.getItem('strava_redirect_uri') || getDomainOnly());
  
  const [refreshToken, setRefreshToken] = useState(localStorage.getItem('strava_refresh_token') || '');
  const [accessToken, setAccessToken] = useState(localStorage.getItem('strava_access_token') || '');
  const [expiresAt, setExpiresAt] = useState(Number(localStorage.getItem('strava_expires_at')) || 0);
  
  // Manual Entry / Debug Toggles
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [showDebug, setShowDebug] = useState(false);
  
  // Manual Inputs
  const [manualCode, setManualCode] = useState('');
  const [manualAccessToken, setManualAccessToken] = useState('');
  const [manualRefreshToken, setManualRefreshToken] = useState('');

  // Prevent double-execution in React Strict Mode
  const authProcessed = useRef(false);

  // Reset segment matching when closing modal or changing activity
  useEffect(() => {
    if(!selectedActivity) {
      setUseSegmentMatching(false);
      setRefining(false);
    } else {
        // If we open a new activity, reset this unless it's just a refresh
        setUseSegmentMatching(false);
    }
  }, [selectedActivity?.id]);

  // Initialize
  useEffect(() => {
    const currentDomain = getDomainOnly();
    const stored = localStorage.getItem('strava_redirect_uri');

    // If stored URI looks like a full URL or has blob, reset it to domain only
    if (stored && (stored.includes('blob:') || stored.includes('/') || stored.includes('http'))) {
         console.warn("Legacy/Invalid redirect URI detected. Cleaning to domain only.");
         setRedirectUri(currentDomain);
         localStorage.setItem('strava_redirect_uri', currentDomain);
    } else if (!stored) {
        setRedirectUri(currentDomain);
        localStorage.setItem('strava_redirect_uri', currentDomain);
    }

    const init = async () => {
      // 1. Load Data
      const storedActivities = await getAllActivities();
      setActivities(storedActivities);

      // 2. Handle OAuth Code Callback (If this window is the popup or main window redirect)
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const error = params.get('error');

      if (error) {
        alert(`Strava Auth Error: ${error}. Please check your settings.`);
        setView(ViewMode.SETTINGS);
      }
      
      if (code) {
        // If we are inside a popup, try to notify opener
        if (window.opener) {
            console.log("Popup detected with code. Closing...");
        }
        
        setView(ViewMode.SETTINGS); 
        
        if (authProcessed.current) return;
        authProcessed.current = true;

        const storedClientId = localStorage.getItem('strava_client_id');
        const storedClientSecret = localStorage.getItem('strava_client_secret');
        
        if (storedClientId && storedClientSecret) {
          setClientId(storedClientId);
          setClientSecret(storedClientSecret);
          await handleAuthCode(code, storedClientId, storedClientSecret);
          
          if (window.opener) {
            window.close();
          } else {
             window.history.replaceState({}, document.title, window.location.pathname);
          }
        } else {
            // Only alert if we are the main window
            if (!window.opener) {
                alert("Configuration missing. Please enter Client ID and Secret again.");
            }
        }
      }
    };
    init();

    const handleStorageChange = (e: StorageEvent) => {
        if (e.key === 'strava_access_token' && e.newValue) {
            setAccessToken(e.newValue);
            setView(ViewMode.SETTINGS);
        }
        if (e.key === 'strava_refresh_token') setRefreshToken(e.newValue || '');
        if (e.key === 'strava_expires_at') setExpiresAt(Number(e.newValue));
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const handleAuthCode = async (codeOrUrl: string, cId: string, cSecret: string) => {
    setLoading(true);
    try {
      let codeToUse = codeOrUrl.trim();
      if (codeToUse.includes('code=')) {
        const match = codeToUse.match(/[?&]code=([^&]+)/);
        if (match && match[1]) {
            codeToUse = match[1];
        }
      }
      codeToUse = codeToUse.split('&')[0];

      const response = await authenticateWithCode(cId, cSecret, codeToUse);
      updateAuth(response.access_token, response.refresh_token, response.expires_at);
      
      if (!window.opener) {
         alert(`Connected successfully as ${response.athlete?.firstname}!`);
         setManualCode('');
      }
    } catch (e) {
      console.error("Auth Error:", e);
      if (!window.opener) alert("Authentication Failed: " + (e as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const updateAuth = (access: string, refresh: string, expires: number) => {
    setAccessToken(access);
    setRefreshToken(refresh);
    setExpiresAt(expires);
    localStorage.setItem('strava_access_token', access);
    localStorage.setItem('strava_refresh_token', refresh);
    localStorage.setItem('strava_expires_at', expires.toString());
  };
  
  const saveManualTokens = () => {
    if (!manualAccessToken) return alert("Access Token is required.");
    const fakeExpiry = Math.floor(Date.now() / 1000) + 20000; 
    updateAuth(manualAccessToken, manualRefreshToken, fakeExpiry);
    setManualAccessToken('');
    setManualRefreshToken('');
    setShowManualEntry(false);
    alert("Manual tokens saved.");
  };

  const getValidToken = async () => {
    const now = Math.floor(Date.now() / 1000);
    if (expiresAt && now > expiresAt - 60) {
      if (!refreshToken || !clientId || !clientSecret) {
         if (accessToken) return accessToken;
         throw new Error("Cannot refresh token. Missing credentials.");
      }
      try {
        const response = await refreshStravaToken(clientId, clientSecret, refreshToken);
        updateAuth(response.access_token, response.refresh_token, response.expires_at);
        return response.access_token;
      } catch (e) {
        throw new Error("Token refresh failed. Please reconnect.");
      }
    }
    return accessToken;
  };

  const handleSync = async () => {
    setLoading(true);
    try {
      let tokenToUse = accessToken;
      if (refreshToken && clientId) tokenToUse = await getValidToken();
      if (!tokenToUse) throw new Error("Please connect to Strava first.");

      await clearDatabase(); 
      const newActivities = await fetchAllActivities(tokenToUse, (count) => setSyncProgress(count));
      await saveActivities(newActivities);
      setActivities(newActivities);
      alert(`Sync Complete! Downloaded ${newActivities.length} activities.`);
    } catch (e: any) {
      const isAuthError = e.message && (e.message.includes("Unauthorized") || e.message.includes("401"));
      if (isAuthError) {
         if (confirm("Sync Failed: Unauthorized. Reset connection?")) disconnect();
      } else {
         alert("Sync Failed: " + e.message);
      }
      setView(ViewMode.SETTINGS);
    } finally {
      setLoading(false);
      setSyncProgress(0);
    }
  };

  // --- Segment Logic ---
  const handleSegmentClick = async (segmentId: number) => {
    if (!accessToken) return alert("Please connect to Strava first.");
    setLoadingSegment(true);
    setSegmentDownloadProgress(0);
    try {
        const token = await getValidToken();
        
        // 1. Fetch Segment Details (for full map polyline)
        const detail = await fetchSegmentDetails(token, segmentId);
        if (!detail || !detail.name) throw new Error("Invalid segment data returned from Strava.");
        setSelectedSegmentDetail(detail);

        // 2. Gather Local Efforts first (to ensure we show something even if API history is empty/restricted)
        const localEfforts: StravaSegmentEffort[] = [];
        const seenIds = new Set<number>();
        
        activities.forEach(act => {
            if (act.segment_efforts) {
                const match = act.segment_efforts.find(e => e.segment.id === segmentId);
                if (match) {
                     // Local efforts might rely on the activity timestamp, ensure we have one
                     const fullEffort = { ...match, start_date: match.start_date || act.start_date };
                     if (fullEffort.start_date) {
                        localEfforts.push(fullEffort);
                        seenIds.add(match.id);
                     }
                }
            }
        });

        // 3. Fetch Remote Efforts (API)
        let remoteEfforts: StravaSegmentEffort[] = [];
        try {
            // Updated to use callback for progress update
            remoteEfforts = await fetchSegmentEfforts(token, segmentId, (count) => setSegmentDownloadProgress(count));
            if (!Array.isArray(remoteEfforts)) remoteEfforts = [];
        } catch (err) {
            console.warn("Could not fetch remote history, using local only.", err);
        }

        // 4. Merge
        const merged = [...localEfforts];
        if(Array.isArray(remoteEfforts)) {
            remoteEfforts.forEach(re => {
                if (!seenIds.has(re.id)) {
                    merged.push(re);
                    seenIds.add(re.id);
                }
            });
        }

        setSelectedSegmentEfforts(merged.sort((a,b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime()));

    } catch (e: any) {
        alert("Failed to load segment data: " + e.message);
        // Explicitly clear selection on error so modal doesn't try to open with partial state
        setSelectedSegmentDetail(null);
    } finally {
        setLoadingSegment(false);
    }
  };

  const segmentChartData = useMemo(() => {
    if(!selectedSegmentEfforts.length) return [];
    return selectedSegmentEfforts.filter(e => e.start_date && !isNaN(new Date(e.start_date).getTime())).map(effort => ({
        date: new Date(effort.start_date).toLocaleDateString(),
        timestamp: new Date(effort.start_date).getTime(),
        timeSeconds: effort.elapsed_time,
        timeFormatted: formatDuration(effort.elapsed_time),
        hr: effort.average_heartrate ? Math.round(effort.average_heartrate) : null
    }));
  }, [selectedSegmentEfforts]);

  const saveCredentials = () => {
    localStorage.setItem('strava_client_id', clientId);
    localStorage.setItem('strava_client_secret', clientSecret);
    localStorage.setItem('strava_redirect_uri', redirectUri);
  };

  const copyToClipboard = (text: string) => {
    if(!text) return;
    navigator.clipboard.writeText(text);
    alert('Domain copied!');
  };

  const getAuthUrl = () => {
     const scope = "activity:read_all";
     let domainInput = redirectUri.trim();
     
     // CRITICAL FIX: Ensure no protocols or paths are in the domain input
     domainInput = domainInput.replace(/^https?:\/\//, '').replace(/^blob:/, '');
     domainInput = domainInput.split('/')[0]; // Remove any paths

     // Construct proper callback URL
     // We MUST NOT use window.location.protocol if it is blob:
     // Default to https unless we are clearly on localhost
     const isLocal = domainInput.includes('localhost') || domainInput.includes('127.0.0.1');
     const protocol = isLocal ? 'http' : 'https';
     
     const callbackUrl = `${protocol}://${domainInput}`;
     
     return `https://www.strava.com/oauth/authorize?client_id=${clientId}&response_type=code&redirect_uri=${encodeURIComponent(callbackUrl)}&approval_prompt=force&scope=${scope}`;
  }

  const connectToStrava = () => {
    if (!clientId) return alert("Please enter Client ID");
    if (!clientSecret) return alert("Please enter Client Secret");
    if (!redirectUri) return alert("Call Back Domain is required");
    
    saveCredentials(); 
    const authUrl = getAuthUrl();
    const isIframe = window.self !== window.top;

    let popup: Window | null = null;
    
    if (isIframe) {
        // If we are in an iframe (e.g. IDX preview), we often need a popup
        const w = 600, h = 700;
        const left = window.screen.width / 2 - w / 2;
        const top = window.screen.height / 2 - h / 2;
        popup = window.open(authUrl, 'StravaAuth', `width=${w},height=${h},left=${left},top=${top},resizable=yes,scrollbars=yes`);
    } else {
        // Standard redirect if full screen
        window.location.href = authUrl;
        return;
    }

    // POLL FOR COMPLETION (Fix for user needing to copy paste)
    if (popup) {
        const intervalId = setInterval(() => {
            if (popup.closed) {
                clearInterval(intervalId);
                return;
            }
            try {
                // This will throw if cross-origin (while user is on Strava.com)
                // Once it redirects back to our domain (even if it's a 404 page), we can read href
                const popupUrl = popup.location.href;
                
                // Check if we have the code
                if (popupUrl.includes('code=')) {
                    const urlObj = new URL(popupUrl);
                    const code = urlObj.searchParams.get('code');
                    if (code) {
                        clearInterval(intervalId);
                        popup.close();
                        console.log("Detected auth code via polling:", code);
                        handleAuthCode(code, clientId, clientSecret);
                    }
                }
            } catch (e) {
                // Ignore DOMException: Blocked a frame with origin...
                // This is expected while the user is still on Strava.com
            }
        }, 800);
    }
  };

  const disconnect = () => {
    setAccessToken('');
    setRefreshToken('');
    setExpiresAt(0);
    localStorage.removeItem('strava_access_token');
    localStorage.removeItem('strava_refresh_token');
    localStorage.removeItem('strava_expires_at');
    window.history.replaceState({}, document.title, window.location.pathname);
  };
  
  const resetRedirectUri = () => {
      const current = getDomainOnly();
      setRedirectUri(current);
      localStorage.setItem('strava_redirect_uri', current);
  }

  // Filtering Logic for Data Grid
  const filteredActivities = useMemo(() => {
      return activities.filter(act => {
          // Name Filter
          if (nameFilter && !act.name.toLowerCase().includes(nameFilter.toLowerCase())) return false;
          
          // Type Filter
          if (typeFilter !== 'All' && act.type !== typeFilter) return false;
          
          // Distance Filter
          const distKm = act.distance / 1000;
          if (minDistFilter && distKm < parseFloat(minDistFilter)) return false;
          if (maxDistFilter && distKm > parseFloat(maxDistFilter)) return false;
          
          // Geo Filter (<500m from reference)
          if (geoFilter) {
              if (!act.start_latlng || act.start_latlng.length !== 2) return false;
              const dist = getDistanceFromLatLonInKm(geoFilter.lat, geoFilter.lng, act.start_latlng[0], act.start_latlng[1]);
              if (dist > 0.5) return false;
          }
          
          return true;
      });
  }, [activities, nameFilter, typeFilter, minDistFilter, maxDistFilter, geoFilter]);

  // Unique Types for Filter Dropdown
  const uniqueTypes = useMemo(() => {
      const types = new Set(activities.map(a => a.type));
      return Array.from(types).sort();
  }, [activities]);

  // Extract Segments for Segment Grid
  const uniqueSegments = useMemo(() => {
      const segmentsMap = new Map<number, StravaSegment & { effortCount: number }>();
      activities.forEach(act => {
          if (act.segment_efforts) {
              act.segment_efforts.forEach(eff => {
                  const seg = eff.segment;
                  if (!segmentsMap.has(seg.id)) {
                      segmentsMap.set(seg.id, { ...seg, effortCount: 0 });
                  }
                  segmentsMap.get(seg.id)!.effortCount++;
              });
          }
      });
      return Array.from(segmentsMap.values());
  }, [activities]);

  // Sort Segments
  const sortedSegments = useMemo(() => {
      const sorted = [...uniqueSegments];
      sorted.sort((a, b) => {
          let aVal: any = a[sortConfig.key as keyof typeof a];
          let bVal: any = b[sortConfig.key as keyof typeof b];

          // Special case for elevation diff
          if (sortConfig.key === 'elevation_diff') {
              aVal = a.elevation_high - a.elevation_low;
              bVal = b.elevation_high - b.elevation_low;
          }

          if (aVal < bVal) return sortConfig.direction === 'asc' ? -1 : 1;
          if (aVal > bVal) return sortConfig.direction === 'asc' ? 1 : -1;
          return 0;
      });
      return sorted;
  }, [uniqueSegments, sortConfig]);

  const handleSort = (key: string) => {
      setSortConfig(current => ({
          key,
          direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc'
      }));
  };

  // Logic for Similar Activities (Modal)
  const similarActivities = useMemo(() => {
      if (!selectedActivity || activities.length === 0) return [];
      
      const toleranceDist = 0.05; // 5% distance
      const toleranceElev = 0.1;  // 10% elevation (or 20m if small)
      
      const basicMatches = activities.filter(act => {
          // Must be same type
          if (act.type !== selectedActivity.type) return false;
          
          // Distance Check
          const distDiff = Math.abs(act.distance - selectedActivity.distance);
          const maxDistDiff = selectedActivity.distance * toleranceDist;
          if (distDiff > maxDistDiff) return false;
          
          // Elevation Check
          const elevDiff = Math.abs(act.total_elevation_gain - selectedActivity.total_elevation_gain);
          const maxElevDiff = Math.max(20, selectedActivity.total_elevation_gain * toleranceElev);
          if (elevDiff > maxElevDiff) return false;

          // Location Check (Start Point)
          if (selectedActivity.start_latlng && selectedActivity.start_latlng.length === 2) {
              if (!act.start_latlng || act.start_latlng.length !== 2) return false; 
              
              const distFromStart = getDistanceFromLatLonInKm(
                  selectedActivity.start_latlng[0], selectedActivity.start_latlng[1],
                  act.start_latlng[0], act.start_latlng[1]
              );
              
              if (distFromStart > 0.5) return false; // 500 meters radius
          }
          
          return true;
      }).sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime());

      // If segment matching is enabled, filter the basic matches further
      if (useSegmentMatching && selectedActivity.segment_efforts && selectedActivity.segment_efforts.length > 0) {
          const selectedSegIds = new Set(selectedActivity.segment_efforts.map(se => se.segment.id));
          return basicMatches.filter(act => {
              if (!act.segment_efforts || act.segment_efforts.length === 0) return false;
              // Check overlap
              const matchingSegments = act.segment_efforts.filter(se => selectedSegIds.has(se.segment.id));
              // Require at least 1 shared segment to consider it the "same route"
              return matchingSegments.length > 0;
          });
      }

      return basicMatches;

  }, [selectedActivity, activities, useSegmentMatching]);
  
  const similarChartData = useMemo(() => {
      return similarActivities.map(act => ({
          date: new Date(act.start_date).toLocaleDateString(),
          timestamp: new Date(act.start_date).getTime(),
          pace: parseFloat(getPaceDecimal(act.average_speed).toFixed(2)),
          hr: act.average_heartrate ? Math.round(act.average_heartrate) : null,
          id: act.id,
          name: act.name
      }));
  }, [similarActivities]);

  const refineMatches = async () => {
      if (!selectedActivity || !accessToken) return;
      setRefining(true);
      try {
          // 1. Ensure selected activity has details (and thus segments)
          let detailedSelected = selectedActivity;
          if (!detailedSelected.segment_efforts) {
              const token = await getValidToken();
              detailedSelected = await fetchActivityDetails(token, selectedActivity.id);
              // Save to DB & State
              await saveActivities([detailedSelected]);
              setActivities(prev => prev.map(a => a.id === detailedSelected.id ? detailedSelected : a));
              setSelectedActivity(detailedSelected);
          }

          if (!detailedSelected.segment_efforts || detailedSelected.segment_efforts.length === 0) {
              alert("No segments found on this activity to match against.");
              setRefining(false);
              return;
          }

          // 2. Identify Candidates from basic match
          // Only fetch top 15 to stay safe with API limits
          const candidates = similarActivities.slice(0, 15);
          const toFetch = candidates.filter(c => !c.segment_efforts);
          
          if (toFetch.length > 0) {
              const token = await getValidToken();
              const newDetails: StravaActivity[] = [];
              
              for (const cand of toFetch) {
                  // Small throttle
                  await new Promise(r => setTimeout(r, 400));
                  try {
                      const detailed = await fetchActivityDetails(token, cand.id);
                      newDetails.push(detailed);
                  } catch (e) {
                      console.error("Failed details fetch", cand.id);
                  }
              }

              if (newDetails.length > 0) {
                  await saveActivities(newDetails);
                  setActivities(prev => {
                      const map = new Map(prev.map(p => [p.id, p]));
                      newDetails.forEach(d => map.set(d.id, d));
                      return Array.from(map.values());
                  });
              }
          }
          
          setUseSegmentMatching(true);

      } catch (e: any) {
          alert("Error syncing segments: " + e.message);
      } finally {
          setRefining(false);
      }
  };

  const NavButton = ({ mode, icon: Icon, label }: { mode: ViewMode; icon: any; label: string }) => (
    <button
      onClick={() => setView(mode)}
      className={`flex items-center gap-3 px-4 py-3 rounded-lg w-full transition-all ${
        view === mode 
          ? 'bg-blue-600 text-white shadow-lg shadow-blue-900/50' 
          : 'text-slate-400 hover:bg-slate-800 hover:text-white'
      }`}
    >
      <Icon size={20} />
      <span className="font-medium">{label}</span>
    </button>
  );

  const isSystemOnline = !!accessToken;

  return (
    <div className="flex h-screen bg-slate-950 text-slate-100 overflow-hidden">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex-shrink-0 flex flex-col">
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-400 to-indigo-400 bg-clip-text text-transparent">
            ActivityTrend
          </h1>
          <p className="text-xs text-slate-500 mt-1">Analytics & AI Coach</p>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          <NavButton mode={ViewMode.DASHBOARD} icon={LayoutDashboard} label="Dashboard" />
          <NavButton mode={ViewMode.DATA} icon={Database} label="Activity Grid" />
          <NavButton mode={ViewMode.SEGMENTS} icon={Flag} label="Segment Grid" />
          <NavButton mode={ViewMode.AI_INSIGHTS} icon={Bot} label="AI Coach" />
          <NavButton mode={ViewMode.SETTINGS} icon={Settings} label="Settings" />
        </nav>

        <div className="p-4 border-t border-slate-800">
          <div className="bg-slate-800 rounded-lg p-4">
            <div className="text-xs text-slate-400 mb-2">
              Activities Synced: <span className="text-white font-mono">{activities.length}</span>
            </div>
            <button 
              onClick={handleSync}
              disabled={loading}
              className="w-full bg-slate-700 hover:bg-slate-600 text-white text-sm py-2 rounded flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
            >
              {loading ? <RefreshCw className="animate-spin" size={14} /> : <RefreshCw size={14} />}
              {loading ? `Syncing ${syncProgress}...` : 'Sync Strava'}
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-slate-950 relative">
        <header className="sticky top-0 z-10 bg-slate-950/80 backdrop-blur-md border-b border-slate-800 p-6 flex justify-between items-center">
          <h2 className="text-xl font-semibold text-white">
            {view === ViewMode.DASHBOARD && 'Activity Dashboard'}
            {view === ViewMode.DATA && 'Raw Activity Data'}
            {view === ViewMode.SEGMENTS && 'Downloaded Segments'}
            {view === ViewMode.AI_INSIGHTS && 'Gemini AI Coach'}
            {view === ViewMode.SETTINGS && 'Strava Connection & Settings'}
          </h2>
          <div className="flex items-center gap-2">
             <span className={`h-2 w-2 rounded-full shadow-[0_0_10px] transition-colors ${isSystemOnline ? 'bg-emerald-500 shadow-emerald-500' : 'bg-red-500 shadow-red-500'}`}></span>
            <span className="text-xs text-slate-400">
              {isSystemOnline ? 'System Online' : 'Not Connected'}
            </span>
          </div>
        </header>

        <div className="p-6">
          {view === ViewMode.DASHBOARD && <Dashboard activities={activities} />}
          {view === ViewMode.AI_INSIGHTS && <GeminiCoach activities={activities} />}
          {view === ViewMode.DATA && (
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden flex flex-col h-[calc(100vh-140px)]">
              {/* Filters Toolbar */}
              <div className="p-4 bg-slate-800 border-b border-slate-700 flex flex-wrap gap-4 items-end">
                <div className="flex-1 min-w-[200px]">
                   <label className="block text-xs text-slate-400 mb-1 flex items-center gap-1"><Search size={10}/> Search Name</label>
                   <input type="text" value={nameFilter} onChange={(e) => setNameFilter(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500" placeholder="e.g. Morning Run" />
                </div>
                
                <div className="w-40">
                   <label className="block text-xs text-slate-400 mb-1 flex items-center gap-1"><Filter size={10}/> Type</label>
                   <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500">
                      <option value="All">All Types</option>
                      {uniqueTypes.map(t => <option key={t} value={t}>{t}</option>)}
                   </select>
                </div>
                
                <div className="flex gap-2 w-48">
                   <div className="flex-1">
                      <label className="block text-xs text-slate-400 mb-1">Min Km</label>
                      <input type="number" value={minDistFilter} onChange={(e) => setMinDistFilter(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500" placeholder="0" />
                   </div>
                   <div className="flex-1">
                      <label className="block text-xs text-slate-400 mb-1">Max Km</label>
                      <input type="number" value={maxDistFilter} onChange={(e) => setMaxDistFilter(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded px-2 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500" placeholder="∞" />
                   </div>
                </div>

                {geoFilter && (
                   <div className="flex items-center gap-2 bg-blue-900/40 border border-blue-500/30 px-3 py-1 rounded text-sm text-blue-200">
                      <MapPin size={14} className="text-blue-400"/>
                      <span className="max-w-[150px] truncate">Near: {geoFilter.name}</span>
                      <button onClick={() => setGeoFilter(null)} className="hover:text-white"><X size={14}/></button>
                   </div>
                )}
                
                <div className="text-xs text-slate-500 pb-2 ml-auto">
                   Showing {filteredActivities.length} of {activities.length}
                </div>
              </div>

              {/* Grid */}
              <div className="flex-1 overflow-auto">
                <table className="w-full text-sm text-left text-slate-400">
                  <thead className="text-xs text-slate-200 uppercase bg-slate-700/50 sticky top-0 backdrop-blur-sm z-10">
                    <tr>
                      <th className="px-6 py-3">Date</th>
                      <th className="px-6 py-3">Name</th>
                      <th className="px-6 py-3">Type</th>
                      <th className="px-6 py-3 text-right">Dist (km)</th>
                      <th className="px-6 py-3 text-right">Elev (m)</th>
                      <th className="px-6 py-3 text-right">HR</th>
                      <th className="px-6 py-3 text-right">Pace</th>
                      <th className="px-6 py-3 text-left">Start Point</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredActivities.map((act) => {
                      const locationDisplay = getDisplayLocation(act);
                      const hasCoordinates = isValidLatLng(act.start_latlng);
                      return (
                      <tr 
                         key={act.id} 
                         onClick={() => setSelectedActivity(act)}
                         className="border-b border-slate-700 hover:bg-slate-700/50 cursor-pointer transition-colors group"
                      >
                        <td className="px-6 py-4">{new Date(act.start_date).toLocaleDateString()}</td>
                        <td className="px-6 py-4 font-medium text-white">{act.name}</td>
                        <td className="px-6 py-4"><span className="px-2 py-1 rounded-full text-xs bg-slate-700 border border-slate-600">{act.type}</span></td>
                        <td className="px-6 py-4 text-right">{(act.distance / 1000).toFixed(2)}</td>
                        <td className="px-6 py-4 text-right">{act.total_elevation_gain}</td>
                        <td className="px-6 py-4 text-right font-mono text-xs">{act.average_heartrate ? Math.round(act.average_heartrate) : '-'}</td>
                        <td className="px-6 py-4 text-right font-mono text-xs">{formatPace(act.average_speed)}</td>
                        <td className="px-6 py-4 text-left">
                           {locationDisplay ? (
                               <button
                                 onClick={(e) => {
                                     e.stopPropagation();
                                     if(act.start_latlng) setGeoFilter({lat: act.start_latlng[0], lng: act.start_latlng[1], name: locationDisplay || act.name});
                                 }}
                                 className="hover:text-blue-400 hover:underline text-slate-300 text-sm flex items-center gap-1"
                                 title="Filter nearby"
                               >
                                  {locationDisplay}
                               </button>
                           ) : hasCoordinates ? (
                               <button
                                 onClick={(e) => {
                                     e.stopPropagation();
                                     if(act.start_latlng) setGeoFilter({lat: act.start_latlng[0], lng: act.start_latlng[1], name: act.name});
                                 }}
                                 className="hover:text-blue-400 text-slate-500 hover:bg-slate-700 p-1 rounded transition-colors"
                                 title="Filter by location (Name not available)"
                               >
                                  <MapPin size={16} />
                               </button>
                           ) : (
                             <span className="text-slate-600 text-xs">-</span>
                           )}
                        </td>
                      </tr>
                    )})}
                    {filteredActivities.length === 0 && (
                      <tr><td colSpan={8} className="px-6 py-12 text-center text-slate-500">No activities match your filters.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {view === ViewMode.SEGMENTS && (
            <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden flex flex-col h-[calc(100vh-140px)]">
              <div className="p-4 bg-slate-800 border-b border-slate-700 flex flex-wrap justify-between items-center gap-4">
                 <div>
                    <h3 className="text-white font-medium flex items-center gap-2">
                        <Flag size={18} className="text-orange-500"/> Found Segments
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                        Segments from fully synced activities. Click a segment to see detailed history.
                    </p>
                 </div>
              </div>
              
              <div className="flex-1 overflow-auto">
                <table className="w-full text-sm text-left text-slate-400">
                  <thead className="text-xs text-slate-200 uppercase bg-slate-700/50 sticky top-0 backdrop-blur-sm z-10">
                    <tr>
                      <th className="px-6 py-3 cursor-pointer hover:bg-slate-700" onClick={() => handleSort('name')}>
                        <div className="flex items-center gap-1">
                            Segment Name
                            {sortConfig.key === 'name' && (sortConfig.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>)}
                        </div>
                      </th>
                      <th className="px-6 py-3 text-right cursor-pointer hover:bg-slate-700" onClick={() => handleSort('distance')}>
                        <div className="flex items-center justify-end gap-1">
                            Distance (km)
                            {sortConfig.key === 'distance' && (sortConfig.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>)}
                        </div>
                      </th>
                      <th className="px-6 py-3 text-right cursor-pointer hover:bg-slate-700" onClick={() => handleSort('average_grade')}>
                        <div className="flex items-center justify-end gap-1">
                            Avg Grade
                            {sortConfig.key === 'average_grade' && (sortConfig.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>)}
                        </div>
                      </th>
                      <th className="px-6 py-3 text-right cursor-pointer hover:bg-slate-700" onClick={() => handleSort('maximum_grade')}>
                         <div className="flex items-center justify-end gap-1">
                            Max Grade
                            {sortConfig.key === 'maximum_grade' && (sortConfig.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>)}
                         </div>
                      </th>
                      <th className="px-6 py-3 text-right cursor-pointer hover:bg-slate-700" onClick={() => handleSort('elevation_diff')}>
                         <div className="flex items-center justify-end gap-1">
                            Elev Diff (m)
                            {sortConfig.key === 'elevation_diff' && (sortConfig.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>)}
                         </div>
                      </th>
                      <th className="px-6 py-3 text-right cursor-pointer hover:bg-slate-700" onClick={() => handleSort('effortCount')}>
                         <div className="flex items-center justify-end gap-1">
                            Recorded Efforts
                            {sortConfig.key === 'effortCount' && (sortConfig.direction === 'asc' ? <ChevronUp size={14}/> : <ChevronDown size={14}/>)}
                         </div>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedSegments.map((seg) => (
                      <tr 
                        key={seg.id} 
                        onClick={() => handleSegmentClick(seg.id)}
                        className="border-b border-slate-700 hover:bg-slate-700/50 transition-colors cursor-pointer group"
                      >
                        <td className="px-6 py-4 font-medium text-white group-hover:text-orange-400 transition-colors">{seg.name}</td>
                        <td className="px-6 py-4 text-right">{(seg.distance / 1000).toFixed(2)}</td>
                        <td className="px-6 py-4 text-right">{seg.average_grade}%</td>
                        <td className="px-6 py-4 text-right">{seg.maximum_grade}%</td>
                        <td className="px-6 py-4 text-right">{(seg.elevation_high - seg.elevation_low).toFixed(0)}</td>
                        <td className="px-6 py-4 text-right font-mono text-indigo-400">{seg.effortCount}</td>
                      </tr>
                    ))}
                    {sortedSegments.length === 0 && (
                      <tr><td colSpan={6} className="px-6 py-12 text-center text-slate-500">
                          No segments found locally. Use 'Refine Matches' in activity details to download segment data.
                      </td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {view === ViewMode.SETTINGS && (
            <div className="max-w-2xl mx-auto space-y-8 pb-20">
              {/* Settings content same as before but ensured to be here */}
              <div className="bg-slate-800 p-8 rounded-xl border border-slate-700 shadow-xl">
                <h3 className="text-lg font-bold text-white mb-6 flex items-center gap-2">
                  <Key className="text-amber-500" /> OAuth Configuration
                </h3>
                
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-slate-400 mb-1">Client ID</label>
                      <input type="text" value={clientId} onChange={(e) => setClientId(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white focus:ring-blue-500" placeholder="e.g. 123456" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-slate-400 mb-1">Client Secret</label>
                      <input type="password" value={clientSecret} onChange={(e) => setClientSecret(e.target.value)} className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white focus:ring-blue-500" placeholder="e.g. 8d3f..." />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-slate-400 mb-1 flex items-center justify-between">
                       <span className="flex items-center gap-2">
                         <Globe size={14}/> Call Back Domain
                         <Unlock size={12} className="text-slate-500" />
                       </span>
                       <div className="flex gap-2">
                         <button onClick={() => copyToClipboard(redirectUri)} className="text-xs bg-slate-700 hover:bg-slate-600 text-slate-300 border border-slate-600 px-2 py-1 rounded flex items-center gap-1 transition-colors"><Copy size={10}/> Copy</button>
                       </div>
                    </label>
                    <input 
                      type="text" 
                      value={redirectUri}
                      onChange={(e) => setRedirectUri(e.target.value)}
                      className="w-full bg-slate-900 border border-slate-600 rounded px-3 py-2 text-white text-sm font-mono focus:ring-blue-500 focus:border-blue-500"
                      placeholder="e.g. my-app.com"
                    />
                    <p className="text-xs text-slate-500 mt-1">
                        Enter the domain exactly as it appears in your Strava API settings (Authorization Callback Domain).
                    </p>
                  </div>

                  <div className="pt-4 border-t border-slate-700">
                     {!accessToken ? (
                       <button onClick={connectToStrava} className="w-full bg-[#fc4c02] hover:bg-[#e34402] text-white font-bold py-3 rounded flex items-center justify-center gap-2 transition-colors shadow-lg shadow-orange-900/20"><LinkIcon size={18} /> Connect with Strava</button>
                     ) : (
                        <button onClick={disconnect} className="w-full bg-slate-700 hover:bg-slate-600 text-slate-300 font-medium py-2 rounded flex items-center justify-center gap-2"><LogOut size={16} /> Disconnect / Reset</button>
                     )}
                  </div>
                  
                  <div className="border-t border-slate-700 pt-4 mt-4">
                    <button onClick={() => setShowManualEntry(!showManualEntry)} className="text-xs text-slate-500 hover:text-slate-300 flex items-center gap-1">
                      {showManualEntry ? <ChevronUp size={12}/> : <ChevronDown size={12}/>} Show Advanced / Manual Entry
                    </button>
                    {showManualEntry && (
                      <div className="mt-3 bg-slate-900 p-4 rounded space-y-4 border border-slate-700">
                        <div className="border-b border-slate-800 pb-4">
                          <h4 className="text-sm font-bold text-white mb-2 flex items-center gap-2"><Terminal size={14} className="text-blue-400"/> Manual Code Exchange</h4>
                          <div className="flex gap-2">
                            <input type="text" value={manualCode} onChange={(e) => setManualCode(e.target.value)} className="flex-1 bg-slate-800 border border-slate-600 rounded px-2 py-1 text-sm text-white" placeholder="Paste code or broken URL..." />
                            <button onClick={() => handleAuthCode(manualCode, clientId, clientSecret)} disabled={loading || !manualCode} className="bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded text-xs disabled:opacity-50">Exchange</button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-slate-800 p-8 rounded-xl border border-slate-700 shadow-xl">
                <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><Database className="text-red-500" /> Data Management</h3>
                <button onClick={async () => { if(confirm('Delete all local data?')) { await clearDatabase(); setActivities([]); alert('Database cleared.'); }}} className="bg-red-500/10 hover:bg-red-500/20 text-red-500 border border-red-500/50 px-4 py-2 rounded text-sm transition-colors">Clear Local Database</button>
              </div>
            </div>
          )}
        </div>
        
        {/* Loading Overlay for Segment */}
        {loadingSegment && (
            <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm">
                <div className="bg-slate-800 p-6 rounded-xl flex items-center gap-3 shadow-xl border border-slate-700">
                    <Loader2 className="animate-spin text-orange-500" />
                    <span className="text-white">Downloading full segment history... {segmentDownloadProgress > 0 && `(${segmentDownloadProgress})`}</span>
                </div>
            </div>
        )}

        {/* Segment Detail Modal */}
        {(selectedSegmentDetail && !loadingSegment) && (
           <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm" onClick={() => { setSelectedSegmentDetail(null); setSelectedSegmentEfforts([]); }}>
              <div className="bg-slate-950 border border-slate-800 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[95vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                 <div className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur border-b border-slate-800 p-6 flex justify-between items-start">
                    <div>
                        <h2 className="text-2xl font-bold text-white mb-1 flex items-center gap-2"><Flag size={20} className="text-orange-500"/> {selectedSegmentDetail.name}</h2>
                        <div className="flex flex-wrap items-center gap-4 text-slate-400 text-sm mt-2">
                           <span className="flex items-center gap-1"><ActivityIcon size={14}/> {(selectedSegmentDetail.distance / 1000).toFixed(2)} km</span>
                           <span className="flex items-center gap-1"><Mountain size={14}/> {selectedSegmentDetail.average_grade}% Avg Grade</span>
                           <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-xs text-white">
                                {selectedSegmentDetail.city}, {selectedSegmentDetail.state}
                           </span>
                        </div>
                    </div>
                    <button onClick={() => { setSelectedSegmentDetail(null); setSelectedSegmentEfforts([]); }} className="text-slate-400 hover:text-white p-2 hover:bg-slate-800 rounded-full"><X size={24}/></button>
                 </div>
                 
                 <div className="p-6 space-y-8">
                     {/* Map */}
                     <div className="w-full">
                        <ActivityMap 
                            polyline={selectedSegmentDetail.map?.polyline || selectedSegmentDetail.map?.summary_polyline} 
                            startLatlng={selectedSegmentDetail.start_latlng}
                            endLatlng={selectedSegmentDetail.end_latlng}
                        />
                     </div>
                     
                     {/* Performance Chart */}
                     <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2"><TrendingUp size={18} className="text-green-400"/> Performance History ({selectedSegmentEfforts.length} efforts)</h3>
                        <div className="h-72 w-full">
                           <ResponsiveContainer width="100%" height="100%">
                             <ComposedChart data={segmentChartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                               <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                               <XAxis dataKey="date" stroke="#94a3b8" tick={{fontSize: 12}} />
                               <YAxis yAxisId="left" stroke="#10b981" label={{ value: 'Time (s)', angle: -90, position: 'insideLeft', fill: '#10b981' }} />
                               <YAxis yAxisId="right" orientation="right" stroke="#ef4444" domain={['auto', 'auto']} />
                               <Tooltip 
                                 contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f8fafc' }}
                                 formatter={(value: any, name: string) => {
                                     if(name === 'Time') return [formatDuration(value), name];
                                     return [value, name];
                                 }}
                                 labelFormatter={(label) => `Date: ${label}`}
                               />
                               <Legend />
                               <Line yAxisId="left" type="monotone" dataKey="timeSeconds" stroke="#10b981" name="Time" strokeWidth={2} dot={segmentChartData.length > 100 ? false : {r:3}} activeDot={{r:5}} />
                               <Line yAxisId="right" type="monotone" dataKey="hr" stroke="#ef4444" name="Avg HR" strokeWidth={2} dot={false} connectNulls />
                             </ComposedChart>
                           </ResponsiveContainer>
                        </div>
                     </div>
                     
                     {/* Effort List */}
                     <div className="overflow-x-auto">
                        <table className="w-full text-sm text-left text-slate-400">
                            <thead className="text-xs text-slate-200 uppercase bg-slate-900 border-b border-slate-700">
                                <tr>
                                    <th className="px-4 py-3">Date</th>
                                    <th className="px-4 py-3">Time</th>
                                    <th className="px-4 py-3">HR</th>
                                    <th className="px-4 py-3">Pace/Speed</th>
                                </tr>
                            </thead>
                            <tbody>
                                {selectedSegmentEfforts.slice().reverse().map(eff => (
                                    <tr key={eff.id} className="border-b border-slate-800 hover:bg-slate-800">
                                        <td className="px-4 py-3">{new Date(eff.start_date).toLocaleDateString()}</td>
                                        <td className="px-4 py-3 font-mono text-white font-bold">{formatDuration(eff.elapsed_time)}</td>
                                        <td className="px-4 py-3">{eff.average_heartrate ? Math.round(eff.average_heartrate) : '-'}</td>
                                        <td className="px-4 py-3">{formatDuration(eff.elapsed_time)}</td> 
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                     </div>
                 </div>
              </div>
           </div>
        )}
        
        {/* Activity Detail Modal */}
        {selectedActivity && (
           <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={() => setSelectedActivity(null)}>
              <div className="bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
                 <div className="sticky top-0 z-20 bg-slate-900/95 backdrop-blur border-b border-slate-800 p-6 flex justify-between items-start">
                    <div>
                        <h2 className="text-2xl font-bold text-white mb-1">{selectedActivity.name}</h2>
                        <div className="flex items-center gap-3 text-slate-400 text-sm">
                           <span className="flex items-center gap-1"><Calendar size={14}/> {new Date(selectedActivity.start_date).toLocaleString()}</span>
                           <span className="px-2 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-xs text-white">{selectedActivity.type}</span>
                        </div>
                    </div>
                    <button onClick={() => setSelectedActivity(null)} className="text-slate-400 hover:text-white p-2 hover:bg-slate-800 rounded-full"><X size={24}/></button>
                 </div>
                 
                 <div className="p-6 space-y-8">
                    {/* Map Section */}
                    {selectedActivity.map?.summary_polyline ? (
                        <div className="w-full">
                           <ActivityMap 
                              polyline={selectedActivity.map.summary_polyline} 
                              startLatlng={selectedActivity.start_latlng}
                              endLatlng={selectedActivity.end_latlng}
                           />
                        </div>
                    ) : (isValidLatLng(selectedActivity.start_latlng) && (
                        /* Fallback if no polyline but has start point (e.g. manual entry or obfuscated) */
                        <div className="w-full">
                           <ActivityMap 
                              startLatlng={selectedActivity.start_latlng}
                              endLatlng={selectedActivity.end_latlng}
                           />
                        </div>
                    ))}

                    {/* Stats Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                       <div className="bg-slate-800 p-4 rounded-xl">
                          <p className="text-xs text-slate-500 mb-1 flex items-center gap-1"><ActivityIcon size={12}/> Distance</p>
                          <p className="text-xl font-bold text-white">{(selectedActivity.distance / 1000).toFixed(2)} <span className="text-sm font-normal text-slate-500">km</span></p>
                       </div>
                       <div className="bg-slate-800 p-4 rounded-xl">
                          <p className="text-xs text-slate-500 mb-1 flex items-center gap-1"><Clock size={12}/> Duration</p>
                          <p className="text-xl font-bold text-white">{formatDuration(selectedActivity.moving_time)}</p>
                       </div>
                       <div className="bg-slate-800 p-4 rounded-xl">
                          <p className="text-xs text-slate-500 mb-1 flex items-center gap-1"><TrendingUp size={12}/> Elevation</p>
                          <p className="text-xl font-bold text-white">{selectedActivity.total_elevation_gain} <span className="text-sm font-normal text-slate-500">m</span></p>
                       </div>
                       <div className="bg-slate-800 p-4 rounded-xl">
                          <p className="text-xs text-slate-500 mb-1 flex items-center gap-1"><Gauge size={12}/> Avg Pace</p>
                          <p className="text-xl font-bold text-white">{formatPace(selectedActivity.average_speed)} <span className="text-sm font-normal text-slate-500">/km</span></p>
                       </div>
                    </div>

                    {/* Similar Efforts Analysis */}
                    {similarActivities.length > 1 && (
                      <div className="bg-slate-800 rounded-xl p-6 border border-slate-700">
                         <div className="flex items-center justify-between mb-6">
                            <div>
                               <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                  <Shuffle size={18} className="text-blue-400"/> Similar Efforts Analysis
                               </h3>
                               <p className="text-xs text-slate-400 mt-1">
                                   {useSegmentMatching 
                                     ? "Strictly matched by shared segments (overlaps)." 
                                     : "Matched by Type, Distance (±5%), Elevation & Start Location."}
                               </p>
                            </div>
                            <div className="flex items-center gap-3">
                                {useSegmentMatching ? (
                                    <button 
                                        onClick={() => setUseSegmentMatching(false)}
                                        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-700 hover:bg-slate-600 text-xs font-medium text-slate-300 transition-colors"
                                    >
                                        <X size={12} /> Clear Segment Filter
                                    </button>
                                ) : (
                                    <button 
                                        onClick={refineMatches}
                                        disabled={refining}
                                        className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-indigo-600 hover:bg-indigo-500 text-xs font-medium text-white transition-colors disabled:opacity-50"
                                    >
                                        {refining ? <Loader2 size={12} className="animate-spin"/> : <Layers size={12} />}
                                        {refining ? "Fetching Segments..." : "Sync Segments for Precision"}
                                    </button>
                                )}
                                <span className="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded-full">{similarActivities.length} matches</span>
                            </div>
                         </div>
                         
                         <div className="h-64 w-full">
                           <ResponsiveContainer width="100%" height="100%">
                             <ComposedChart data={similarChartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                               <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                               <XAxis dataKey="date" stroke="#94a3b8" tick={{fontSize: 12}} />
                               <YAxis yAxisId="left" stroke="#ef4444" label={{ value: 'HR (bpm)', angle: -90, position: 'insideLeft', fill: '#ef4444' }} domain={['auto', 'auto']} />
                               <YAxis yAxisId="right" orientation="right" stroke="#8b5cf6" label={{ value: 'Pace (min/km)', angle: 90, position: 'insideRight', fill: '#8b5cf6' }} domain={['auto', 'auto']} reversed />
                               <Tooltip 
                                 contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f8fafc' }}
                                 labelFormatter={(label) => `Date: ${label}`}
                                 formatter={(value: any, name: string) => {
                                     if(name === 'Pace') {
                                         // Convert decimal minutes back to MM:SS
                                         const mins = Math.floor(value);
                                         const secs = Math.round((value - mins) * 60);
                                         return [`${mins}:${secs.toString().padStart(2, '0')} /km`, name];
                                     }
                                     return [value, name];
                                 }}
                               />
                               <Legend />
                               <Line yAxisId="left" type="monotone" dataKey="hr" stroke="#ef4444" name="Avg HR" strokeWidth={2} dot={false} />
                               <Line yAxisId="right" type="monotone" dataKey="pace" stroke="#8b5cf6" name="Pace" strokeWidth={2} dot={(props: any) => {
                                   const isSelected = props.payload.id === selectedActivity.id;
                                   if (!isSelected) return <circle cx={props.cx} cy={props.cy} r={3} fill="#8b5cf6" opacity={0.5} />;
                                   return (
                                     <g>
                                       <circle cx={props.cx} cy={props.cy} r={6} fill="#fff" stroke="#8b5cf6" strokeWidth={2} />
                                       <circle cx={props.cx} cy={props.cy} r={12} fill="none" stroke="#fff" strokeWidth={1} opacity={0.5} />
                                     </g>
                                   );
                               }} />
                             </ComposedChart>
                           </ResponsiveContainer>
                         </div>

                         {/* Mini List of Similar Activities */}
                         <div className="mt-6 border-t border-slate-700 pt-4">
                            <h4 className="text-sm font-semibold text-slate-300 mb-3">Comparison Table</h4>
                            <div className="max-h-40 overflow-y-auto pr-2 space-y-2">
                               {similarActivities.slice().reverse().map(act => (
                                  <div 
                                    key={act.id} 
                                    onClick={() => setSelectedActivity(act)}
                                    className={`flex justify-between items-center p-2 rounded text-xs cursor-pointer transition-colors ${act.id === selectedActivity.id ? 'bg-blue-600/20 border border-blue-500/50' : 'bg-slate-900 hover:bg-slate-700'}`}
                                  >
                                     <span className="text-slate-300 w-24">{new Date(act.start_date).toLocaleDateString()}</span>
                                     <span className="text-white font-medium flex-1 truncate px-2">{act.name}</span>
                                     <div className="flex gap-4 text-right">
                                        <span className={`font-mono ${act.id === selectedActivity.id ? 'text-blue-300' : 'text-slate-400'}`}>
                                            {formatPace(act.average_speed)}
                                        </span>
                                        <span className={`font-mono w-8 ${act.average_heartrate ? 'text-red-400' : 'text-slate-600'}`}>
                                            {act.average_heartrate ? Math.round(act.average_heartrate) : '-'}
                                        </span>
                                     </div>
                                  </div>
                               ))}
                            </div>
                         </div>
                      </div>
                    )}

                    {/* Advanced Stats */}
                    <div className="bg-slate-800/50 rounded-xl p-6 border border-slate-800">
                        <h3 className="text-sm font-bold text-white mb-4 uppercase tracking-wider">Analysis</h3>
                        <div className="space-y-4">
                           <div className="flex justify-between items-center border-b border-slate-700/50 pb-2">
                              <span className="text-slate-400 text-sm">Heart Rate</span>
                              <div className="text-right">
                                  <span className="block text-white font-medium">{selectedActivity.average_heartrate ? Math.round(selectedActivity.average_heartrate) : '-'} <span className="text-xs text-slate-500">bpm (avg)</span></span>
                                  {selectedActivity.max_heartrate && <span className="text-xs text-slate-500">Max: {selectedActivity.max_heartrate} bpm</span>}
                              </div>
                           </div>
                           <div className="flex justify-between items-center border-b border-slate-700/50 pb-2">
                              <span className="text-slate-400 text-sm">Speed</span>
                              <div className="text-right">
                                  <span className="block text-white font-medium">{(selectedActivity.average_speed * 3.6).toFixed(1)} <span className="text-xs text-slate-500">km/h</span></span>
                                  <span className="text-xs text-slate-500">Max: {(selectedActivity.max_speed * 3.6).toFixed(1)} km/h</span>
                              </div>
                           </div>
                           <div className="flex justify-between items-center pb-2">
                              <span className="text-slate-400 text-sm">Elapsed Time</span>
                              <span className="text-white font-medium">{formatDuration(selectedActivity.elapsed_time)}</span>
                           </div>
                        </div>
                    </div>
                    
                    {/* JSON Dump (Optional, hidden by default or small) */}
                    <div className="pt-4">
                       <details className="text-xs text-slate-500 cursor-pointer">
                          <summary className="hover:text-slate-300">Raw Data View</summary>
                          <pre className="mt-2 bg-slate-950 p-4 rounded overflow-x-auto text-emerald-400 font-mono">
                             {JSON.stringify(selectedActivity, null, 2)}
                          </pre>
                       </details>
                    </div>
                 </div>
              </div>
           </div>
        )}
      </main>
    </div>
  );
};

export default App;