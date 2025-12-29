import React, { useMemo, useState } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
  PieChart, Pie, Cell, ScatterChart, Scatter, Brush
} from 'recharts';
import { StravaActivity } from '../types';
import { Calendar, Activity, TrendingUp } from 'lucide-react';

interface DashboardProps {
  activities: StravaActivity[];
}

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

// Helper to get ISO week number and year
const getWeekNumber = (d: Date) => {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return { year: d.getUTCFullYear(), week: weekNo };
};

export const Dashboard: React.FC<DashboardProps> = ({ activities }) => {
  // State to toggle visibility of chart series
  const [hiddenKeys, setHiddenKeys] = useState<string[]>([]);

  const handleLegendClick = (e: any) => {
    const dataKey = e.dataKey;
    setHiddenKeys(prev => 
      prev.includes(dataKey) 
        ? prev.filter(key => key !== dataKey) 
        : [...prev, dataKey]
    );
  };

  // 1. Monthly Volume (Distance)
  const monthlyData = useMemo(() => {
    const grouped: Record<string, { name: string; distance: number; elevation: number; runs: number; rides: number }> = {};
    
    activities.forEach(act => {
      const date = new Date(act.start_date);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      
      if (!grouped[key]) {
        grouped[key] = { name: key, distance: 0, elevation: 0, runs: 0, rides: 0 };
      }
      
      grouped[key].distance += act.distance / 1000; // to km
      grouped[key].elevation += act.total_elevation_gain;
      if (act.type === 'Run') grouped[key].runs += act.distance / 1000;
      if (act.type === 'Ride') grouped[key].rides += act.distance / 1000;
    });

    return Object.values(grouped).sort((a, b) => a.name.localeCompare(b.name)).map(item => ({
        ...item,
        distance: parseFloat(item.distance.toFixed(1)),
        runs: parseFloat(item.runs.toFixed(1)),
        rides: parseFloat(item.rides.toFixed(1))
    }));
  }, [activities]);

  // 2. Weekly Volume
  const weeklyData = useMemo(() => {
      const grouped: Record<string, { name: string; total: number; runs: number; rides: number }> = {};
      
      activities.forEach(act => {
          const date = new Date(act.start_date);
          const { year, week } = getWeekNumber(date);
          const key = `${year}-W${String(week).padStart(2, '0')}`;
          
          if(!grouped[key]) {
              grouped[key] = { name: key, total: 0, runs: 0, rides: 0 };
          }
          const km = act.distance / 1000;
          grouped[key].total += km;
          if (act.type === 'Run') grouped[key].runs += km;
          if (act.type === 'Ride') grouped[key].rides += km;
      });

      return Object.values(grouped).sort((a, b) => a.name.localeCompare(b.name)).map(item => ({
          ...item,
          total: parseFloat(item.total.toFixed(1)),
          runs: parseFloat(item.runs.toFixed(1)),
          rides: parseFloat(item.rides.toFixed(1))
      }));
  }, [activities]);

  // 3. Activity Type Breakdown
  const typeData = useMemo(() => {
    const grouped: Record<string, number> = {};
    activities.forEach(act => {
      grouped[act.type] = (grouped[act.type] || 0) + 1;
    });
    return Object.keys(grouped).map(key => ({ name: key, value: grouped[key] }));
  }, [activities]);

  // 4. Scatter: Distance vs Elevation (Intensity)
  const scatterData = useMemo(() => {
    return activities.map(a => ({
      x: parseFloat((a.distance / 1000).toFixed(1)),
      y: a.total_elevation_gain,
      z: a.average_speed,
      type: a.type,
      name: a.name
    })).filter(a => a.x > 0);
  }, [activities]);

  // 5. Distance Distribution (Histogram)
  const distanceDistData = useMemo(() => {
      const buckets = { '0-5km': 0, '5-10km': 0, '10-20km': 0, '20-50km': 0, '50km+': 0 };
      activities.forEach(act => {
          const dist = act.distance / 1000;
          if (dist < 5) buckets['0-5km']++;
          else if (dist < 10) buckets['5-10km']++;
          else if (dist < 20) buckets['10-20km']++;
          else if (dist < 50) buckets['20-50km']++;
          else buckets['50km+']++;
      });
      return Object.entries(buckets).map(([range, count]) => ({ name: range, count }));
  }, [activities]);

  if (activities.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-96 text-slate-500">
        <Activity size={48} className="mb-4 opacity-50" />
        <p>No activities found. Please sync your Strava data in Settings.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
          <div className="flex items-center justify-between pb-2">
            <h3 className="text-slate-400 text-sm font-medium">Total Activities</h3>
            <Calendar className="text-blue-500 w-5 h-5" />
          </div>
          <p className="text-3xl font-bold text-white">{activities.length}</p>
        </div>
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
          <div className="flex items-center justify-between pb-2">
            <h3 className="text-slate-400 text-sm font-medium">Total Distance</h3>
            <Activity className="text-emerald-500 w-5 h-5" />
          </div>
          <p className="text-3xl font-bold text-white">
            {(activities.reduce((acc, curr) => acc + curr.distance, 0) / 1000).toLocaleString(undefined, { maximumFractionDigits: 0 })} km
          </p>
        </div>
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
          <div className="flex items-center justify-between pb-2">
            <h3 className="text-slate-400 text-sm font-medium">Total Elevation</h3>
            <TrendingUp className="text-amber-500 w-5 h-5" />
          </div>
          <p className="text-3xl font-bold text-white">
            {activities.reduce((acc, curr) => acc + curr.total_elevation_gain, 0).toLocaleString()} m
          </p>
        </div>
      </div>

      {/* Main Charts Row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Monthly Volume - Changed to LineChart */}
        <div className="lg:col-span-2 bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
          <h3 className="text-lg font-semibold text-white mb-6">Monthly Volume (By Type)</h3>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={monthlyData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" stroke="#94a3b8" />
                <YAxis stroke="#94a3b8" />
                <Tooltip 
                  formatter={(value: number) => value.toFixed(1)}
                  contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f8fafc' }}
                />
                <Legend verticalAlign="top" onClick={handleLegendClick} cursor="pointer" />
                <Line type="monotone" dataKey="runs" stroke="#10b981" strokeWidth={2} name="Run Distance (km)" hide={hiddenKeys.includes('runs')} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                <Line type="monotone" dataKey="rides" stroke="#3b82f6" strokeWidth={2} name="Ride Distance (km)" hide={hiddenKeys.includes('rides')} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                <Brush 
                  dataKey="name" 
                  height={30} 
                  stroke="#64748b" 
                  fill="#1e293b"
                  startIndex={Math.max(0, monthlyData.length - 24)}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Breakdown Pie */}
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
          <h3 className="text-lg font-semibold text-white mb-6">Activity Types</h3>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={typeData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  fill="#8884d8"
                  paddingAngle={5}
                  dataKey="value"
                >
                  {typeData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip 
                   contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f8fafc' }}
                />
                <Legend layout="vertical" verticalAlign="middle" align="right" />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

       {/* Weekly Volume - Changed to LineChart */}
       <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
          <h3 className="text-lg font-semibold text-white mb-6">Weekly Volume (Last 52 Weeks)</h3>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={weeklyData} margin={{ top: 20, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                <XAxis dataKey="name" stroke="#94a3b8" tickFormatter={(v) => v.split('-W')[1]} />
                <YAxis stroke="#94a3b8" />
                <Tooltip 
                  formatter={(value: number) => value.toFixed(1)}
                  contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f8fafc' }}
                />
                <Legend verticalAlign="top" onClick={handleLegendClick} cursor="pointer" />
                <Line type="monotone" dataKey="runs" stroke="#10b981" strokeWidth={2} name="Run Distance (km)" hide={hiddenKeys.includes('runs')} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                <Line type="monotone" dataKey="rides" stroke="#3b82f6" strokeWidth={2} name="Ride Distance (km)" hide={hiddenKeys.includes('rides')} dot={{ r: 3 }} activeDot={{ r: 5 }} />
                <Brush 
                  dataKey="name" 
                  height={30} 
                  stroke="#64748b" 
                  fill="#1e293b"
                  startIndex={Math.max(0, weeklyData.length - 52)}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

      {/* Row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
         {/* Distance Distribution */}
         <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
           <h3 className="text-lg font-semibold text-white mb-6">Distance Distribution (Histogram)</h3>
           <div className="h-80 w-full">
             <ResponsiveContainer width="100%" height="100%">
               <LineChart data={distanceDistData} margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                 <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
                 <XAxis dataKey="name" stroke="#94a3b8" />
                 <YAxis stroke="#94a3b8" />
                 <Tooltip contentStyle={{ backgroundColor: '#1e293b', borderColor: '#475569', color: '#f8fafc' }} />
                 <Line type="monotone" dataKey="count" stroke="#8b5cf6" strokeWidth={3} name="Activity Count" dot={{ r: 4 }} />
               </LineChart>
             </ResponsiveContainer>
           </div>
         </div>

        {/* Elevation vs Distance */}
        <div className="bg-slate-800 p-6 rounded-xl border border-slate-700 shadow-lg">
          <h3 className="text-lg font-semibold text-white mb-6">Effort Matrix: Distance vs Elevation</h3>
          <div className="h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                <CartesianGrid stroke="#334155" />
                <XAxis type="number" dataKey="x" name="Distance" unit="km" stroke="#94a3b8" />
                <YAxis type="number" dataKey="y" name="Elevation" unit="m" stroke="#94a3b8" />
                <Tooltip cursor={{ strokeDasharray: '3 3' }} content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const data = payload[0].payload;
                    return (
                      <div className="bg-slate-900 border border-slate-700 p-3 rounded text-sm text-slate-200">
                        <p className="font-bold">{data.name}</p>
                        <p>{data.type}</p>
                        <p>{data.x} km / {data.y} m</p>
                      </div>
                    );
                  }
                  return null;
                }} />
                <Scatter name="Activities" data={scatterData} fill="#8b5cf6" fillOpacity={0.6} />
              </ScatterChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};