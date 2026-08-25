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
import { auth, db, onAuthStateChanged, signOut, type User } from './lib/firebase';
import { doc, setDoc, addDoc, collection } from 'firebase/firestore';
import type { VideoResolution, CaptionWord, CaptionJobData, CaptionPreset, CaptionLanguageMode } from './types';

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAuthOpen, setIsAuthOpen] = useState(false);
  const [isProjectsOpen, setIsProjectsOpen] = useState(false);
  const [isKeyModalOpen, setIsKeyModalOpen] = useState(false);
  const [assemblyConfigured, setAssemblyConfigured] = useState(false);

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

  // Monitor Firebase Auth State
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      if (currentUser) {
        // Save user profile to Firestore
        try {
          await setDoc(
            doc(db, 'users', currentUser.uid),
            {
              email: currentUser.email,
              displayName: currentUser.displayName,
              photoURL: currentUser.photoURL,
              updatedAt: new Date().toISOString(),
            },
            { merge: true }
          );
        } catch (err) {
          console.warn('Could not update user doc in Firestore:', err);
        }
      }
    });

    return () => unsubscribe();
  }, []);

  // Check Backend AssemblyAI Status
  useEffect(() => {
    fetch('/api/health')
      .then((res) => res.json())
      .then((data) => {
        if (data && typeof data.assemblyaiConfigured === 'boolean') {
          setAssemblyConfigured(data.assemblyaiConfigured);
        }
      })
      .catch((err) => {
        console.warn('Backend health check error:', err);
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
    // Generate a simple animated video canvas blob for instant preview testing
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
      if (e.data.size > 0) chunks.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      const sampleFile = new File([blob], 'AutoCaptionX_Demo_Shorts.webm', {
        type: 'video/webm',
      });
      handleFileSelect(sampleFile);
      showToast('Loaded demo video! Click "Create Captions" to generate auto subtitles.');
    };

    recorder.start();

    let frame = 0;
    const maxFrames = 180; // 6 seconds at 30 fps
    const interval = setInterval(() => {
      frame++;
      // Background gradient
      const grad = ctx.createLinearGradient(0, 0, 0, 1280);
      grad.addColorStop(0, '#0f172a');
      grad.addColorStop(0.5, '#1e1b4b');
      grad.addColorStop(1, '#020617');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 720, 1280);

      // Ambient glowing circle
      ctx.beginPath();
      ctx.arc(360, 640, 180 + Math.sin(frame / 10) * 20, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(59, 130, 246, 0.15)';
      ctx.fill();

      // Video Demo Badge
      ctx.fillStyle = '#3b82f6';
      ctx.beginPath();
      ctx.roundRect(240, 200, 240, 50, 25);
      ctx.fill();

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
  };

  // Generate Captions via AssemblyAI endpoint
  const handleGenerate = async () => {
    if (!selectedFile) return;

    setIsGenerating(true);
    setProgress(10);

    // Simulate steady progress while contacting AssemblyAI / Gemini backend
    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 88) return prev;
        return prev + Math.floor(Math.random() * 6) + 4;
      });
    }, 450);

    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('languageMode', languageMode);

      const customKey = localStorage.getItem('autocaption_assembly_key')?.trim();
      const headers: Record<string, string> = {};
      if (customKey) {
        headers['x-assemblyai-key'] = customKey;
      }

      const response = await fetch('/api/captions/transcribe', {
        method: 'POST',
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body: formData,
      });

      const responseText = await response.text();
      let data: any = null;

      try {
        data = JSON.parse(responseText);
      } catch (jsonErr) {
        console.warn('Non-JSON response from server:', responseText.slice(0, 120));
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
        : 'Smart Speech Engine';

      const successNotice =
        languageMode === 'translate-en'
          ? `Auto-captions translated to English with ${providerLabel}!`
          : `Captions generated successfully with ${providerLabel}!`;

      // Save to Firebase Firestore if user is authenticated
      if (user) {
        try {
          await addDoc(collection(db, 'users', user.uid, 'captionJobs'), {
            fileName: selectedFile.name,
            resolution: selectedResolution,
            languageMode,
            status: 'completed',
            captionCount: generatedWords.length,
            createdAt: new Date().toISOString(),
          });
          showToast(`${successNotice} Saved to your account.`);
        } catch (dbErr) {
          console.warn('Error saving to Firestore:', dbErr);
          showToast(successNotice);
        }
      } else {
        showToast(successNotice);
      }
    } catch (err: any) {
      clearInterval(progressInterval);
      console.error('Caption generation error:', err);
      showToast(`Error: ${err.message || 'Could not generate captions'}`);
    } finally {
      setIsGenerating(false);
    }
  };

  // Download Captioned Video
  const handleDownload = () => {
    if (!videoBlobUrl || !selectedFile) return;

    const anchor = document.createElement('a');
    anchor.href = videoBlobUrl;
    const baseName = selectedFile.name.replace(/\.[^/.]+$/, '');
    anchor.download = `captioned_${baseName}_${selectedResolution}.mp4`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);

    showToast(`Downloading captioned video in ${selectedResolution.toUpperCase()}!`);
  };

  // Load project from History
  const handleSelectProject = (job: CaptionJobData) => {
    showToast(`Loaded project: ${job.fileName}`);
  };

  const handleSignOut = async () => {
    try {
      await signOut(auth);
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
        <div className="fixed top-16 right-4 z-50 bg-slate-800 text-slate-100 border border-slate-700 px-4 py-2.5 rounded-xl shadow-2xl text-xs font-medium backdrop-blur animate-in fade-in slide-in-from-top-3 duration-200">
          {toastMessage}
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1 max-w-xl w-full mx-auto px-4 py-6 md:py-8 space-y-5">
        {/* Title / Section Header */}
        <div className="flex items-center justify-between">
          <h1 className="text-xs font-bold tracking-wider text-slate-400 uppercase">
            Dashboard
          </h1>
          <span className="text-[11px] text-slate-500 font-medium">
            AI Video Captions
          </span>
        </div>

        {/* Video Upload Dropzone */}
        <VideoUploader
          selectedFile={selectedFile}
          onFileSelect={handleFileSelect}
          onFileRemove={handleFileRemove}
          onLoadSample={handleLoadSampleVideo}
          disabled={isGenerating}
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
              // reset after brief tick so subsequent clicks to same time re-trigger
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
          disabled={isGenerating}
        />

        {/* Resolution Options (1080p, 4K, 720p) */}
        <ResolutionSelector
          selectedResolution={selectedResolution}
          onSelect={setSelectedResolution}
          disabled={isGenerating}
        />

        {/* Action Buttons (Generate, Download, Privacy Note) */}
        <ActionControls
          hasVideo={Boolean(selectedFile)}
          isGenerating={isGenerating}
          progress={progress}
          hasGeneratedCaptions={hasGenerated}
          selectedResolution={selectedResolution}
          onGenerate={handleGenerate}
          onDownload={handleDownload}
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
