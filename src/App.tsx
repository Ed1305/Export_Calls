import React, { useState, useMemo, useRef, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { supabase } from './lib/supabase';
import { 
  Phone, CheckCircle, Clock, Volume2, AlertCircle, 
  Upload, FileText, ChevronDown, ChevronUp, ChevronRight, Trash2, Database,
  TrendingDown, TrendingUp, Activity, Download, Calendar, PlayCircle, RefreshCw, Cloud
} from 'lucide-react';

interface ParsedList {
  listId: string;
  listName: string;
  calls: number;
  sales: number;
  topDisposition: string;
  dispositions: Record<string, number>;
}

interface ReportMetrics {
  campaignName: string;
  lists: ParsedList[];
  totalSales: number;
  totalCalls: number;
  activeLists: number;
  dispositionsMap: Record<string, number>;
  listsWithZeroCalls: number;
}

interface Report {
  id: string;
  filename: string;
  timestamp: number;
  rawText: string;
  metrics: ReportMetrics;
  startDate: string;
  endDate: string;
}

type SortKey = 'listId' | 'calls' | 'sales' | 'conv';

const parseReportData = (reportText: string): ReportMetrics => {
  const parsedLists: ParsedList[] = [];
  let sales = 0;
  let calls = 0;
  let emptyLists = 0;
  const dispMap: Record<string, number> = {};
  
  // Attempt to extract string like "Campaign: BIZABSA"
  let campaignName = "Unknown Campaign";
  const linesChunk = reportText.split('\n').map(l => l.trim()).filter(Boolean).slice(0, 30);
  for(const line of linesChunk) {
    if (line.toLowerCase().includes('campaign:') || line.toLowerCase().includes('campaign name')) {
        const match = line.match(/campaign\s*(?:name)?\s*[:\-]\s*(.*)$/i);
        if (match && match[1]) {
            campaignName = match[1].trim();
            break;
        }
    }
  }

  const blocks = reportText.split('"List ID #');
  
  for (let i = 1; i < blocks.length; i++) {
    const block = blocks[i];
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    if (!lines.length) continue;

    const headerLine = lines[0];
    const listMatch = headerLine.match(/^(\d+):\s+(.*)"$/);
    const listId = listMatch ? listMatch[1] : `Unknown-${i}`;
    const listName = listMatch ? listMatch[2] : headerLine.replace(/^"|"$/g, '');

    let listCalls = 0;
    let listSales = 0;
    let maxDispCount = 0;
    let topDisp = 'N/A';
    const listDispMap: Record<string, number> = {};

    if (block.includes('***NO CALLS FOUND')) {
      emptyLists++;
      parsedLists.push({ listId, listName, calls: 0, sales: 0, topDisposition: 'N/A', dispositions: {} });
      continue;
    }

    let parsingCsv = false;
    for (const line of lines) {
      if (line.includes('"DISPOSITION","CALLS"')) {
        parsingCsv = true;
        continue;
      }
      if (parsingCsv) {
        if (line.startsWith('"TOTALS:"')) {
          parsingCsv = false;
          continue;
        }
        const parts = line.split('","');
        if (parts.length >= 2) {
          const dispRaw = parts[0].replace(/^"/, '');
          const disp = dispRaw.split(' - ')[0]; 
          const count = parseInt(parts[1], 10) || 0;
          
          calls += count;
          listCalls += count;
          dispMap[disp] = (dispMap[disp] || 0) + count;
          listDispMap[disp] = (listDispMap[disp] || 0) + count;
          
          if (count > maxDispCount && disp !== 'NA' && disp !== 'AA') {
            maxDispCount = count;
            topDisp = disp;
          }

          if (dispRaw.toLowerCase().includes('sale')) {
            sales += count;
            listSales += count;
          }
        }
      }
    }
    
    parsedLists.push({ listId, listName, calls: listCalls, sales: listSales, topDisposition: topDisp, dispositions: listDispMap });
  }

  parsedLists.sort((a, b) => b.calls - a.calls);
  const activeCount = parsedLists.filter(l => l.calls > 0).length;

  return { 
    campaignName: campaignName === "Unknown Campaign" ? "Parsed Campaign" : campaignName,
    lists: parsedLists, 
    totalSales: sales, 
    totalCalls: calls, 
    activeLists: activeCount, 
    dispositionsMap: dispMap,
    listsWithZeroCalls: emptyLists
  };
};

export default function App() {
  const [reports, setReports] = useState<Report[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string | null>(null);
  
  // Sorting State
  const [sortKey, setSortKey] = useState<SortKey>('calls');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [expandedLists, setExpandedLists] = useState<Set<string>>(new Set());
  
  // Supabase Integration State
  const [isLoadingSupabase, setIsLoadingSupabase] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [supabaseFiles, setSupabaseFiles] = useState<{bucket: string, name: string, id: string}[]>([]);
  const [syncError, setSyncError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setExpandedLists(new Set());
  }, [selectedReportId]);

  const toggleList = (listId: string) => {
    setExpandedLists(prev => {
      const next = new Set(prev);
      if (next.has(listId)) next.delete(listId);
      else next.add(listId);
      return next;
    });
  };

  const fetchSupabaseFiles = async () => {
    setIsLoadingSupabase(true);
    setSyncError(null);
    try {
      // By default, Supabase anon keys do not have permission to run listBuckets().
      // Using the exact bucket name from your screenshot instead:
      const targetBuckets = ['Export_Calls'];
      let allFiles: {bucket: string, name: string, id: string}[] = [];
      
      for (const bucketName of targetBuckets) {
        const { data: files, error: filesError } = await supabase.storage.from(bucketName).list();
        
        if (filesError) {
          throw new Error(filesError.message || "Permission required to list files.");
        }
        
        if (files) {
          for (const f of files) {
             // Accept any file that isn't a hidden system placeholder like .emptyFolder
             if (f.name && !f.name.startsWith('.')) {
                allFiles.push({ bucket: bucketName, name: f.name, id: f.id });
             }
          }
        }
      }
      setSupabaseFiles(allFiles);
    } catch (error: any) {
      console.error("Error fetching from Supabase:", error);
      setSyncError(error.message || "Failed to connect to bucket.");
    } finally {
      setIsLoadingSupabase(false);
    }
  };

  useEffect(() => {
    fetchSupabaseFiles();
  }, []);

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = event.target.files;
    if (!files || files.length === 0) return;
    
    const file = files[0];
    setIsUploading(true);
    setSyncError(null);
    
    try {
      const { error } = await supabase.storage.from('Export_Calls').upload(file.name, file, {
        upsert: true // Overwrite if file with same name exists
      });
      
      if (error) {
        throw new Error(error.message || "Permission denied to upload.");
      }
      
      // Successfully uploaded to cloud, now refetch the list
      await fetchSupabaseFiles();
    } catch (error: any) {
      console.error("Upload error:", error);
      setSyncError(error.message || "Failed to upload file. Check RLS policies.");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const loadReportFromSupabase = async (bucket: string, name: string) => {
    // Check if we already loaded it
    const existing = reports.find(r => r.filename === name && r.rawText);
    if (existing) {
      setSelectedReportId(existing.id);
      return;
    }

    setIsLoadingSupabase(true);
    try {
      const { data, error } = await supabase.storage.from(bucket).download(name);
      if (error) throw error;
      
      const text = await data.text();
      const metrics = parseReportData(text);
      
      const newReport: Report = {
        id: Date.now().toString(),
        filename: name,
        timestamp: Date.now(),
        rawText: text,
        metrics,
        startDate: '',
        endDate: ''
      };
      
      setReports(prev => [newReport, ...prev]);
      setSelectedReportId(newReport.id);
    } catch (error) {
      console.error("Error loading file from Supabase:", error);
    } finally {
      setIsLoadingSupabase(false);
    }
  };

  const deleteReport = (id: string) => {
    setReports(prev => prev.filter(r => r.id !== id));
    if (selectedReportId === id) setSelectedReportId(null);
  };

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortOrder('desc');
    }
  };

  const currentReport = useMemo(() => reports.find(r => r.id === selectedReportId), [reports, selectedReportId]);

  const sortedLists = useMemo(() => {
    if (!currentReport) return [];
    return [...currentReport.metrics.lists].sort((a, b) => {
      let valA: number, valB: number;
      switch(sortKey) {
        case 'calls': valA = a.calls; valB = b.calls; break;
        case 'sales': valA = a.sales; valB = b.sales; break;
        case 'conv': valA = a.calls ? (a.sales / a.calls) : 0; valB = b.calls ? (b.sales / b.calls) : 0; break;
        case 'listId': valA = parseInt(a.listId) || 0; valB = parseInt(b.listId) || 0; break;
        default: valA = a.calls; valB = b.calls;
      }
      if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
      if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
      return 0;
    });
  }, [currentReport, sortKey, sortOrder]);

  const recommendations = useMemo(() => {
    if (!currentReport) return { keepActive: [], deactivate: [], activate: [] };
    const lists = currentReport.metrics.lists;
    const keepActive = lists.filter(l => l.sales > 0 && l.calls > 0).sort((a, b) => (b.sales / b.calls) - (a.sales / a.calls));
    const deactivate = lists.filter(l => l.calls >= 50 && l.sales === 0).sort((a, b) => b.calls - a.calls);
    const activate = lists.filter(l => l.calls === 0);
    return { keepActive, deactivate, activate };
  }, [currentReport]);

  const updateDateRange = (start: string, end: string) => {
    if (!currentReport) return;
    setReports(prev => prev.map(r => r.id === currentReport.id ? { ...r, startDate: start, endDate: end } : r));
  };

  const currentStartDate = currentReport?.startDate || '';
  const currentEndDate = currentReport?.endDate || '';

  const exportData = () => {
    if (!currentReport) return;
    const wb = XLSX.utils.book_new();

    const summaryData = [
      ["Campaign Analytics Report"],
      ["Campaign", currentReport.metrics.campaignName],
      ["File Name", currentReport.filename],
      ["Date Range", `${currentStartDate || 'N/A'} to ${currentEndDate || 'N/A'}`],
      [""],
      ["Total Calls", currentReport.metrics.totalCalls],
      ["Total Sales", currentReport.metrics.totalSales],
      ["Overall Conv. Rate", currentReport.metrics.totalCalls ? ((currentReport.metrics.totalSales / currentReport.metrics.totalCalls) * 100).toFixed(2) + '%' : "0%"],
      ["Lists w/ Calls", currentReport.metrics.activeLists],
      ["Inactive Lists", currentReport.metrics.listsWithZeroCalls],
    ];

    // Suggestions Sheet 
    const suggestionsData = [
        ["Recommendations & Analysis", "", "", "", ""],
        ["", "", "", "", ""],
        ["--- KEEP ACTIVE (" + recommendations.keepActive.length + " Lists) ---", "", "", "", ""],
        ["List ID", "List Name", "Calls", "Sales", "Conv. Rate"],
    ];
    recommendations.keepActive.forEach(l => suggestionsData.push([l.listId, l.listName, String(l.calls), String(l.sales), ((l.sales/l.calls)*100).toFixed(2)+'%']));
    
    suggestionsData.push(["", "", "", "", ""]);
    suggestionsData.push(["--- DEACTIVATE (" + recommendations.deactivate.length + " Lists) ---", "", "", "", ""]);
    suggestionsData.push(["List ID", "List Name", "Calls", "Sales", "Reason"]);
    recommendations.deactivate.forEach(l => suggestionsData.push([l.listId, l.listName, String(l.calls), String(l.sales), "High Calls, 0 Sales"]));

    suggestionsData.push(["", "", "", "", ""]);
    suggestionsData.push(["--- ACTIVATE (" + recommendations.activate.length + " Lists) ---", "", "", "", ""]);
    suggestionsData.push(["List ID", "List Name", "Calls", "Sales", "Status"]);
    recommendations.activate.forEach(l => suggestionsData.push([l.listId, l.listName, String(l.calls), String(l.sales), "Zero Calls"]));

    // All Lists Data Sheet
    const detailsHeader = ["List ID", "List Name", "Total Calls", "Sales", "Conv. Rate"];
    const detailsData = currentReport.metrics.lists.map(l => [
        l.listId, l.listName, String(l.calls), String(l.sales), l.calls ? ((l.sales/l.calls)*100).toFixed(2)+'%' : '0%'
    ]);

    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryData), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(suggestionsData), "Recommendations");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([detailsHeader, ...detailsData]), "All List Breakdown");
    
    XLSX.writeFile(wb, `${currentReport.metrics.campaignName.replace(/[^z0-9]/gi, '_')}_Analytics.xlsx`);
  };

  const formatDate = (ts: number) => {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(ts));
  };

  const SortIcon = ({ columnKey }: { columnKey: SortKey }) => {
    if (sortKey !== columnKey) return null;
    return sortOrder === 'asc' ? <ChevronUp className="w-3 h-3 inline ml-1" /> : <ChevronDown className="w-3 h-3 inline ml-1" />;
  };

  return (
    <div className="flex h-screen w-full overflow-hidden bg-slate-50 font-sans text-slate-800 text-[11px]">
      
      {/* Sidebar Navigation */}
      <aside className="w-60 border-r border-slate-200 bg-white flex flex-col shrink-0 z-20">
        <div className="p-4 flex items-center gap-2 border-b border-slate-100">
          <div className="w-6 h-6 bg-indigo-600 rounded flex items-center justify-center shrink-0">
            <Database className="h-3 w-3 text-white" />
          </div>
          <span className="font-bold text-xs tracking-tight text-slate-900 truncate">Analytix Pro</span>
        </div>
        
        <div className="p-3 border-b border-slate-100 flex flex-col gap-2">
          <input type="file" accept=".txt,.csv,.log" ref={fileInputRef} onChange={handleFileUpload} className="hidden" />
          <button 
            onClick={() => fileInputRef.current?.click()}
            disabled={isUploading || isLoadingSupabase}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded text-[11px] font-medium hover:bg-indigo-700 transition disabled:opacity-50"
          >
            {isUploading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Upload className="w-3 h-3" />} 
            {isUploading ? 'Uploading...' : 'Upload New Report'}
          </button>
          
          <button 
            onClick={fetchSupabaseFiles}
            disabled={isLoadingSupabase || isUploading}
            className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded text-[11px] font-medium hover:bg-slate-50 transition disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isLoadingSupabase && !isUploading ? 'animate-spin' : ''}`} /> 
            {isLoadingSupabase && !isUploading ? 'Syncing...' : 'Sync Cloud Files'}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-3 space-y-1">
          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest mb-2 px-2 flex justify-between">
            Supabase Cloud Files
            <Cloud className="w-3 h-3" />
          </div>
          
          {syncError && (
            <div className="mx-2 mb-3 bg-red-50 border border-red-200 text-red-700 p-2 rounded text-[10px]">
              <div className="flex items-center gap-1 font-bold mb-1"><AlertCircle className="w-3 h-3"/> Sync Error</div>
              {syncError}. You may need to add a "SELECT" RLS policy on the storage.objects table.
            </div>
          )}

          {supabaseFiles.length === 0 && !syncError && !isLoadingSupabase ? (
            <div className="text-[10px] text-slate-400 italic px-2 py-4 text-center">
              No files found in Export_Calls bucket.
            </div>
          ) : (
            supabaseFiles.map(f => {
              const reportHasLoadedLocally = reports.find(r => r.filename === f.name);
              const isActive = selectedReportId && reportHasLoadedLocally && selectedReportId === reportHasLoadedLocally.id;
              
              return (
                <div 
                  key={f.id || f.name}
                  onClick={() => loadReportFromSupabase(f.bucket, f.name)}
                  className={`w-full text-left flex items-start gap-2 px-2 py-2 rounded transition-colors relative group cursor-pointer border ${
                    isActive ? 'bg-indigo-50 text-indigo-800 font-medium border-indigo-200' : 'text-slate-600 hover:bg-slate-50 border-transparent'
                  }`}
                >
                  <FileText className={`w-3.5 h-3.5 mt-0.5 shrink-0 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                  <div className="flex flex-col min-w-0 pr-4">
                    <span className="truncate w-full block font-semibold text-[10px]" title={f.name}>{f.name}</span>
                    <span className="truncate w-full block text-[9px] text-slate-500 mt-0.5 border border-slate-200 bg-white px-1 py-0.5 rounded-sm inline-flex w-max">Bucket: {f.bucket}</span>
                  </div>
                  {reportHasLoadedLocally && (
                    <button 
                      onClick={(e) => { e.stopPropagation(); deleteReport(reportHasLoadedLocally.id); }}
                      className="absolute right-1 top-[10px] opacity-0 group-hover:opacity-100 p-1 text-slate-400 hover:text-rose-500 transition-all bg-white/80 rounded"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              );
            })
          )}
        </nav>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <header className="h-12 bg-white border-b border-slate-200 px-6 flex items-center justify-between shrink-0 sticky top-0 z-10 w-full">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-bold text-slate-900">Analysis Results</h1>
            {currentReport && (
              <span className="px-2 py-0.5 bg-slate-100 text-slate-500 rounded text-[10px] truncate max-w-[200px] border border-slate-200 font-semibold">
                {currentReport.metrics.campaignName}
              </span>
            )}
          </div>
          {currentReport && (
            <div className="flex items-center gap-2">
              {/* Date Range Selection */}
              <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 rounded px-2 py-1">
                <Calendar className="w-3 h-3 text-slate-400" />
                <input 
                  type="date" 
                  value={currentStartDate} 
                  onChange={(e) => updateDateRange(e.target.value, currentEndDate)}
                  className="bg-transparent border-none outline-none text-[10px] text-slate-600 w-[100px]"
                />
                <span className="text-slate-400">-</span>
                <input 
                  type="date" 
                  value={currentEndDate} 
                  onChange={(e) => updateDateRange(currentStartDate, e.target.value)}
                  className="bg-transparent border-none outline-none text-[10px] text-slate-600 w-[100px]"
                />
              </div>

              <button 
                onClick={exportData}
                className="flex items-center gap-1.5 px-3 py-1 text-emerald-700 bg-emerald-50 border border-emerald-200 hover:bg-emerald-100 rounded transition font-semibold text-[10px]"
              >
                <Download className="w-3 h-3" /> Export Excel
              </button>
            </div>
          )}
        </header>

        <div className="p-6 space-y-4 max-w-6xl mx-auto w-full">
          {!currentReport ? (
            <div className="text-center py-20 bg-white rounded-lg border border-slate-200 flex flex-col items-center justify-center mt-10">
              <Cloud className="h-8 w-8 text-slate-300 mb-3" />
              <h3 className="text-sm font-bold text-slate-800">Awaiting Supabase Data</h3>
              <p className="text-[11px] text-slate-500 mt-1 max-w-sm">Select a file from the sidebar or upload a new report to the cloud.</p>
              <div className="mt-4 flex gap-2">
                <button 
                  onClick={() => fileInputRef.current?.click()}
                  className="px-4 py-1.5 bg-indigo-600 text-white rounded text-[11px] font-medium hover:bg-indigo-700 transition"
                >
                  Upload New File
                </button>
                <button 
                  onClick={fetchSupabaseFiles}
                  className="px-4 py-1.5 bg-white border border-slate-200 text-slate-700 rounded text-[11px] font-medium hover:bg-slate-50 transition"
                >
                  Refresh Cloud
                </button>
              </div>
            </div>
          ) : currentReport.metrics.lists.length === 0 ? (
            <div className="text-center py-20 bg-white rounded-lg border border-slate-200">
              <Volume2 className="h-8 w-8 text-slate-300 mx-auto mb-2" />
              <h3 className="text-sm font-bold text-slate-800">No data found</h3>
            </div>
          ) : (
            <>
              {/* KPIs */}
              <div className="grid grid-cols-4 gap-3 shrink-0">
                <div className="bg-white p-3 rounded-lg border border-slate-200 flex flex-col">
                  <div className="text-[9px] font-bold text-slate-400 uppercase mb-1">Total Calls</div>
                  <div className="flex justify-between items-center">
                    <div className="text-xl font-bold text-slate-800">{currentReport.metrics.totalCalls.toLocaleString()}</div>
                    <Phone className="h-4 w-4 text-indigo-400" />
                  </div>
                </div>
                <div className="bg-white p-3 rounded-lg border border-slate-200 flex flex-col">
                  <div className="text-[9px] font-bold text-slate-400 uppercase mb-1">Sales Generated</div>
                  <div className="flex justify-between items-center">
                    <div className="text-xl font-bold text-emerald-600">{currentReport.metrics.totalSales.toLocaleString()}</div>
                    <CheckCircle className="h-4 w-4 text-emerald-400" />
                  </div>
                </div>
                <div className="bg-white p-3 rounded-lg border border-slate-200 flex flex-col">
                  <div className="text-[9px] font-bold text-slate-400 uppercase mb-1">Overall Conv.</div>
                  <div className="flex justify-between items-center">
                    <div className="text-xl font-bold text-indigo-700">
                      {((currentReport.metrics.totalSales / Math.max(1, currentReport.metrics.totalCalls)) * 100).toFixed(2)}%
                    </div>
                    <Clock className="h-4 w-4 text-indigo-400" />
                  </div>
                </div>
                <div className="bg-white p-3 rounded-lg border border-slate-200 flex flex-col">
                  <div className="text-[9px] font-bold text-slate-400 uppercase mb-1">Active / Inactive</div>
                  <div className="flex justify-between items-center">
                    <div className="text-xl font-bold text-slate-800">
                      {currentReport.metrics.activeLists} <span className="text-[11px] text-slate-400 font-normal">/ {currentReport.metrics.listsWithZeroCalls}</span>
                    </div>
                    <AlertCircle className="h-4 w-4 text-amber-400" />
                  </div>
                </div>
              </div>

              {/* Suggestions Grid */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="bg-white border border-slate-200 rounded-lg flex flex-col overflow-hidden">
                  <div className="px-3 py-2 bg-emerald-50 text-[10px] font-bold text-emerald-800 uppercase flex items-center border-b border-emerald-100">
                    <TrendingUp className="w-3 h-3 mr-1.5" /> Keep Active (Top Conv)
                  </div>
                  <div className="p-2 flex-1 overflow-y-auto max-h-[160px]">
                    {recommendations.keepActive.length === 0 ? <p className="text-[10px] text-slate-400 italic p-1">None</p> : (
                      <ul className="space-y-1.5">
                        {recommendations.keepActive.slice(0, 8).map(l => (
                          <li key={'ka'+l.listId} className="flex justify-between items-center border-b border-slate-50 pb-1">
                            <div>
                               <span className="font-mono font-bold text-slate-700 block">#{l.listId}</span>
                               <span className="text-[9px] text-slate-500 truncate max-w-[120px] block">{l.listName}</span>
                            </div>
                            <span className="text-emerald-700 font-bold bg-emerald-100 rounded px-1.5 py-0.5 text-[9px]">{((l.sales/l.calls)*100).toFixed(1)}%</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-lg flex flex-col overflow-hidden">
                  <div className="px-3 py-2 bg-rose-50 text-[10px] font-bold text-rose-800 uppercase flex items-center border-b border-rose-100">
                    <TrendingDown className="w-3 h-3 mr-1.5" /> Deactivate (No Sales)
                  </div>
                  <div className="p-2 flex-1 overflow-y-auto max-h-[160px]">
                    {recommendations.deactivate.length === 0 ? <p className="text-[10px] text-slate-400 italic p-1">None</p> : (
                      <ul className="space-y-1.5">
                        {recommendations.deactivate.slice(0, 8).map(l => (
                           <li key={'de'+l.listId} className="flex justify-between items-center border-b border-slate-50 pb-1">
                            <div>
                               <span className="font-mono font-bold text-slate-700 block">#{l.listId}</span>
                               <span className="text-[9px] text-slate-500 truncate max-w-[120px] block">{l.listName}</span>
                            </div>
                            <span className="text-rose-700 font-bold bg-rose-100 rounded px-1.5 py-0.5 text-[9px]">{l.calls} C</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>

                <div className="bg-white border border-slate-200 rounded-lg flex flex-col overflow-hidden">
                  <div className="px-3 py-2 bg-cyan-50 text-[10px] font-bold text-cyan-800 uppercase flex items-center border-b border-cyan-100">
                    <PlayCircle className="w-3 h-3 mr-1.5" /> Activate (0 Calls)
                  </div>
                  <div className="p-2 flex-1 overflow-y-auto max-h-[160px]">
                    {recommendations.activate.length === 0 ? <p className="text-[10px] text-slate-400 italic p-1">None</p> : (
                      <ul className="space-y-1.5">
                        {recommendations.activate.slice(0, 8).map(l => (
                           <li key={'ac'+l.listId} className="flex justify-between items-center border-b border-slate-50 pb-1">
                            <div>
                               <span className="font-mono font-bold text-slate-700 block">#{l.listId}</span>
                               <span className="text-[9px] text-slate-500 truncate max-w-[120px] block">{l.listName}</span>
                            </div>
                            <span className="text-cyan-700 font-bold bg-cyan-100 rounded px-1.5 py-0.5 text-[9px]">Unused</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </div>

              {/* Data Table */}
              <div className="bg-white border border-slate-200 rounded-lg overflow-hidden flex flex-col">
                <div className="px-4 py-2 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                  <span className="text-[10px] font-bold text-slate-700 uppercase tracking-wide">All Lists Breakdown ({currentReport.metrics.lists.length})</span>
                  <span className="text-[9px] text-slate-400">Click row for dispositions</span>
                </div>
                <div className="overflow-x-auto max-h-[400px]">
                  <table className="w-full text-left border-collapse">
                    <thead className="sticky top-0 bg-slate-50 z-10">
                      <tr className="border-b border-slate-200 text-[10px] text-slate-500 uppercase">
                        <th className="px-3 py-2 w-8"></th>
                        <th className="px-3 py-2 cursor-pointer hover:bg-slate-100" onClick={() => handleSort('listId')}>ID <SortIcon columnKey="listId" /></th>
                        <th className="px-3 py-2">Name</th>
                        <th className="px-3 py-2 text-right cursor-pointer hover:bg-slate-100" onClick={() => handleSort('calls')}>Calls <SortIcon columnKey="calls" /></th>
                        <th className="px-3 py-2 text-right cursor-pointer hover:bg-slate-100" onClick={() => handleSort('sales')}>Sales <SortIcon columnKey="sales" /></th>
                        <th className="px-3 py-2 text-right cursor-pointer hover:bg-slate-100" onClick={() => handleSort('conv')}>Conv <SortIcon columnKey="conv" /></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 bg-white">
                      {sortedLists.map(list => {
                        const isExpanded = expandedLists.has(list.listId);
                        return (
                          <React.Fragment key={list.listId}>
                            <tr className={`cursor-pointer hover:bg-slate-50 ${isExpanded ? 'bg-indigo-50/20' : ''}`} onClick={() => toggleList(list.listId)}>
                              <td className="px-3 py-1.5 text-center">
                                {isExpanded ? <ChevronDown className="w-3 h-3 text-slate-400" /> : <ChevronRight className="w-3 h-3 text-slate-400" />}
                              </td>
                              <td className="px-3 py-1.5 font-mono font-bold text-slate-700">#{list.listId}</td>
                              <td className="px-3 py-1.5 text-slate-600 truncate max-w-[200px]" title={list.listName}>{list.listName}</td>
                              <td className="px-3 py-1.5 text-right font-mono font-medium text-slate-700">{list.calls}</td>
                              <td className="px-3 py-1.5 text-right text-emerald-700 font-bold">{list.sales}</td>
                              <td className="px-3 py-1.5 text-right font-semibold text-slate-600">{list.calls ? ((list.sales/list.calls)*100).toFixed(1)+'%' : '-'}</td>
                            </tr>
                            {isExpanded && (
                              <tr className="bg-slate-50/80 border-b border-slate-200">
                                <td colSpan={6} className="px-8 py-3">
                                  <div className="text-[9px] font-bold text-indigo-500 uppercase mb-2">Dispositions</div>
                                  <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                                    {Object.entries(list.dispositions).sort((a,b)=>b[1]-a[1]).map(([d, c]) => (
                                      <div key={d} className="bg-white border border-slate-200 p-1.5 rounded flex justify-between items-center shadow-sm">
                                        <span className="text-[9px] font-bold text-slate-500 truncate pr-2" title={d}>{d}</span>
                                        <span className="text-[10px] font-mono font-bold text-indigo-800">{c}</span>
                                      </div>
                                    ))}
                                    {Object.keys(list.dispositions).length === 0 && <span className="text-[9px] text-slate-400 italic col-span-full">None logged.</span>}
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
