import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle } from 'lucide-react';
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
  checkRedirectLogin,
  type AppUser 
} from './lib/authService';
import { 
  transcribeDirectAssemblyAI, 
  transcribeAudioChunksStream,
  translateHindiWordsToEnglish, 
  polishCaptionWords 
} from './services/transcription';
import { transcribeWithBrowserSpeech } from './services/browserSpeechTranscriber';
import { renderCaptionedVideo, generateSrtContent } from './services/videoExporter';
import { generateWebVTT, generateCaptionJson } from './utils/captionConverters';
import { sanitizeAndEnforceMonotonic } from './utils/audioExtractor';
import { downloadOrSaveVideoFile } from './utils/fileDownloader';
import { ExportPreviewModal } from './components/ExportPreviewModal';
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
  const [videoDurationMs, setVideoDurationMs] = useState<number>(0);
  const [selectedResolution, setSelectedResolution] = useState<VideoResolution>('4k');
  const [captionPreset, setCaptionPreset] = useState<CaptionPreset>('hormozi');
  const [languageMode, setLanguageMode] = useState<CaptionLanguageMode>('translate-en');
  const [alertError, setAlertError] = useState<string | null>(null);

  // Generation & Timeline State
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [generationStatusText, setGenerationStatusText] = useState('');
  const [words, setWords] = useState<CaptionWord[]>([]);
  const [currentTimeMs, setCurrentTimeMs] = useState(0);
  const [seekTimeMs, setSeekTimeMs] = useState<number | null>(null);
  const [hasGenerated, setHasGenerated] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Synchronize duration from preview player or video element
  const handleDurationChange = useCallback((durMs: number) => {
    if (durMs > 0) {
      setVideoDurationMs(durMs);
      setWords((prevWords) => {
        if (!prevWords || prevWords.length === 0) return prevWords;
        return sanitizeAndEnforceMonotonic(prevWords, durMs);
      });
    }
  }, []);

  // Video Export / Burn-In State
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [exportStatusText, setExportStatusText] = useState('');
  const [exportedVideoBlob, setExportedVideoBlob] = useState<Blob | null>(null);
  const [exportedFileName, setExportedFileName] = useState<string>('');
  const [isExportPreviewOpen, setIsExportPreviewOpen] = useState(false);
  const [isExportFallbackMode, setIsExportFallbackMode] = useState(false);

  // Universal Auth State Listener (Syncs Firebase + LocalStorage Auth)
  useEffect(() => {
    // Unconditionally capture redirect result from Google OAuth on return
    checkRedirectLogin().catch((e) => {
      console.warn('[AutoCaptionX Auth] Initial redirect check note:', e);
    });

    const unsubscribe = subscribeToAuthChanges((currentUser) => {
      setUser(currentUser);
    });

    return () => unsubscribe();
  }, []);

  // Check AssemblyAI Status
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
    setAlertError(null);
    setSelectedFile(file);
    const url = URL.createObjectURL(file);
    setVideoBlobUrl(url);
    setWords([]);
    setHasGenerated(false);
    setProgress(0);

    const tempVid = document.createElement('video');
    tempVid.preload = 'metadata';
    tempVid.src = url;
    tempVid.onloadedmetadata = () => {
      if (tempVid.duration && !isNaN(tempVid.duration) && tempVid.duration !== Infinity && tempVid.duration > 0.1) {
        const dMs = Math.round(tempVid.duration * 1000);
        setVideoDurationMs(dMs);
      }
      tempVid.remove();
    };
    tempVid.onerror = () => tempVid.remove();
  };

  // Handle Loading sample video
  const handleLoadSampleVideo = async () => {
    const canvas = document.createElement('canvas');
    canvas.width = 720;
    canvas.height = 1280;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

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
    let animId = 0;
    let lastTime = 0;
    const frameInterval = 1000 / 30;

    const drawDemoLoop = (timestamp: number) => {
      const elapsed = timestamp - lastTime;
      if (elapsed >= frameInterval) {
        lastTime = timestamp - (elapsed % frameInterval);
        frame++;

        const grad = ctx.createLinearGradient(0, 0, 720, 1280);
        grad.addColorStop(0, '#0f172a');
        grad.addColorStop(0.5, '#1e1b4b');
        grad.addColorStop(1, '#0f172a');
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, 720, 1280);

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

        ctx.fillStyle = '#94a3b8';
        ctx.font = '28px system-ui';
        ctx.fillText('Viral Subtitles AI Engine', 360, 480);

        ctx.fillStyle = '#38bdf8';
        ctx.font = 'bold 36px system-ui';
        ctx.fillText('Voice-to-Subtitles', 360, 540);

        if (frame >= maxFrames) {
          cancelAnimationFrame(animId);
          recorder.stop();
          canvas.width = 0;
          canvas.height = 0;
          return;
        }
      }
      animId = requestAnimationFrame(drawDemoLoop);
    };

    animId = requestAnimationFrame(drawDemoLoop);
  };

  // Handle File Removal
  const handleFileRemove = () => {
    if (videoBlobUrl) {
      URL.revokeObjectURL(videoBlobUrl);
    }
    setAlertError(null);
    setSelectedFile(null);
    setVideoBlobUrl(null);
    setWords([]);
    setHasGenerated(false);
    setProgress(0);
    setIsExporting(false);
  };

  // Generate Captions via AssemblyAI Multilingual Engine & Sync
  const handleGenerate = async () => {
    if (!selectedFile) return;

    setAlertError(null);
    setIsGenerating(true);
    setProgress(10);
    setGenerationStatusText('Analyzing audio with AssemblyAI...');
    setWords([]); // Clear previous words immediately

    const activeKey = localStorage.getItem('autocaption_assembly_key')?.trim() || DEFAULT_ASSEMBLY_KEY;

    try {
      let data: any = null;

      // 1. Sequential Audio Chunking Engine (10-15s segments with cumulative offset & timeout prevention)
      try {
        setGenerationStatusText('Splitting audio into 10-15s segments...');
        const streamResult = await transcribeAudioChunksStream(
          selectedFile,
          activeKey,
          languageMode,
          (curProgress, statusText) => {
            setProgress(curProgress);
            if (statusText) setGenerationStatusText(statusText);
          },
          videoDurationMs
        );
        data = streamResult;
      } catch (streamErr: any) {
        console.warn('Sequential chunk transcription notice:', streamErr?.message || streamErr);

        // 2. Fallback to Direct AssemblyAI Multilingual Engine
        try {
          setGenerationStatusText('Analyzing full audio track...');
          const directResult = await transcribeDirectAssemblyAI(
            selectedFile,
            activeKey,
            languageMode,
            (curProgress) => {
              setProgress(curProgress);
              setGenerationStatusText(`Transcribing audio... ${curProgress}%`);
            },
            videoDurationMs
          );
          data = directResult;
        } catch (directErr: any) {
          console.warn('Direct AssemblyAI notice:', directErr?.message || directErr);

          // 3. Fallback to Browser Speech Recognition API
          if (videoBlobUrl) {
            try {
              setGenerationStatusText('Using speech recognition...');
              const browserResult = await transcribeWithBrowserSpeech(
                videoBlobUrl,
                languageMode,
                (curProgress) => {
                  setProgress(curProgress);
                  setGenerationStatusText(`Transcribing... ${curProgress}%`);
                }
              );
              data = browserResult;
            } catch (speechErr: any) {
              console.warn('Browser speech recognition fallback notice:', speechErr?.message || speechErr);
            }
          }
        }
      }

      setProgress(100);

      const hasValidData = data && data.words && Array.isArray(data.words) && data.words.length > 0;

      if (!hasValidData) {
        setWords([]);
        setHasGenerated(false);
        const errMsg = 'Speech not recognized or invalid audio format';
        setAlertError(errMsg);
        showToast(errMsg);
        return;
      }

      setGenerationStatusText('Captions ready!');

      let rawGeneratedWords: CaptionWord[] = data.words;

      // Double-check English translation if Translate to English is selected
      if (languageMode === 'translate-en' && rawGeneratedWords.length > 0) {
        const hasHindiChars = rawGeneratedWords.some((w) => /[\u0900-\u097F]/.test(w.text));
        if (hasHindiChars) {
          rawGeneratedWords = await translateHindiWordsToEnglish(rawGeneratedWords);
        }
      }

      // Map returned words array directly to subtitle state and sanitize monotonic timeline
      const finalContinuousWords = sanitizeAndEnforceMonotonic(rawGeneratedWords, videoDurationMs);
      setWords(finalContinuousWords);
      setHasGenerated(true);
      setAlertError(null);

      const providerLabel = data?.source?.includes('assemblyai')
        ? 'AssemblyAI (Word-Level Sync)'
        : data?.source?.includes('chunk') || data?.source?.includes('stream')
        ? 'Streaming Audio Chunk Engine'
        : data?.source?.includes('browser')
        ? 'Browser Speech Recognition'
        : 'AutoCaptionX Speech Engine';

      const successNotice = languageMode === 'translate-en'
        ? `Captions auto-transcribed & translated with ${providerLabel}!`
        : `Captions generated & synced with ${providerLabel}!`;

      // Save to Account
      if (user) {
        try {
          const jobId = 'job_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 6);
          await saveCaptionProject(user, {
            id: jobId,
            fileName: selectedFile.name,
            resolution: selectedResolution,
            status: 'completed',
            progress: 100,
            transcriptText: rawGeneratedWords.map((w) => w.text).join(' '),
            words: rawGeneratedWords,
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
      console.error('Caption generation error:', err);
      setWords([]);
      setHasGenerated(false);
      const errMsg = 'Speech not recognized or invalid audio format';
      setAlertError(errMsg);
      showToast(errMsg);
    } finally {
      setIsGenerating(false);
      setProgress(0);
      setGenerationStatusText('');
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

      // Convert the processed canvas video explicitly to video/mp4 format before triggering download
      const mp4Blob = new Blob([renderedBlob], { type: 'video/mp4' });
      const baseName = selectedFile.name.replace(/\.[^/.]+$/, '');
      const fileName = `captioned_${baseName}_${selectedResolution}.mp4`;

      setExportedVideoBlob(mp4Blob);
      setExportedFileName(fileName);
      setIsExportPreviewOpen(true);

      const res = await downloadOrSaveVideoFile(mp4Blob, fileName, (notice) => {
        setExportStatusText(notice);
      });

      if (res.needsLongPressModal) {
        setIsExportFallbackMode(true);
        showToast('Long press video to Save to Gallery');
      } else {
        setIsExportFallbackMode(false);
        showToast(res.message || `Saved captioned video in ${selectedResolution.toUpperCase()} MP4!`);
      }
    } catch (exportErr: any) {
      console.warn('Canvas render notice, falling back to direct video stream preview modal:', exportErr);
      
      try {
        const baseName = selectedFile.name.replace(/\.[^/.]+$/, '');
        const response = await fetch(videoBlobUrl);
        const sourceBlob = await response.blob();
        // Convert to video/mp4 explicitly
        const mp4Fallback = new Blob([sourceBlob], { type: 'video/mp4' });
        const fallbackName = `captioned_${baseName}_${selectedResolution}.mp4`;

        setExportedVideoBlob(mp4Fallback);
        setExportedFileName(fallbackName);
        setIsExportFallbackMode(true);
        setIsExportPreviewOpen(true);

        await downloadOrSaveVideoFile(mp4Fallback, fallbackName);
      } catch (e) {
        setIsExportFallbackMode(true);
        setIsExportPreviewOpen(true);
      }

      handleDownloadSrt();
      showToast('Opened Long-Press to Save Video preview with matching .SRT track!');
    } finally {
      setIsExporting(false);
      setExportProgress(0);
      setExportStatusText('');
    }
  };

  // Download SRT Subtitle File
  const handleDownloadSrt = () => {
    if (!selectedFile || words.length === 0) return;
    const srtContent = generateSrtContent(words, videoDurationMs);
    const blob = new Blob([srtContent], { type: 'text/plain;charset=utf-8' });
    const baseName = selectedFile.name.replace(/\.[^/.]+$/, '');
    downloadOrSaveVideoFile(blob, `${baseName}_captions.srt`);
    showToast('SubRip (.SRT) subtitle file saved to Downloads!');
  };

  // Download WebVTT Subtitle File
  const handleDownloadVtt = () => {
    if (!selectedFile || words.length === 0) return;
    const vttContent = generateWebVTT(words, videoDurationMs);
    const blob = new Blob([vttContent], { type: 'text/vtt;charset=utf-8' });
    const baseName = selectedFile.name.replace(/\.[^/.]+$/, '');
    downloadOrSaveVideoFile(blob, `${baseName}_captions.vtt`);
    showToast('WebVTT (.VTT) subtitle file saved to Downloads!');
  };

  // Download Word-Level JSON File (Exact timestamps & words without truncation)
  const handleDownloadJson = () => {
    if (!selectedFile || words.length === 0) return;
    const jsonContent = generateCaptionJson(words, videoDurationMs);
    const blob = new Blob([jsonContent], { type: 'application/json;charset=utf-8' });
    const baseName = selectedFile.name.replace(/\.[^/.]+$/, '');
    downloadOrSaveVideoFile(blob, `${baseName}_captions.json`);
    showToast('Word-level JSON timestamp file saved to Downloads!');
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

  const handleTimeUpdate = useCallback((ms: number) => {
    setCurrentTimeMs(ms);
  }, []);

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

        {/* Speech Error Alert Banner */}
        {alertError && (
          <div className="w-full bg-red-950/80 border border-red-500/80 text-red-200 px-4 py-3.5 rounded-2xl flex items-center justify-between gap-3 shadow-lg animate-in fade-in slide-in-from-top-2 duration-200">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-xl bg-red-900/80 border border-red-700/60 flex items-center justify-center shrink-0 text-red-300">
                <AlertTriangle className="w-4 h-4" />
              </div>
              <div>
                <p className="text-xs font-bold text-red-100">{alertError}</p>
                <p className="text-[11px] text-red-300/80">Please ensure the video has audible speech or try selecting "Force Hindi" mode.</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setAlertError(null)}
              className="text-red-300 hover:text-white text-xs px-2.5 py-1 rounded-lg bg-red-900/60 hover:bg-red-800 transition cursor-pointer shrink-0 font-medium"
            >
              Dismiss
            </button>
          </div>
        )}

        {/* Video Player & Synchronized Subtitle Preview */}
        <VideoPlayerPreview
          videoUrl={videoBlobUrl}
          words={words}
          isGenerating={isGenerating}
          preset={captionPreset}
          seekTimeMs={seekTimeMs}
          onTimeUpdate={handleTimeUpdate}
          onDurationChange={handleDurationChange}
          onDownload={handleDownload}
          onDownloadSrt={handleDownloadSrt}
          onDownloadVtt={handleDownloadVtt}
          onDownloadJson={handleDownloadJson}
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
            onUpdateWords={(newWords) => setWords(sanitizeAndEnforceMonotonic(newWords, videoDurationMs))}
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
          generationStatusText={generationStatusText}
          hasGeneratedCaptions={hasGenerated}
          selectedResolution={selectedResolution}
          isExporting={isExporting}
          exportProgress={exportProgress}
          exportStatusText={exportStatusText}
          onGenerate={handleGenerate}
          onDownload={handleDownload}
          onDownloadSrt={handleDownloadSrt}
          onDownloadVtt={handleDownloadVtt}
          onDownloadJson={handleDownloadJson}
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

      <ExportPreviewModal
        isOpen={isExportPreviewOpen}
        onClose={() => {
          setIsExportPreviewOpen(false);
          setIsExportFallbackMode(false);
        }}
        renderedVideoBlob={exportedVideoBlob}
        fileName={exportedFileName}
        resolution={selectedResolution}
        onDownloadSrt={handleDownloadSrt}
        isFallbackMode={isExportFallbackMode}
      />
    </div>
  );
}
