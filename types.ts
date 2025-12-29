// Strava Data Types
export interface StravaSegment {
  id: number;
  name: string;
  distance: number;
  average_grade: number;
  maximum_grade: number;
  elevation_high: number;
  elevation_low: number;
  start_latlng: [number, number];
  end_latlng: [number, number];
  // Detailed segment fields
  map?: {
    polyline: string;
    summary_polyline?: string;
  };
  city?: string;
  state?: string;
  country?: string;
}

export interface StravaSegmentEffort {
  id: number;
  resource_state: number;
  name: string;
  activity: { id: number };
  athlete: { id: number };
  elapsed_time: number;
  moving_time: number;
  start_date: string;
  start_date_local: string;
  distance: number;
  start_index: number;
  end_index: number;
  segment: StravaSegment;
  average_heartrate?: number;
  max_heartrate?: number;
}

export interface StravaActivity {
  id: number;
  name: string;
  distance: number; // meters
  moving_time: number; // seconds
  elapsed_time: number; // seconds
  total_elevation_gain: number; // meters
  type: string;
  sport_type: string;
  start_date: string;
  start_date_local: string;
  timezone: string; // e.g., "(GMT-08:00) America/Los_Angeles"
  average_speed: number;
  max_speed: number;
  average_heartrate?: number;
  max_heartrate?: number;
  start_latlng?: [number, number];
  end_latlng?: [number, number];
  map?: {
    summary_polyline: string;
  };
  location_city?: string;
  location_state?: string;
  location_country?: string;
  kudos_count: number;
  achievement_count: number;
  segment_efforts?: StravaSegmentEffort[];
}

export interface DateGroupedStats {
  period: string;
  distance: number;
  elevation: number;
  count: number;
  time: number;
  avgSpeed: number;
}

export interface AppConfig {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  accessToken: string;
  expiresAt: number;
}

export interface StravaAuthResponse {
  token_type: string;
  expires_at: number;
  expires_in: number;
  refresh_token: string;
  access_token: string;
  athlete: any;
}

export enum ViewMode {
  DASHBOARD = 'DASHBOARD',
  DATA = 'DATA',
  SEGMENTS = 'SEGMENTS',
  AI_INSIGHTS = 'AI_INSIGHTS',
  SETTINGS = 'SETTINGS'
}