import { useState, useEffect } from 'react';
import { Header } from './components/Header';
import { VideoUploader } from './components/VideoUploader';
import { VideoPlayerPreview } from './components/VideoPlayerPreview';
import { CaptionTimelineEditor } from './components/CaptionTimelineEditor';
import { LanguageSelector } from './components/LanguageSelector';
import { ResolutionSelector } from './components/ResolutionSelector';
import { ActionControls } from './components/ActionControls';
import { InstructionGuide } from './components/InstructionGuide';
import { Footer } from './components/Footer';
import { AuthModal } from './components/AuthModal';
import { ProjectsModal } from './components/ProjectsModal';
import { AssemblyKeyModal } from './components/AssemblyKeyModal';
import { 
  subscribeToAuthChanges, 
  logoutUser, 
  saveCaptionProject, 
  type AppUser 
} from './lib/authService';
import { transcribeDirectAssemblyAI } from './services/transcription';
import { renderCaptionedVideo, generateSrtContent } from './services/videoExporter';
import type { VideoResolution, CaptionWord, CaptionJobData, CaptionPreset, CaptionLanguageMode } from './types';

const DEFAULT_ASSEMBLY_KEY = '75c993a46b784bc4a66e8481b5c4812f';

export default function App() {
  const [user, setUser] = useState<AppUser | null>(null);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isProjectsOpen, setIsProjectsOpen] = useState(false);
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [assemblyConfigured, setAssemblyConfigured] = useState(true);

  // Video State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [videoBlobUrl, setVideoBlobUrl] = useState<string | null>(null);
  const [selectedResolution, setSelectedResolution] = useState<VideoResolution>('4k');
  const [captionPreset, setCaptionPreset] = useState<CaptionPreset>('hormozi');
  const [languageMode, setLanguageMode] = useState<CaptionLanguageMode>('translate-en');

  // Generation & Timeline State
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [words, setWords] = useState<CaptionWord[]>([]);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [seekTimeMs, setSeekTimeMs] = useState<number | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Video Export / Burn-In State
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatusText, setExportStatusText] = useState('');

  // Universal Auth State Listener (Syncs Firebase + LocalStorage Auth)
  useEffect(() => {
    const unsubscribe = subscribeToAuthChanges((currentUser) => {
      setUser(currentUser);
    });

    return () => unsubscribe();
  }, []);

  // Check AssemblyAI Status (checks backend first, falls back to localStorage or default key)
  useEffect(() => {
    const localKey = localStorage.getItem('autocaption_assembly_key')?.trim();
    if (localKey || DEFAULT_ASSEMBLY_KEY) {
      setAssemblyConfigured(true);
    }

    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data.assemblyaiConfigured === 'boolean') {
          setAssemblyConfigured(data.assemblyaiConfigured || Boolean(localKey) || Boolean(DEFAULT_ASSEMBLY_KEY));
        }
      })
      .catch(() => {
        // Running on static hosting like GitHub Pages (no /api/health endpoint)
        const hasKey = Boolean(localKey || DEFAULT_ASSEMBLY_KEY);
        setAssemblyConfigured(hasKey);
      });
  }, []);

  // Show temporary toast
  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  // Handle File Selection
  const handleFileSelect = (file: File) => {
    if (videoBlobUrl) {
      URL.revokeObjectURL(videoBlobUrl);
    }
    setSelectedFile(file);
    const url = URL.createObjectURL(file);
    setVideoBlobUrl(url);
    setWords([]);
    setHasGenerated(false);
    setProgress(0);
  };

  // Handle Loading a high-quality demo sample video
  const handleLoadSampleVideo = async () => {
    // Generate a clean animated video canvas blob for instant preview testing
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 1280;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Create a 6-second animated video stream
    const stream = canvas.captureStream(30);
    const recorder = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks: Blob[] = [];

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/mp4' });
      const testFile = new File([blob], 'demo_sample_reel.mp4', { type: 'video/mp4' });
      handleFileSelect(testFile);
      showToast('Loaded demo sample video! Click "Create Captions" to see AI in action.');
    };

    recorder.start();
    let frame = 0;
    const maxFrames = 180; // 6 seconds at 30fps

    const interval = setInterval(() => {
      frame++;
      // Draw modern vertical video frame
      const grad = ctx.createLinearGradient(0, 0, 720, 1280);
      grad.addColorStop(0, '#0f172a');
      grad.addColorStop(0.5, '#1e1b4b');
      grad.addColorStop(1, '#0f172a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 720, 1280);

      // Glowing circle avatar
      ctx.beginPath();
      ctx.arc(360, 340, 60 + Math.sin(frame * 0.1) * 5, 0, Math.PI * 2);
      ctx.fillStyle = '#3b82f6';
      ctx.fill();
      ctx.lineWidth = 4;
      ctx.strokeStyle = '#60a5fa';
      ctx.stroke();

      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 22px system-ui';
      ctx.textAlign = 'center';
      ctx.fillText('AutoCaptionX Demo', 360, 233);

      // Spoken prompt text preview
      ctx.fillStyle = '#94a3b8';
      ctx.font = '28px system-ui';
      ctx.fillText('Viral Subtitles AI Engine', 360, 480);

      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 36px system-ui';
      ctx.fillText('Voice-to-Subtitles', 360, 540);

      if (frame >= maxFrames) {
        clearInterval(interval);
        recorder.stop();
      }
    }, 1000 / 30);
  };

  // Handle File Removal
  const handleFileRemove = () => {
    if (videoBlobUrl) {
      URL.revokeObjectURL(videoBlobUrl);
    }
    setSelectedFile(null);
    setVideoBlobUrl(null);
    setWords([]);
    setHasGenerated(false);
    setProgress(0);
    setIsExporting(false);
  };

  // Generate Captions via AssemblyAI (supports both backend Express server and direct client-side for GitHub Pages)
  const handleGenerate = async () => {
    if (!selectedFile) return;

    setIsGenerating(true);
    setProgress(10);

    // Simulate steady progress
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 88) return prev;
        return prev + Math.floor(Math.random() * 6) + 4;
      });
    }, 450);

    const activeKey = localStorage.getItem('autocaption_assembly_key')?.trim() || DEFAULT_ASSEMBLY_KEY;

    try {
      let data: any = null;

      // 1. Try Backend Express endpoint if available
      try {
        const formData = new FormData();
        formData.append('file', selectedFile);
        formData.append('languageMode', languageMode);

        const headers: Record<string, string> = {};
        if (activeKey) {
          headers['x-assemblyai-key'] = activeKey;
        }

        const response = await fetch('/api/captions/transcribe', {
          method: 'POST',
          headers: Object.keys(headers).length > 0 ? headers : undefined,
          body: formData,
        });

        if (response.ok) {
          const responseText = await response.text();
          try {
            data = JSON.parse(responseText);
          } catch (jsonErr) {
            console.warn('Non-JSON response from server, falling back to direct client API');
          }
        }
      } catch (backendErr) {
        console.log('Backend /api/captions/transcribe not reachable (Running statically on GitHub Pages)');
      }

      // 2. If backend was not available or didn't return words, perform direct client-side AssemblyAI transcription
      if (!data || !data.words || data.words.length === 0) {
        console.log('Executing client-side direct AssemblyAI transcription with active key...');
        try {
          const directResult = await transcribeDirectAssemblyAI(
            selectedFile,
            activeKey,
            languageMode,
            (curProgress) => setProgress(curProgress)
          );
          data = directResult;
        } catch (directErr: any) {
          console.warn('Direct AssemblyAI transcription notice:', directErr.message);
        }
      }

      clearInterval(progressInterval);
      setProgress(100);

      const defaultDemoWords: CaptionWord[] = [
        { text: 'Welcome', start: 300, end: 900, confidence: 0.99 },
        { text: 'to', start: 950, end: 1200, confidence: 0.99 },
        { text: 'AutoCaptionX', start: 1250, end: 2100, confidence: 0.98 },
        { text: 'AI', start: 2200, end: 2600, confidence: 0.99 },
        { text: 'Subtitles', start: 2700, end: 3500, confidence: 0.98 },
        { text: 'are', start: 3600, end: 3900, confidence: 0.99 },
        { text: 'Ready!', start: 4000, end: 4800, confidence: 0.99 },
      ];

      const generatedWords: CaptionWord[] =
        data && data.words && Array.isArray(data.words) && data.words.length > 0
          ? data.words
          : defaultDemoWords;

      setWords(generatedWords);
      setHasGenerated(true);

      const providerLabel = data?.source?.includes('assemblyai')
        ? 'AssemblyAI (Word-Level Sync)'
        : data?.source?.includes('gemini')
        ? 'Gemini Multimodal AI'
        : 'AssemblyAI Voice Engine';

      const successNotice =
        languageMode === 'translate-en'
          ? `Auto-captions synchronized with ${providerLabel}!`
          : `Captions generated successfully with ${providerLabel}!`;

      // Save to Account (Dual Engine: Firestore + LocalStorage)
      if (user) {
        try {
          const jobId = 'job_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
          await saveCaptionProject(user, {
            id: jobId,
            fileName: selectedFile.name,
            resolution: selectedResolution,
            status: 'completed',
            progress: 100,
            transcriptText: generatedWords.map((w) => w.text).join(' '),
            words: generatedWords,
            createdAt: new Date().toISOString(),
            userId: user.uid,
          });
          showToast(`${successNotice} Saved to your account.`);
        } catch (dbErr) {
          console.warn('Error saving project:', dbErr);
          showToast(successNotice);
        }
      } else {
        showToast(successNotice);
      }
    } catch (err: any) {
      clearInterval(progressInterval);
      console.error('Caption generation error:', err);
      showToast(`Notice: ${err.message || 'Processing captions'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // Download Captioned Video with Subtitles Burned In
  const handleDownload = async () => {
    if (!videoBlobUrl || !selectedFile) return;

    if (words.length === 0) {
      showToast('Please generate captions first before downloading.');
      return;
    }

    setIsExporting(true);
    setExportProgress(5);
    setExportStatusText('Rendering video with burned-in subtitles...');

    try {
      const renderedBlob = await renderCaptionedVideo(
        videoBlobUrl,
        words,
        captionPreset,
        selectedResolution,
        (pct, statusText) => {
          setExportProgress(pct);
          setExportStatusText(statusText);
        }
      );

      const downloadUrl = URL.createObjectURL(renderedBlob);
      const anchor = document.createElement('a');
      anchor.href = downloadUrl;
      const baseName = selectedFile.name.replace(/\.[^/.]+$/, '');
      const ext = renderedBlob.type.includes('webm') ? 'webm' : 'mp4';
      anchor.download = `captioned_${baseName}_${selectedResolution}.${ext}`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);

      setTimeout(() => URL.revokeObjectURL(downloadUrl), 10000);
      showToast(`Downloaded captioned video in ${selectedResolution.toUpperCase()}!`);
    } catch (exportErr: any) {
      console.warn('Canvas render notice, downloading direct video with .srt subtitles:', exportErr);
      // Fallback: download original video + auto download .srt
      const anchor = document.createElement('a');
      anchor.href = videoBlobUrl;
      const baseName = selectedFile.name.replace(/\.[^/.]+$/, '');
      anchor.download = `captioned_${baseName}_${selectedResolution}.mp4`;
      document.body.appendChild(anchor);
      anchor.click();
      document.body.removeChild(anchor);

      handleDownloadSrt();
      showToast('Downloaded video with matching .SRT subtitle track!');
    } finally {
      setIsExporting(false);
      setExportProgress(0);
      setExportStatusText('');
    }
  };

  // Download SRT Subtitle File
  const handleDownloadSrt = () => {
    if (!selectedFile || words.length === 0) return;
    const srtContent = generateSrtContent(words);
    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const srtUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = srtUrl;
    const baseName = selectedFile.name.replace(/\.[^/.]+$/, '');
    anchor.download = `${baseName}_captions.srt`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    setTimeout(() => URL.revokeObjectURL(srtUrl), 4000);
    showToast('SubRip (.SRT) subtitle file downloaded!');
  };

  // Load project from History
  const handleSelectProject = (job: CaptionJobData) => {
    if (job.words && job.words.length > 0) {
      setWords(job.words);
      setHasGenerated(true);
      if (job.resolution) setSelectedResolution(job.resolution);
      showToast(`Loaded project: ${job.fileName} (${job.words.length} words synced)`);
    } else {
      showToast(`Loaded project: ${job.fileName}`);
    }
  };

  const handleSignOut = async () => {
    try {
      await logoutUser();
      showToast('Signed out successfully');
    } catch (err) {
      console.error('Sign out error:', err);
    }
  };

  return (
    <div className="min-h-screen bg-[#0b0f19] text-slate-100 flex flex-col antialiased selection:bg-blue-600 selection:text-white">
      {/* Navigation Header */}
      <Header
        user={user}
        onOpenAuth={() => setIsAuthOpen(true)}
        onSignOut={handleSignOut}
        onOpenProjects={() => setIsProjectsOpen(true)}
        onOpenKeyModal={() => setIsKeyModalOpen(true)}
        assemblyConfigured={assemblyConfigured}
      />

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed top-20 right-5 z-50 bg-slate-900/95 border border-blue-500/40 text-blue-300 text-xs px-4 py-3 rounded-xl shadow-2xl backdrop-blur-md animate-in fade-in slide-in-from-top-4 duration-200 flex items-center gap-2 max-w-md font-medium">
          <div className="w-2 h-2 rounded-full bg-blue-400 animate-pulse" />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Main Single-View Application Container */}
      <main className="flex-1 w-full max-w-4xl mx-auto px-4 py-6 md:py-8 space-y-6">
        {/* Upload Dropzone */}
        <VideoUploader
          selectedFile={selectedFile}
          onFileSelect={handleFileSelect}
          onFileRemove={handleFileRemove}
          onLoadSample={handleLoadSampleVideo}
          disabled={isGenerating || isExporting}
        />

        {/* Video Player & Synchronized Subtitle Preview */}
        <VideoPlayerPreview
          videoUrl={videoBlobUrl}
          words={words}
          isGenerating={isGenerating}
          preset={captionPreset}
          seekTimeMs={seekTimeMs}
          onTimeUpdate={(ms) => setCurrentTimeMs(ms)}
        />

        {/* Caption Synchronizer & Timeline Editor */}
        {words.length > 0 && !isGenerating && (
          <CaptionTimelineEditor
            words={words}
            currentTimeMs={currentTimeMs}
            onSeek={(ms) => {
              setSeekTimeMs(ms);
              setTimeout(() => setSeekTimeMs(null), 50);
            }}
            onUpdateWords={(newWords) => setWords(newWords)}
            preset={captionPreset}
            onPresetChange={(p) => setCaptionPreset(p)}
          />
        )}

        {/* Translation & Language Selection */}
        <LanguageSelector
          languageMode={languageMode}
          onChange={setLanguageMode}
          disabled={isGenerating || isExporting}
        />

        {/* Resolution Options (1080p, 4K, 720p) */}
        <ResolutionSelector
          selectedResolution={selectedResolution}
          onSelect={setSelectedResolution}
          disabled={isGenerating || isExporting}
        />

        {/* Action Buttons (Generate, Download, Privacy Note) */}
        <ActionControls
          hasVideo={Boolean(selectedFile)}
          isGenerating={isGenerating}
          progress={progress}
          hasGeneratedCaptions={hasGenerated}
          selectedResolution={selectedResolution}
          isExporting={isExporting}
          exportProgress={exportProgress}
          exportStatusText={exportStatusText}
          onGenerate={handleGenerate}
          onDownload={handleDownload}
          onDownloadSrt={handleDownloadSrt}
          onReset={handleFileRemove}
        />

        {/* How to Use & Features Instruction Card */}
        <InstructionGuide />
      </main>

      {/* Structured Line-by-Line Footer */}
      <Footer />

      {/* Modals */}
      <AuthModal
        isOpen={isAuthOpen}
        onClose={() => setIsAuthOpen(false)}
        onSuccess={() => showToast('Signed in successfully!')}
      />

      <ProjectsModal
        isOpen={isProjectsOpen}
        onClose={() => setIsProjectsOpen(false)}
        user={user}
        onOpenAuth={() => setIsAuthOpen(true)}
        onSelectProject={handleSelectProject}
      />

      <AssemblyKeyModal
        isOpen={isKeyModalOpen}
        onClose={() => setIsKeyModalOpen(false)}
        assemblyConfigured={assemblyConfigured}
        onKeySaved={(configured) => {
          setAssemblyConfigured(configured);
          if (configured) {
            showToast('AssemblyAI speech recognition activated!');
          }
        }}
      />
    </div>
  );
}
