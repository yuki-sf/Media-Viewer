import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Link, useLocation } from 'react-router-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Play, Pause, Search, Smartphone, Tv, Folder, Image, Music, Film, SkipBack, SkipForward, Volume2, Maximize, ArrowLeft, Cloud, Cast, RefreshCw, X } from 'lucide-react';
import './styles.css';

// Set VITE_API_URL in Vercel to your Render backend URL.
// Example: https://media-viewer-cs9s.onrender.com
const API_BASE_URL = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const backendUrl = (path) => `${API_BASE_URL}${path}`;

const api = async (url, options = {}) => {
  const r = await fetch(backendUrl(url), { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `Request failed (${r.status})`);
  return data;
};
const post = (url, body, token) => api(url, { method: 'POST', headers: token ? { Authorization: `Bearer ${token}` } : {}, body: JSON.stringify(body) });
const getType = f => f.mimeType === 'application/vnd.google-apps.folder' ? 'folder' : f.mimeType?.startsWith('video/') ? 'video' : f.mimeType?.startsWith('image/') ? 'image' : f.mimeType?.startsWith('audio/') ? 'audio' : 'other';
const iconFor = f => { const t = getType(f); return t === 'folder' ? Folder : t === 'video' ? Film : t === 'image' ? Image : t === 'audio' ? Music : Cloud; };

function App() {
  const location = useLocation();
  const isRemote = location.pathname === '/remote';
  return isRemote ? <MobileRemote /> : <TvHome />;
}

function TvHome() {
  const [session, setSession] = useState(null); const [drive, setDrive] = useState({ connected: false, configured: false });
  const [files, setFiles] = useState([]); const [folder, setFolder] = useState(null); const [search, setSearch] = useState('');
  const [current, setCurrent] = useState(null); const [playing, setPlaying] = useState(false); const [progress, setProgress] = useState({ currentTime: 0, duration: 0 });
  const [notice, setNotice] = useState(''); const videoRef = useRef(null); const wsRef = useRef(null); const currentIdRef = useRef(null); const filesRef = useRef([]); const [showPair, setShowPair] = useState(true);
  const refreshDrive = useCallback(async () => { try { setDrive(await api('/api/drive/status')); } catch (e) { setNotice(e.message); } }, []);
  const loadFiles = useCallback(async (parent = null, q = '') => {
    try { const params = new URLSearchParams(); if (parent) params.set('parent', parent); if (q) params.set('q', q); const data = await api(`/api/drive/files?${params}`); setFiles(data.files || []); setFolder(parent); }
    catch (e) { setFiles([]); setNotice(e.message); }
  }, []);
  useEffect(() => { refreshDrive(); api('/api/sessions', { method: 'POST' }).then(setSession).catch(e => setNotice(e.message)); }, [refreshDrive]);
  useEffect(() => { filesRef.current = files; }, [files]);
  useEffect(() => { if (drive.connected) loadFiles(); }, [drive.connected, loadFiles]);
  useEffect(() => {
    if (!session) return;
    const backend = new URL(API_BASE_URL || window.location.origin);
    const scheme = backend.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${scheme}//${backend.host}/ws?session=${encodeURIComponent(session.sessionId)}&role=tv&token=${encodeURIComponent(session.tvToken)}`); wsRef.current = ws;
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.type === 'state' && m.state) { setPlaying(m.state.playing); if (m.state.currentFile && m.state.currentFile.id !== currentIdRef.current) { playFile(m.state.currentFile); } if (m.command) { const v = videoRef.current; if (m.command.type === 'play') v?.play().catch(() => {}); if (m.command.type === 'pause') v?.pause(); if (m.command.type === 'stop' && v) { v.pause(); v.currentTime = 0; } if (m.command.type === 'seek' && v && Number.isFinite(Number(m.command.value))) v.currentTime = Number(m.command.value); if (m.command.type === 'volume' && v) v.volume = Math.max(0, Math.min(1, Number(m.command.value))); if (['next', 'previous'].includes(m.command.type)) { const candidates = filesRef.current.filter(f => ['video', 'audio', 'image'].includes(getType(f))); const idx = candidates.findIndex(f => f.id === currentIdRef.current); const nextIdx = m.command.type === 'next' ? idx + 1 : idx - 1; if (nextIdx >= 0 && nextIdx < candidates.length) playFile(candidates[nextIdx]); } } } };
    return () => ws.close();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);
  const sendProgress = useCallback(() => {
    const v = videoRef.current; if (!v || !session) return;
    post(`/api/sessions/${session.sessionId}/progress`, { currentTime: v.currentTime, duration: Number.isFinite(v.duration) ? v.duration : 0, playing: !v.paused }, session.tvToken).catch(() => {});
  }, [session]);
  const playFile = useCallback((f) => {
    currentIdRef.current = f.id; setCurrent(f); setPlaying(true);
    if (f.mimeType?.startsWith('video/') || f.mimeType?.startsWith('audio/')) {
      setTimeout(() => { const v = videoRef.current; if (v) { v.src = backendUrl(`/api/drive/stream/${encodeURIComponent(f.id)}`); v.play().catch(() => setNotice('Playback was blocked or this format is unsupported by the browser.')); } }, 30);
    }
  }, []);
  useEffect(() => { const t = setInterval(sendProgress, 2000); return () => clearInterval(t); }, [sendProgress]);
  const toggle = () => { const v = videoRef.current; if (!v) return; if (v.paused) v.play().catch(() => {}); else v.pause(); };
  const goUp = () => { setFolder(null); loadFiles(null, search); };
  const openItem = async f => { if (getType(f) === 'folder') loadFiles(f.id, ''); else if (['video', 'audio'].includes(getType(f))) { playFile(f); } else if (getType(f) === 'image') { currentIdRef.current = f.id; setCurrent(f); } };
  return <main className="tv-shell">
    <header className="topbar"><div className="brand"><div className="brand-mark"><Play fill="currentColor" size={19}/></div><div><b>DRIVE TV</b><small>YOUR PERSONAL MEDIA CENTER</small></div></div><div className="top-actions"><span className={`status-dot ${drive.connected ? 'online' : ''}`}/><span className="muted">{drive.connected ? 'Drive connected' : 'Drive not connected'}</span><button className="icon-btn" onClick={() => { refreshDrive(); if (drive.connected) loadFiles(folder, search); }} title="Refresh"><RefreshCw size={18}/></button></div></header>
    <section className="hero"><div className="hero-copy"><div className="eyebrow"><span className="eyebrow-line"/> YOUR COLLECTION, ON THE BIG SCREEN</div><h1>Movie night.<br/><span>Your way.</span></h1><p>Your videos, photos and music from Google Drive, ready to play on your TV.</p><div className="hero-actions"><button className="primary-btn" onClick={() => drive.connected ? loadFiles() : window.location.href = backendUrl('/auth/google')}>{drive.connected ? <><Film size={18}/> Browse library</> : <><Cloud size={18}/> Connect Google Drive</>}</button><button className="secondary-btn" onClick={() => setShowPair(!showPair)}><Smartphone size={18}/> {showPair ? 'Hide phone pairing' : 'Use your phone'}</button></div></div><div className="hero-art"><div className="orb orb-one"/><div className="orb orb-two"/><div className="screen-art"><div className="screen-sky"/><div className="screen-mountain m1"/><div className="screen-mountain m2"/><div className="screen-sun"/><div className="screen-play"><Play fill="currentColor" size={28}/></div><span className="screen-label">YOUR NEXT FAVORITE</span></div><div className="art-caption"><span className="art-pulse"/> READY WHEN YOU ARE</div></div></section>
    {showPair && <section className="pair-banner"><div className="pair-copy"><div className="pair-icon"><Smartphone size={22}/></div><div><h3>Make your phone the remote</h3><p>Scan this QR code to search your Drive and control playback from your mobile.</p><small>Phone and TV both connect to this web app — no direct device connection.</small></div></div><div className="qr-wrap">{session ? <><QRCodeSVG value={session.pairUrl} size={116} bgColor="#ffffff" fgColor="#111827" level="M"/><span>SCAN TO PAIR</span></> : <span className="muted">Preparing QR…</span>}</div></section>}
    <section className="library-section"><div className="section-heading"><div><div className="eyebrow"><span className="eyebrow-line"/> THE LIBRARY</div><h2>Explore your collection</h2></div><div className="library-tools"><div className="searchbox"><Search size={17}/><input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadFiles(folder, search)} placeholder="Search Drive files…"/><button onClick={() => loadFiles(folder, search)}>Go</button></div></div></div>
      {!drive.connected ? <div className="empty-state"><Cloud size={34}/><h3>Your library is waiting</h3><p>Connect your personal Google Drive to browse your media.</p><button className="primary-btn" onClick={() => window.location.href = backendUrl('/auth/google')}>Connect Google Drive</button><small>Read-only access is requested. Your files are never modified.</small></div> : <><div className="folder-row">{folder && <button className="crumb" onClick={goUp}><ArrowLeft size={16}/> Root folder</button>}<span>{files.length} items</span></div><div className="media-grid">{files.map(f => { const Icon = iconFor(f); return <button className="media-card" key={f.id} onClick={() => openItem(f)}><div className={`media-thumb ${getType(f)}`}>{f.thumbnailLink && getType(f) !== 'folder' ? <img src={f.thumbnailLink} alt=""/> : <Icon size={30}/>}<span className="thumb-action">{getType(f) === 'folder' ? 'OPEN FOLDER' : 'OPEN MEDIA'}</span></div><div className="media-info"><span className="media-type">{getType(f).toUpperCase()}</span><b title={f.name}>{f.name}</b><small>{f.size ? `${(Number(f.size) / 1024 / 1024).toFixed(1)} MB` : f.mimeType}</small></div></button>; })}</div>{files.length === 0 && <div className="empty-state compact"><Folder size={30}/><h3>No files found</h3><p>Try another search or open a folder.</p></div>}</>}
    </section>
    {current && <div className="player-overlay"><div className="player-top"><div><span className="eyebrow">NOW PLAYING</span><h3>{current.name}</h3></div><button className="icon-btn" onClick={() => { videoRef.current?.pause(); setCurrent(null); }}><X/></button></div>{current.mimeType?.startsWith('image/') ? <img className="image-view" src={backendUrl(`/api/drive/stream/${encodeURIComponent(current.id)}`)} alt={current.name}/> : <video ref={videoRef} controls autoPlay playsInline onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={() => setProgress({ currentTime: videoRef.current?.currentTime || 0, duration: videoRef.current?.duration || 0 })} onEnded={() => setPlaying(false)} />}</div>}
    {notice && <div className="toast" role="status">{notice}<button onClick={() => setNotice('')}><X size={14}/></button></div>}
    <footer className="footer"><span>DRIVE TV <span className="muted">· PRIVATE BY DESIGN</span></span><span>Built for the big screen <Tv size={14}/></span></footer>
  </main>;
}

function MobileRemote() {
  const params = new URLSearchParams(useLocation().search); const sessionId = params.get('session'); const pairToken = params.get('pair');
  const [token, setToken] = useState(''); const [files, setFiles] = useState([]); const [search, setSearch] = useState(''); const [folder, setFolder] = useState(null); const [state, setState] = useState(null); const [error, setError] = useState(''); const [drive, setDrive] = useState(false); const [selectedImage, setSelectedImage] = useState(null); const [slideshow, setSlideshow] = useState(false); const wsRef = useRef(null);
  useEffect(() => { api('/api/drive/status').then(s => setDrive(s.connected)).catch(() => {}); if (!sessionId || !pairToken) { setError('This pairing link is incomplete. Scan the QR code on your TV again.'); return; } post(`/api/sessions/${sessionId}/pair`, { pairToken }).then(d => { setToken(d.mobileToken); setState(d.state); }).catch(e => setError(e.message)); }, [sessionId, pairToken]);
  const loadFiles = useCallback(async (parent = null, q = '') => { try { const p = new URLSearchParams(); if (parent) p.set('parent', parent); if (q) p.set('q', q); const d = await api(`/api/drive/files?${p}`); setFiles(d.files || []); setFolder(parent); setError(''); } catch (e) { setError(e.message); } }, []);
  useEffect(() => { if (token) loadFiles(); }, [token, loadFiles]);
  useEffect(() => { if (!token || !sessionId) return; const backend = new URL(API_BASE_URL || window.location.origin); const scheme = backend.protocol === 'https:' ? 'wss:' : 'ws:'; const ws = new WebSocket(`${scheme}//${backend.host}/ws?session=${encodeURIComponent(sessionId)}&role=mobile&token=${encodeURIComponent(token)}`); wsRef.current = ws; ws.onmessage = e => { const m = JSON.parse(e.data); if (m.state) setState(m.state); }; return () => ws.close(); }, [token, sessionId]);
  const imageFiles = files.filter(f => getType(f) === 'image');
  const moveImage = (direction) => {
    if (!selectedImage || imageFiles.length < 2) return;
    const index = imageFiles.findIndex(f => f.id === selectedImage.id);
    const nextIndex = (index + direction + imageFiles.length) % imageFiles.length;
    setSelectedImage(imageFiles[nextIndex]);
  };
  useEffect(() => {
    if (!slideshow || !selectedImage || imageFiles.length < 2) return;
    const timer = window.setInterval(() => {
      setSelectedImage(current => {
        if (!current) return current;
        const index = imageFiles.findIndex(f => f.id === current.id);
        return imageFiles[(index + 1) % imageFiles.length];
      });
    }, 3500);
    return () => window.clearInterval(timer);
  }, [slideshow, selectedImage, files]);
  useEffect(() => {
    if (!selectedImage) return;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') { setSelectedImage(null); setSlideshow(false); }
      if (event.key === 'ArrowRight') moveImage(1);
      if (event.key === 'ArrowLeft') moveImage(-1);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedImage, files]);
  const command = async (type, value, file) => { try { const d = await post(`/api/sessions/${sessionId}/command`, { type, value, file }, token); setState(d.state); if (type === 'select') setView('remote'); } catch (e) { setError(e.message); } };
  const [view, setView] = useState('library');
  if (!token) return <main className="mobile-shell"><div className="mobile-brand"><div className="brand-mark"><Play fill="currentColor" size={18}/></div><b>DRIVE TV</b></div><div className="mobile-wait"><Smartphone size={36}/><h1>Connecting your remote</h1><p>{error || 'Pairing securely with your TV…'}</p>{error && <Link to="/" className="primary-btn">Open TV app</Link>}</div></main>;
  return <main className="mobile-shell"><header className="mobile-header"><div className="mobile-brand"><div className="brand-mark"><Play fill="currentColor" size={17}/></div><div><b>DRIVE TV</b><small>PHONE REMOTE</small></div></div><span className="connected-pill"><span className="status-dot online"/> PAIRED</span></header><div className="mobile-tabs"><button className={view === 'library' ? 'active' : ''} onClick={() => setView('library')}><Search size={16}/> Browse</button><button className={view === 'remote' ? 'active' : ''} onClick={() => setView('remote')}><Tv size={16}/> Remote</button></div>
    {view === 'library' ? <section className="mobile-content"><div className="eyebrow"><span className="eyebrow-line"/> YOUR GOOGLE DRIVE</div><h1>Find something<br/><span>to watch.</span></h1>{!drive && <div className="notice-card"><Cloud size={20}/><div><b>Connect Google Drive</b><p>Connect Drive from the TV app first.</p><a href={backendUrl('/auth/google')}>Connect Google</a></div></div>}<div className="searchbox mobile-search"><Search size={18}/><input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => e.key === 'Enter' && loadFiles(folder, search)} placeholder="Search videos, music, photos…"/><button onClick={() => loadFiles(folder, search)}>Go</button></div>{folder && <button className="crumb" onClick={() => loadFiles(null, search)}><ArrowLeft size={16}/> All files</button>}<div className="mobile-file-list">{files.map(f => { const Icon = iconFor(f); return <button key={f.id} className="mobile-file" onClick={() => { if (getType(f) === 'folder') loadFiles(f.id, ''); else if (['video', 'audio'].includes(getType(f))) command('select', null, { id: f.id, name: f.name, mimeType: f.mimeType }); else if (getType(f) === 'image') { setSelectedImage(f); setSlideshow(false); } else setError('This file type is not supported for preview.'); }}><div className={`file-icon ${getType(f)}`}><Icon size={20}/></div><div className="file-name"><b>{f.name}</b><small>{getType(f)}{f.size ? ` · ${(Number(f.size) / 1048576).toFixed(1)} MB` : ''}</small></div><span className="file-chevron">{getType(f) === 'folder' ? '›' : '＋'}</span></button>; })}</div>{!files.length && <div className="mobile-empty"><Folder size={26}/><p>No files to show. Connect Drive and refresh.</p><button className="secondary-btn" onClick={() => loadFiles(folder, search)}>Refresh library</button></div>}</section> : <section className="mobile-content remote-content"><div className="eyebrow"><span className="eyebrow-line"/> NOW ON YOUR TV</div><h1>TV remote<span>.</span></h1><div className="now-playing-card"><div className="now-art"><Tv size={30}/></div><div className="now-meta"><small>NOW PLAYING</small><b>{state?.currentFile?.name || 'Nothing playing yet'}</b><span>{state?.playing ? 'Playing' : state?.currentFile ? 'Paused' : 'Choose something from Browse'}</span></div></div><div className="remote-controls"><button className="control-small" onClick={() => command('previous')}><SkipBack/></button><button className="control-main" onClick={() => command(state?.playing ? 'pause' : 'play')}>{state?.playing ? <Pause fill="currentColor"/> : <Play fill="currentColor"/>}</button><button className="control-small" onClick={() => command('next')}><SkipForward/></button></div><div className="seek-panel"><div className="seek-labels"><span>{formatTime(state?.currentTime || 0)}</span><span>{formatTime(state?.duration || 0)}</span></div><input aria-label="Seek position" type="range" min="0" max={Math.max(1, state?.duration || 1)} value={Math.min(state?.currentTime || 0, state?.duration || 1)} onChange={e => command('seek', Number(e.target.value))}/><div className="volume-row"><Volume2 size={18}/><span>Volume</span><input aria-label="Volume" type="range" min="0" max="1" step="0.05" value={state?.volume ?? 1} onChange={e => command('volume', Number(e.target.value))}/></div></div><button className="secondary-btn full-btn" onClick={() => setView('library')}><Search size={17}/> Browse your Drive</button><p className="remote-note">Controls are sent to the web app backend. The TV player executes them and syncs playback status.</p></section>}
    {selectedImage && <div className="mobile-image-viewer" role="dialog" aria-modal="true" aria-label={`Photo preview: ${selectedImage.name}`}>
      <div className="mobile-image-toolbar">
        <div className="mobile-image-title"><small>PHOTO PREVIEW</small><b title={selectedImage.name}>{selectedImage.name}</b></div>
        <button className="icon-btn" aria-label="Close photo" onClick={() => { setSelectedImage(null); setSlideshow(false); }}><X size={20}/></button>
      </div>
      <div className="mobile-image-stage">
        {imageFiles.length > 1 && <button className="image-nav image-prev" aria-label="Previous photo" onClick={() => moveImage(-1)}><SkipBack size={20}/></button>}
        <img src={backendUrl(`/api/drive/stream/${encodeURIComponent(selectedImage.id)}`)} alt={selectedImage.name} />
        {imageFiles.length > 1 && <button className="image-nav image-next" aria-label="Next photo" onClick={() => moveImage(1)}><SkipForward size={20}/></button>}
      </div>
      <div className="mobile-image-actions">
        <span>{Math.max(1, imageFiles.findIndex(f => f.id === selectedImage.id) + 1)} of {imageFiles.length || 1}</span>
        <button className="secondary-btn" onClick={() => setSlideshow(v => !v)}>{slideshow ? <Pause size={16}/> : <Play size={16}/>} {slideshow ? 'Stop slideshow' : 'Slideshow'}</button>
        <button className="primary-btn" onClick={() => { setSelectedImage(null); setSlideshow(false); command('select', null, { id: selectedImage.id, name: selectedImage.name, mimeType: selectedImage.mimeType }); }}><Tv size={16}/> Show on TV</button>
      </div>
      <p className="mobile-image-hint">Photos load securely through your media-center backend. Use the arrows to browse images in this folder.</p>
    </div>}
    {error && <div className="mobile-error" onClick={() => setError('')}>{error} <X size={14}/></div>}<footer className="mobile-footer">DRIVE TV <span>·</span> YOUR MEDIA, YOUR SPACE</footer>
  </main>;
}
function formatTime(s) { if (!Number.isFinite(s)) return '0:00'; const n = Math.max(0, Math.floor(s)); return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`; }

createRoot(document.getElementById('root')).render(<React.StrictMode><BrowserRouter><App/></BrowserRouter></React.StrictMode>);
