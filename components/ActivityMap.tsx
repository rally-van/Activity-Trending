import React, { useEffect, useRef } from 'react';
import L from 'leaflet';

interface ActivityMapProps {
  polyline?: string | null;
  startLatlng?: [number, number];
  endLatlng?: [number, number];
}

// Polyline decoder utility (Google Encoded Polyline Algorithm Format)
const decodePolyline = (str: string, precision?: number) => {
    if (!str || typeof str !== 'string') return [];
    
    let index = 0,
        lat = 0,
        lng = 0,
        coordinates = [],
        shift = 0,
        result = 0,
        byte = null,
        latitude_change,
        longitude_change,
        factor = Math.pow(10, precision || 5);

    while (index < str.length) {
        byte = null;
        shift = 0;
        result = 0;

        do {
            byte = str.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);

        latitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
        shift = result = 0;

        do {
            byte = str.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);

        longitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));

        lat += latitude_change;
        lng += longitude_change;

        coordinates.push([lat / factor, lng / factor] as [number, number]);
    }

    return coordinates;
};

// Helper to validate a coordinate pair
const isValidLatLng = (coords: any): coords is [number, number] => {
    return Array.isArray(coords) && coords.length === 2 && typeof coords[0] === 'number' && typeof coords[1] === 'number';
};

export const ActivityMap: React.FC<ActivityMapProps> = ({ polyline, startLatlng, endLatlng }) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const boundsRef = useRef<L.LatLngBounds | null>(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    
    // Initialize map if not already done
    if (!mapInstanceRef.current) {
        mapInstanceRef.current = L.map(mapContainerRef.current).setView([0, 0], 13);
        
        // Add Light Mode Tiles (CartoDB Positron)
        L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
            subdomains: 'abcd',
            maxZoom: 20
        }).addTo(mapInstanceRef.current);
    }

    const map = mapInstanceRef.current;
    
    // Clear existing layers (except tile layer)
    map.eachLayer((layer) => {
        if (!(layer instanceof L.TileLayer)) {
            map.removeLayer(layer);
        }
    });

    // Reset bounds ref
    boundsRef.current = null;

    const latlngs = (polyline && typeof polyline === 'string') ? decodePolyline(polyline) : [];

    // Draw Polyline
    if (latlngs.length > 0) {
        const polylineLayer = L.polyline(latlngs, {
            color: '#3b82f6', // blue-500
            weight: 4,
            opacity: 0.8,
            lineJoin: 'round'
        }).addTo(map);

        const bounds = polylineLayer.getBounds();
        map.fitBounds(bounds, { padding: [50, 50] });
        boundsRef.current = bounds;
    } else if (isValidLatLng(startLatlng)) {
        map.setView(startLatlng, 13);
    }

    // Add Start Marker (Green Circle)
    if (isValidLatLng(startLatlng)) {
        L.circleMarker(startLatlng, {
            radius: 8,
            fillColor: '#10b981', // emerald-500
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 1
        }).addTo(map).bindPopup("Start");
    }

    // Add End Marker (Red Square-ish/Circle)
    if (isValidLatLng(endLatlng)) {
        L.circleMarker(endLatlng, {
            radius: 8,
            fillColor: '#ef4444', // red-500
            color: '#ffffff',
            weight: 2,
            opacity: 1,
            fillOpacity: 1
        }).addTo(map).bindPopup("Finish");
    }
    
    // Use ResizeObserver to handle container size changes (modal animations, etc.)
    const resizeObserver = new ResizeObserver(() => {
        if (!map) return;
        map.invalidateSize();
        // Re-fit bounds after resize if we have them
        if (boundsRef.current) {
             map.fitBounds(boundsRef.current, { padding: [50, 50] });
        } else if (isValidLatLng(startLatlng)) {
             map.setView(startLatlng, map.getZoom());
        }
    });
    
    resizeObserver.observe(mapContainerRef.current);
    
    // Force a resize/fit check shortly after mount to handle modal transitions
    setTimeout(() => {
        map.invalidateSize();
        if (boundsRef.current) {
             map.fitBounds(boundsRef.current, { padding: [50, 50] });
        }
    }, 300);

    return () => {
        resizeObserver.disconnect();
    };
  }, [polyline, startLatlng, endLatlng]);

  return (
    <div className="w-full h-[400px] rounded-xl overflow-hidden border border-slate-700 shadow-lg relative z-0">
        <div ref={mapContainerRef} className="w-full h-full bg-slate-100" />
    </div>
  );
};