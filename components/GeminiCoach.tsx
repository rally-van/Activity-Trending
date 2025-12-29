import React, { useState } from 'react';
import { StravaActivity } from '../types';
import { generateFitnessInsight } from '../services/geminiService';
import { Sparkles, Send, Loader2, Bot } from 'lucide-react';
import ReactMarkdown from 'react-markdown'; // Actually, let's just use simple formatting for simplicity if library not guaranteed, but standard imports assume available. I'll use simple span rendering to be safe.

interface GeminiCoachProps {
  activities: StravaActivity[];
}

export const GeminiCoach: React.FC<GeminiCoachProps> = ({ activities }) => {
  const [query, setQuery] = useState('');
  const [response, setResponse] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleAsk = async () => {
    if (!query.trim()) return;
    setLoading(true);
    const result = await generateFitnessInsight(activities, query);
    setResponse(result || "No response generated.");
    setLoading(false);
  };

  const suggestions = [
    "What is my weekly mileage trend?",
    "Compare my running vs cycling performance.",
    "Am I training too hard based on elevation gain?",
    "Give me a summary of my last month."
  ];

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="bg-gradient-to-r from-indigo-900 to-slate-900 p-8 rounded-2xl border border-indigo-700 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 -mt-10 -mr-10 w-32 h-32 bg-indigo-500 rounded-full blur-3xl opacity-20"></div>
        <div className="relative z-10">
          <h2 className="text-3xl font-bold text-white flex items-center gap-3 mb-2">
            <Sparkles className="text-indigo-400" /> AI Performance Coach
          </h2>
          <p className="text-indigo-200">
            Powered by Gemini 2.0 Flash. Ask deep questions about your training history.
          </p>
        </div>
      </div>

      <div className="bg-slate-800 rounded-xl border border-slate-700 p-6 shadow-lg min-h-[400px] flex flex-col">
        {/* Chat History / Output area */}
        <div className="flex-1 space-y-4 mb-6 overflow-y-auto max-h-[500px]">
           {!response && !loading && (
             <div className="text-center mt-12 text-slate-500">
               <Bot size={48} className="mx-auto mb-4 opacity-30" />
               <p>Ask a question below to analyze your {activities.length} synced activities.</p>
             </div>
           )}

           {loading && (
             <div className="flex items-center justify-center h-40 space-x-3 text-indigo-400">
               <Loader2 className="animate-spin" />
               <span>Analyzing your data...</span>
             </div>
           )}

           {response && (
             <div className="bg-slate-900/50 p-6 rounded-lg border border-slate-700 text-slate-200 leading-relaxed whitespace-pre-wrap">
               {/* Simple markdown rendering simulation by preserving whitespace */}
               {response}
             </div>
           )}
        </div>

        {/* Input Area */}
        <div className="space-y-4">
          <div className="flex gap-2 overflow-x-auto pb-2">
            {suggestions.map(s => (
              <button 
                key={s} 
                onClick={() => setQuery(s)}
                className="px-3 py-1 bg-slate-700 hover:bg-slate-600 text-xs text-slate-300 rounded-full whitespace-nowrap transition-colors"
              >
                {s}
              </button>
            ))}
          </div>
          
          <div className="flex gap-2">
            <input 
              type="text" 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
              placeholder="Ask about your activities..."
              className="flex-1 bg-slate-900 border border-slate-700 text-white px-4 py-3 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
            />
            <button 
              onClick={handleAsk}
              disabled={loading || !query}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white px-6 py-3 rounded-lg font-medium transition-all flex items-center gap-2"
            >
              <Send size={18} />
              Ask
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};