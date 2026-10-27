
import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Campaign, Recipient, Attachment, Step, SentCampaign, SentEmail } from './types';
import { generateEmailTemplate } from './services/geminiService';
import CampaignSteps from './components/CampaignSteps';
import { parseCsv } from './utils/csv';
import { GoogleGenAI, LiveServerMessage, Modality, Type, Blob } from '@google/genai';

// Audio Helpers as per guidelines
function decode(base64: string) {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function encode(bytes: Uint8Array) {
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function decodeAudioData(
  data: Uint8Array,
  ctx: AudioContext,
  sampleRate: number,
  numChannels: number,
): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);

  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

const App: React.FC = () => {
  const [view, setView] = useState<'builder' | 'history'>('builder');
  const [currentStep, setCurrentStep] = useState<Step>('info');
  const [campaign, setCampaign] = useState<Campaign>({
    id: crypto.randomUUID(),
    name: '',
    subject: '',
    body: '',
    recipients: [],
    attachments: [],
    status: 'draft',
    createdAt: Date.now(),
    headers: [],
  });

  const [sentCampaigns, setSentCampaigns] = useState<SentCampaign[]>([]);
  const [aiLoading, setAiLoading] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [isSendingSingle, setIsSendingSingle] = useState(false);
  const [sendProgress, setSendProgress] = useState(0);
  const [transmissionLog, setTransmissionLog] = useState<string[]>([]);
  // null = mail server not reachable
  const [mailServer, setMailServer] = useState<{ sendEnabled: boolean; from: string | null } | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  // Live API State
  const [isLiveActive, setIsLiveActive] = useState(false);
  const sessionRef = useRef<any>(null);
  const audioContextsRef = useRef<{ input: AudioContext; output: AudioContext } | null>(null);
  const nextStartTimeRef = useRef(0);
  const audioSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  // File Input Refs
  const csvInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [transmissionLog]);

  useEffect(() => {
    fetch('/api/status').then(r => r.ok ? r.json() : null).then(setMailServer).catch(() => setMailServer(null));
  }, []);

  const deliver = async (email: Omit<SentEmail, 'status' | 'error'>): Promise<SentEmail> => {
    try {
      const res = await fetch('/api/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: email.recipientEmail, subject: email.personalizedSubject, text: email.personalizedBody, attachments: email.attachments }),
      });
      const data = await res.json().catch(() => ({ status: 'failed', error: `HTTP ${res.status}` }));
      return { ...email, status: data.status === 'sent' || data.status === 'dry-run' ? data.status : 'failed', error: data.error, sentAt: Date.now() };
    } catch (err: any) {
      return { ...email, status: 'failed', error: err?.message || 'Mail server unreachable', sentAt: Date.now() };
    }
  };

  const logResult = (e: SentEmail) =>
    e.status === 'sent' ? `[SENT] ${e.recipientEmail}`
    : e.status === 'dry-run' ? `[DRY RUN] ${e.recipientEmail} (not sent)`
    : `[FAILED] ${e.recipientEmail}: ${e.error}`;

  const confirmRealSend = (count: number) =>
    !mailServer?.sendEnabled || window.confirm(`This will send REAL email to ${count} recipient(s) from ${mailServer.from}. Continue?`);

  // Database Storage Helpers
  const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = (error) => reject(error);
    });
  };

  const personalize = (text: string, recipient: Recipient) => {
    if (!text) return '';
    let personalized = text;
    Object.keys(recipient).forEach(key => {
      const placeholder = new RegExp(`\\{\\{${key}\\}\\}`, 'gi');
      personalized = personalized.replace(placeholder, String(recipient[key] || ''));
    });
    return personalized;
  };

  const resetCampaign = () => {
    stopLiveSession();
    setCampaign({
      id: crypto.randomUUID(),
      name: '',
      subject: '',
      body: '',
      recipients: [],
      attachments: [],
      status: 'draft',
      createdAt: Date.now(),
      headers: [],
    });
    setCurrentStep('info');
    setSendProgress(0);
    setIsSending(false);
    setIsSendingSingle(false);
    setTransmissionLog([]);
    setView('builder');
    if (csvInputRef.current) csvInputRef.current.value = '';
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const loadSampleRecipients = () => {
    const samples: Recipient[] = [
      { id: crypto.randomUUID(), name: 'John Doe', email: 'john@example.com', first_name: 'John', last_name: 'Doe', company: 'TechCorp', city: 'San Francisco' },
      { id: crypto.randomUUID(), name: 'Jane Smith', email: 'jane@smith.io', first_name: 'Jane', last_name: 'Smith', company: 'DesignCo', city: 'New York' },
      { id: crypto.randomUUID(), name: 'Alice Johnson', email: 'alice.j@web.net', first_name: 'Alice', last_name: 'Johnson', company: 'CloudSystems', city: 'Austin' }
    ];
    setCampaign(prev => ({ 
      ...prev, 
      recipients: samples,
      headers: ['name', 'email', 'first_name', 'last_name', 'company', 'city']
    }));
  };

  // Helper for file size formatting
  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + ' B';
    const kb = bytes / 1024;
    if (kb < 1024) return kb.toFixed(1) + ' KB';
    const mb = kb / 1024;
    return mb.toFixed(1) + ' MB';
  };

  // Helper for file type icons
  const getFileTypeIcon = (filename: string) => {
    const ext = filename.split('.').pop()?.toLowerCase();
    switch (ext) {
      case 'pdf': return 'fa-file-pdf text-red-500';
      case 'doc':
      case 'docx': return 'fa-file-word text-blue-500';
      case 'xls':
      case 'xlsx':
      case 'csv': return 'fa-file-excel text-green-600';
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif':
      case 'svg': return 'fa-file-image text-purple-500';
      case 'zip':
      case 'rar':
      case '7z': return 'fa-file-archive text-amber-500';
      default: return 'fa-file-alt text-slate-400';
    }
  };

  // Live API Implementation
  const startLiveSession = async () => {
    if (isLiveActive) return;

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
      audioContextsRef.current = { input: inputCtx, output: outputCtx };

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } } },
          systemInstruction: 'You are a professional campaign assistant for MassMailer Pro. You help users generate and refine mass emails. You can update campaign data OR trigger the launch if the user asks you to "send the campaign" or "launch". Only launch if recipients are present.',
          tools: [{
            functionDeclarations: [
              {
                name: 'updateCampaignData',
                description: 'Update the current campaign details.',
                parameters: {
                  type: Type.OBJECT,
                  properties: {
                    name: { type: Type.STRING },
                    subject: { type: Type.STRING },
                    body: { type: Type.STRING }
                  }
                }
              },
              {
                name: 'launchCampaign',
                description: 'Triggers the actual mass sending process for the current campaign.',
                parameters: { type: Type.OBJECT, properties: {} }
              }
            ]
          }]
        },
        callbacks: {
          onopen: () => {
            setIsLiveActive(true);
            const source = inputCtx.createMediaStreamSource(stream);
            const processor = inputCtx.createScriptProcessor(4096, 1, 1);
            processor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              const int16 = new Int16Array(inputData.length);
              for (let i = 0; i < inputData.length; i++) int16[i] = inputData[i] * 32768;
              const pcmBlob: Blob = {
                data: encode(new Uint8Array(int16.buffer)),
                mimeType: 'audio/pcm;rate=16000',
              };
              sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
            };
            source.connect(processor);
            processor.connect(inputCtx.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.toolCall) {
              for (const fc of message.toolCall.functionCalls) {
                if (fc.name === 'updateCampaignData') {
                  const args = fc.args as any;
                  setCampaign(prev => ({
                    ...prev,
                    ...(args.name && { name: args.name }),
                    ...(args.subject && { subject: args.subject }),
                    ...(args.body && { body: args.body })
                  }));
                } else if (fc.name === 'launchCampaign') {
                  // Direct trigger from voice
                  if (currentStep !== 'review') setCurrentStep('review');
                  setTimeout(() => startSending(), 1000);
                }
                sessionPromise.then(s => s.sendToolResponse({
                  functionResponses: { id: fc.id, name: fc.name, response: { result: "ok" } }
                }));
              }
            }

            const audioData = message.serverContent?.modelTurn?.parts[0]?.inlineData?.data;
            if (audioData && audioContextsRef.current) {
              const { output } = audioContextsRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, output.currentTime);
              const buffer = await decodeAudioData(decode(audioData), output, 24000, 1);
              const source = output.createBufferSource();
              source.buffer = buffer;
              source.connect(output.destination);
              source.addEventListener('ended', () => audioSourcesRef.current.delete(source));
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += buffer.duration;
              audioSourcesRef.current.add(source);
            }
          },
          onclose: () => setIsLiveActive(false),
          onerror: () => setIsLiveActive(false)
        }
      });

      sessionRef.current = await sessionPromise;
    } catch (err) {
      console.error(err);
      setIsLiveActive(false);
    }
  };

  const stopLiveSession = () => {
    if (sessionRef.current) {
      sessionRef.current.close();
      sessionRef.current = null;
    }
    if (audioContextsRef.current) {
      audioContextsRef.current.input.close();
      audioContextsRef.current.output.close();
      audioContextsRef.current = null;
    }
    setIsLiveActive(false);
  };

  const handleCsvUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      const rows = parseCsv(text.replace(/^\uFEFF/, ''));
      if (rows.length < 2) return;
      const rawHeaders = rows[0].map(h => h.trim());
      const cleanHeaders = rawHeaders.map(h => h.toLowerCase().replace(/\s+/g, '_'));
      const emailIdx = cleanHeaders.findIndex(h => h.includes('email'));
      if (emailIdx === -1) { alert("Email column not found."); return; }
      const newRecipients: Recipient[] = rows.slice(1).map((row) => {
        const values = row.map(v => v.trim());
        const data: any = { id: crypto.randomUUID() };
        rawHeaders.forEach((rawH, i) => { data[cleanHeaders[i]] = values[i] || ''; data[rawH] = values[i] || ''; });
        data.email = values[emailIdx];
        const nameIdx = cleanHeaders.findIndex(h => h.includes('name'));
        data.name = nameIdx !== -1 ? values[nameIdx] : values[emailIdx];
        return data as Recipient;
      });
      // Drop invalid and duplicate addresses so nobody is emailed twice
      const seen = new Set<string>();
      const valid = newRecipients.filter(r => {
        const key = (r.email || '').toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key) || seen.has(key)) return false;
        seen.add(key);
        return true;
      });
      if (valid.length < newRecipients.length) alert(`Skipped ${newRecipients.length - valid.length} row(s) with an invalid or duplicate email.`);
      setCampaign(prev => ({ ...prev, recipients: valid, headers: Array.from(new Set([...rawHeaders, ...cleanHeaders])) }));
    };
    reader.readAsText(file);
  };

  const handleFileAttach = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []) as File[];
    const newAttachments: Attachment[] = files.map(file => ({
      id: crypto.randomUUID(), file, name: file.name, size: file.size
    }));
    setCampaign(prev => ({ ...prev, attachments: [...prev.attachments, ...newAttachments] }));
  };

  const handleSendSingle = async () => {
    if (campaign.recipients.length === 0) return;
    if (!confirmRealSend(1)) return;
    setIsSendingSingle(true);
    setTransmissionLog([`[SYSTEM] Test send (${mailServer?.sendEnabled ? 'LIVE' : 'dry run'})...`]);
    
    try {
      const recipient = campaign.recipients[0];
      const processedAttachments = await Promise.all(
        campaign.attachments.map(async (att) => ({ name: att.name, base64: await fileToBase64(att.file) }))
      );

      setTransmissionLog(prev => [...prev, `[PACKET] Encoding ${processedAttachments.length} attachments...`]);

      const generatedEmail = await deliver({
        id: crypto.randomUUID(),
        recipientEmail: recipient.email,
        personalizedSubject: personalize(campaign.subject, recipient),
        personalizedBody: personalize(campaign.body, recipient),
        attachments: processedAttachments,
        sentAt: Date.now()
      });
      setTransmissionLog(prev => [...prev, logResult(generatedEmail)]);

      setSentCampaigns(prev => [{ id: crypto.randomUUID(), name: `${campaign.name} (Single)`, emails: [generatedEmail], totalRecipients: 1, createdAt: Date.now() }, ...prev]);
      
      setTimeout(() => { setIsSendingSingle(false); setView('history'); }, 1000);
    } catch (err) { setIsSendingSingle(false); }
  };

  const startSending = async () => {
    if (campaign.recipients.length === 0 || isSending) return;
    if (!confirmRealSend(campaign.recipients.length)) return;
    setIsSending(true);
    setTransmissionLog([`[SYSTEM] Batch launch (${mailServer?.sendEnabled ? 'LIVE' : 'dry run'}): ${campaign.recipients.length} targets.`]);
    
    try {
      const processedAttachments = await Promise.all(
        campaign.attachments.map(async (att) => ({ name: att.name, base64: await fileToBase64(att.file) }))
      );

      const generatedEmails: SentEmail[] = [];
      
      for (let i = 0; i < campaign.recipients.length; i++) {
        const recipient = campaign.recipients[i];
        const progress = Math.round(((i + 1) / campaign.recipients.length) * 100);
        
        setTransmissionLog(prev => [...prev, `[QUEUED] Personalizing for ${recipient.email}...`]);

        const email = await deliver({
          id: crypto.randomUUID(),
          recipientEmail: recipient.email,
          personalizedSubject: personalize(campaign.subject, recipient),
          personalizedBody: personalize(campaign.body, recipient),
          attachments: processedAttachments,
          sentAt: Date.now()
        });

        generatedEmails.push(email);
        setSendProgress(progress);
        setTransmissionLog(prev => [...prev, logResult(email)]);
      }

      setSentCampaigns(prev => [{ id: campaign.id, name: campaign.name, emails: generatedEmails, totalRecipients: generatedEmails.length, createdAt: Date.now() }, ...prev]);
      setCampaign(prev => ({ ...prev, status: 'completed' }));
      const count = (s: SentEmail['status']) => generatedEmails.filter(e => e.status === s).length;
      setTransmissionLog(prev => [...prev, `[SYSTEM] Batch complete: ${count('sent')} sent, ${count('dry-run')} dry run, ${count('failed')} failed.`]);
      
      setTimeout(() => { setIsSending(false); setSendProgress(0); setView('history'); }, 1500);
    } catch (err) { setIsSending(false); }
  };

  return (
    <div className="min-h-screen p-4 md:p-8 flex flex-col items-center bg-slate-50">
      <header className="w-full max-w-5xl mb-8 flex flex-col md:flex-row justify-between items-center gap-4">
        <div className="text-center md:text-left">
          <h1 className="text-3xl font-extrabold text-slate-800 tracking-tight">
            MassMailer <span className="text-blue-600">Pro</span>
          </h1>
          <p className="text-slate-500 font-medium italic">Advanced Real-time Personalization</p>
        </div>
        <div className="flex items-center gap-3">
           <button onClick={() => setView(view === 'builder' ? 'history' : 'builder')} className={`px-4 py-2 rounded-lg font-semibold transition-all flex items-center gap-2 border ${view === 'history' ? 'bg-blue-50 border-blue-200 text-blue-600' : 'bg-white border-slate-200 text-slate-600 hover:border-blue-300'}`}>
             <i className={`fas ${view === 'history' ? 'fa-pen-nib' : 'fa-history'}`}></i> {view === 'history' ? 'Campaign Builder' : 'View History'}
           </button>
           <button onClick={resetCampaign} className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-semibold transition-all shadow-md flex items-center gap-2">
             <i className="fas fa-plus"></i> New Campaign
           </button>
        </div>
      </header>

      {/* Real-time Assistant Widget */}
      <div className={`fixed bottom-8 right-8 z-50 transition-all transform ${isLiveActive ? 'scale-110' : 'scale-100'}`}>
        <button onClick={isLiveActive ? stopLiveSession : startLiveSession} className={`w-16 h-16 rounded-full shadow-2xl flex items-center justify-center transition-all ${isLiveActive ? 'bg-red-500 animate-pulse' : 'bg-blue-600 hover:bg-blue-700'}`}>
          <i className={`fas ${isLiveActive ? 'fa-microphone-slash' : 'fa-microphone'} text-white text-2xl`}></i>
          {isLiveActive && <span className="absolute -top-2 -right-2 bg-white text-red-500 text-[10px] font-bold px-2 py-1 rounded-full border border-red-200 shadow-sm uppercase">Live</span>}
        </button>
      </div>

      <main className="w-full max-w-5xl">
        {view === 'builder' ? (
          <div className="bg-white rounded-2xl shadow-xl border border-slate-100 overflow-hidden">
            <div className="p-6 md:p-10">
              <CampaignSteps currentStep={currentStep} />
              
              {currentStep === 'info' && (
                <div className="space-y-6">
                  <h2 className="text-2xl font-bold text-slate-800">Campaign Details</h2>
                  <input type="text" placeholder="Campaign Name" className="w-full px-4 py-3 rounded-lg border focus:ring-2 focus:ring-blue-500 outline-none" value={campaign.name} onChange={(e) => setCampaign({ ...campaign, name: e.target.value })} />
                </div>
              )}

              {currentStep === 'recipients' && (
                <div className="space-y-6 text-slate-800">
                   <div className="flex justify-between items-center gap-2">
                    <h2 className="text-2xl font-bold">Recipients</h2>
                    <div className="flex gap-2">
                      <button onClick={loadSampleRecipients} className="px-4 py-2 bg-slate-100 text-slate-600 rounded-lg text-xs font-bold">Load Samples</button>
                      <button onClick={() => csvInputRef.current?.click()} className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-bold shadow-md">Upload CSV</button>
                    </div>
                    <input type="file" ref={csvInputRef} accept=".csv" className="hidden" onChange={handleCsvUpload} />
                  </div>
                  {campaign.recipients.length > 0 ? (
                    <div className="border rounded-xl overflow-hidden max-h-80 overflow-y-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 border-b"><tr><th className="p-4">Email</th><th className="p-4">Details</th></tr></thead>
                        <tbody className="divide-y">{campaign.recipients.map(r => <tr key={r.id} className="hover:bg-slate-50"><td className="p-4 font-medium">{r.email}</td><td className="p-4 text-xs text-slate-500 italic truncate max-w-xs">{Object.keys(r).filter(k => !['id','email','name'].includes(k)).map(k => `${k}: ${r[k]}`).join(' | ')}</td></tr>)}</tbody>
                      </table>
                    </div>
                  ) : <div className="p-16 text-center text-slate-400 border-2 border-dashed rounded-2xl">No recipients loaded</div>}
                </div>
              )}

              {currentStep === 'content' && (
                <div className="space-y-6">
                  <h2 className="text-2xl font-bold text-slate-800">Template Editor</h2>
                  <div className="p-4 bg-slate-50 border rounded-xl flex flex-wrap gap-2">
                    {campaign.headers.map(h => <button key={h} onClick={() => setCampaign(prev => ({ ...prev, body: prev.body + ` {{${h}}}` }))} className="px-2 py-1 bg-white border rounded text-[10px] font-bold text-blue-600 hover:bg-blue-50">Insert {`{{${h}}}`}</button>)}
                  </div>
                  <input type="text" placeholder="Subject" className="w-full px-4 py-3 rounded-lg border font-semibold" value={campaign.subject} onChange={(e) => setCampaign({ ...campaign, subject: e.target.value })} />
                  <textarea rows={8} placeholder="Body..." className="w-full px-4 py-3 rounded-lg border font-mono text-sm" value={campaign.body} onChange={(e) => setCampaign({ ...campaign, body: e.target.value })}></textarea>
                </div>
              )}

              {currentStep === 'attachments' && (
                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <h2 className="text-2xl font-bold text-slate-800">Attachments</h2>
                    <button onClick={() => fileInputRef.current?.click()} className="px-4 py-2 bg-slate-800 text-white rounded-lg text-sm font-bold shadow-md hover:bg-black transition-all">
                      <i className="fas fa-plus mr-2"></i> Add Files
                    </button>
                    <input type="file" ref={fileInputRef} multiple className="hidden" onChange={handleFileAttach} />
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {campaign.attachments.map(f => (
                      <div key={f.id} className="p-4 border rounded-xl flex justify-between items-center bg-white shadow-sm hover:border-blue-200 transition-colors group">
                        <div className="flex items-center gap-3 overflow-hidden">
                          <div className="w-10 h-10 flex-shrink-0 bg-slate-50 rounded-lg flex items-center justify-center border border-slate-100">
                            <i className={`fas ${getFileTypeIcon(f.name)} text-xl`}></i>
                          </div>
                          <div className="overflow-hidden">
                            <p className="text-sm font-semibold text-slate-700 truncate">{f.name}</p>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-tight">{formatFileSize(f.size)}</p>
                          </div>
                        </div>
                        <button 
                          onClick={() => setCampaign(p => ({ ...p, attachments: p.attachments.filter(a => a.id !== f.id) }))} 
                          className="w-8 h-8 rounded-full flex items-center justify-center text-slate-300 hover:text-red-500 hover:bg-red-50 transition-all opacity-0 group-hover:opacity-100"
                        >
                          <i className="fas fa-trash-alt"></i>
                        </button>
                      </div>
                    ))}
                    {campaign.attachments.length === 0 && (
                      <div className="col-span-full py-16 text-center border-2 border-dashed border-slate-100 rounded-2xl bg-slate-50/50">
                        <i className="fas fa-cloud-upload-alt text-4xl text-slate-200 mb-4"></i>
                        <p className="text-slate-400 text-sm">Drop documents here or click "Add Files"</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              {currentStep === 'review' && (
                <div className="space-y-6">
                  <div className="flex justify-between items-center">
                    <h2 className="text-2xl font-bold text-slate-800">Final Review</h2>
                    {campaign.recipients.length > 0 && !isSending && (
                      <button onClick={handleSendSingle} className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg text-xs font-bold transition-all flex items-center gap-2">
                        <i className={`fas ${isSendingSingle ? 'fa-spinner fa-spin' : 'fa-paper-plane'}`}></i> {isSendingSingle ? 'Processing...' : `Test Send to ${campaign.recipients[0].email}`}
                      </button>
                    )}
                  </div>

                  <div className={`p-3 rounded-xl text-xs font-bold border ${mailServer?.sendEnabled ? 'bg-red-50 text-red-700 border-red-200' : mailServer ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-slate-100 text-slate-600 border-slate-200'}`}>
                    {mailServer?.sendEnabled
                      ? `LIVE: emails will really be sent from ${mailServer.from}.`
                      : mailServer
                        ? 'Dry run: the mail server will not send anything (SEND_ENABLED is off).'
                        : 'Mail server not running. Start it with "npm run server"; until then every send will fail.'}
                  </div>

                  {(isSending || isSendingSingle) && (
                    <div className="space-y-4 animate-fadeIn">
                       <div className="p-4 bg-slate-900 rounded-xl font-mono text-[10px] text-green-400 h-40 overflow-y-auto shadow-2xl border-2 border-slate-700">
                          {transmissionLog.map((line, i) => <div key={i}>{line}</div>)}
                          <div ref={logEndRef}></div>
                       </div>
                       <div className="space-y-2">
                          <div className="flex justify-between text-xs font-bold text-blue-600 uppercase tracking-widest"><span>Real-time Stream</span><span>{sendProgress}%</span></div>
                          <div className="w-full bg-slate-200 h-2 rounded-full overflow-hidden"><div className="bg-blue-600 h-full transition-all duration-300 shadow-[0_0_10px_rgba(59,130,246,0.5)]" style={{width: `${sendProgress}%`}}></div></div>
                       </div>
                    </div>
                  )}

                  {!isSending && !isSendingSingle && (
                    <div className="p-6 bg-slate-50 rounded-2xl border border-slate-200">
                      <p className="text-sm font-bold text-slate-400 mb-2 uppercase">Preview for {campaign.recipients[0]?.name || 'User'}</p>
                      <p className="font-bold mb-2 text-lg text-slate-800">{personalize(campaign.subject, campaign.recipients[0] || {} as any)}</p>
                      <p className="text-slate-600 whitespace-pre-wrap leading-relaxed border-t border-slate-200 mt-4 pt-4">{personalize(campaign.body, campaign.recipients[0] || {} as any)}</p>
                    </div>
                  )}
                </div>
              )}
            </div>

            <div className="px-6 py-6 bg-slate-50 border-t flex justify-between items-center">
              <button onClick={() => { const s:Step[]=['info','recipients','content','attachments','review']; setCurrentStep(s[Math.max(0, s.indexOf(currentStep)-1)]) }} disabled={currentStep === 'info' || isSending} className="px-6 py-2 text-slate-600 font-semibold disabled:opacity-30">Back</button>
              <div className="flex items-center gap-4">
                {currentStep === 'review' ? (
                  <button onClick={startSending} disabled={isSending || !campaign.recipients.length} className="px-10 py-4 bg-blue-600 text-white rounded-2xl font-bold shadow-xl hover:bg-blue-700 transition-all transform hover:scale-105 disabled:bg-slate-300 disabled:scale-100">
                    {isSending ? 'Sending Bulk...' : `Launch for ${campaign.recipients.length} Targets`}
                  </button>
                ) : <button onClick={() => { const s:Step[]=['info','recipients','content','attachments','review']; setCurrentStep(s[Math.min(s.length-1, s.indexOf(currentStep)+1)]) }} className="px-10 py-4 bg-slate-800 text-white rounded-2xl font-bold hover:bg-black transition-all">Next Step</button>}
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6 animate-fadeIn">
            <h2 className="text-2xl font-bold text-slate-800">Transmission History</h2>
            {sentCampaigns.length === 0 ? <p className="text-slate-400 text-center py-20">No campaigns archived</p> : sentCampaigns.map(sc => (
              <div key={sc.id} className="bg-white rounded-2xl border shadow-sm overflow-hidden mb-6">
                <div className="bg-slate-800 p-4 text-white flex justify-between items-center">
                  <div><h3 className="font-bold">{sc.name}</h3><p className="text-xs opacity-60">{sc.emails.filter(e => e.status === 'sent').length} sent &bull; {sc.emails.filter(e => e.status === 'dry-run').length} dry run &bull; {sc.emails.filter(e => e.status === 'failed').length} failed</p></div>
                  {(() => { const failed = sc.emails.some(e => e.status === 'failed'); const dry = sc.emails.every(e => e.status === 'dry-run');
                    return <span className={`${failed ? 'bg-red-500' : dry ? 'bg-amber-500' : 'bg-green-500'} text-[10px] px-3 py-1 rounded-full font-bold uppercase tracking-widest`}>{failed ? 'Has Failures' : dry ? 'Dry Run' : 'Delivered'}</span>; })()}
                </div>
                <table className="w-full text-xs">
                  <thead className="bg-slate-50 border-b"><tr><th className="p-4 text-left">Recipient</th><th className="p-4 text-left">Status</th><th className="p-4 text-left">Subject</th><th className="p-4 text-left">Packets</th></tr></thead>
                  <tbody className="divide-y">{sc.emails.slice(0, 5).map(e => (
                    <tr key={e.id}><td className="p-4 font-bold">{e.recipientEmail}</td><td className={`p-4 font-bold ${e.status === 'failed' ? 'text-red-600' : e.status === 'sent' ? 'text-green-600' : 'text-amber-600'}`} title={e.error}>{e.status}</td><td className="p-4 text-slate-500">{e.personalizedSubject}</td><td className="p-4"><div className="flex flex-wrap gap-1">{e.attachments.map((a, i) => <span key={i} className="bg-blue-50 text-blue-700 text-[8px] px-1 rounded border border-blue-100">Packet_{i}</span>)}</div></td></tr>
                  ))}</tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </main>
      <footer className="mt-16 mb-8 text-center text-slate-400 text-xs font-medium">
        <p>MassMailer Pro v1.4 &bull; Gemini 2.5 Real-time Engine &bull; SMTP Delivery</p>
      </footer>
    </div>
  );
};

export default App;
