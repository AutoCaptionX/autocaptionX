import type { CaptionWord, CaptionPreset, VideoResolution } from '../types';
import {
  generateSRT,
  generateWebVTT,
  buildContinuousCaptionPhrases,
  findActivePhraseIndex,
} from '../utils/captionConverters';
import { sanitizeAndEnforceMonotonic } from '../utils/audioExtractor';
import { renderSubtitlesOnCanvas, disposeSubtitleRenderer } from '../utils/subtitleCanvasRenderer';

export interface RenderProgressCallback {
  (percentage: number, statusText: string): void;
}

// Generate SubRip (.srt) subtitles file with precision millisecond alignment and duration extension
export function generateSrtContent(words: CaptionWord[], videoDurationMs?: number): string {
  return generateSRT(words, videoDurationMs);
}

// Helper to determine exact finite duration of any video blob or source
async function getAccurateVideoDuration(video: HTMLVideoElement): Promise<number> {
  if (video.duration && !isNaN(video.duration) && video.duration !== Infinity && video.duration > 0.1) {
    return video.duration;
  }

  return new Promise<number>((resolve) => {
    const handleSeeked = () => {
      video.removeEventListener('seeked', handleSeeked);
      const accurateDur = video.duration && !isNaN(video.duration) && video.duration !== Infinity
        ? video.duration
        : video.currentTime > 0
        ? video.currentTime
        : 10;
      video.currentTime = 0;
      resolve(accurateDur);
    };

    video.addEventListener('seeked', handleSeeked, { once: true });
    // Seek to a large number to force browser to calculate true duration for webm/mp4 blobs
    video.currentTime = 1e6;
  });
}

// Export 100% Full-Length Burned-In Captioned Video
export async function renderCaptionedVideo(
  videoSourceUrl: string,
  words: CaptionWord[],
  preset: CaptionPreset = 'hormozi',
  resolution: VideoResolution = '1080p',
  onProgress?: RenderProgressCallback
): Promise<Blob> {
  return new Promise(async (resolve, reject) => {
    // Sandbox container to keep media pipeline active & unthrottled in browser
    let sandboxContainer: HTMLDivElement | null = null;
    let animId: number | null = null;
    let checkIntervalId: any = null;
    let audioCtx: AudioContext | null = null;

    let videoEl: HTMLVideoElement | null = null;

    const cleanup = () => {
      if (animId) cancelAnimationFrame(animId);
      disposeSubtitleRenderer();
      if (videoEl) {
        videoEl.ontimeupdate = null;
        videoEl.onended = null;
        videoEl.onerror = null;
        try {
          videoEl.pause();
          videoEl.removeAttribute('src');
          videoEl.load();
        } catch (e) {}
      }
      if (audioCtx && audioCtx.state !== 'closed') {
        try {
          audioCtx.close();
        } catch (e) {}
      }
      if (sandboxContainer && sandboxContainer.parentNode) {
        sandboxContainer.parentNode.removeChild(sandboxContainer);
      }
    };

    try {
      onProgress?.(5, 'Initializing high-fidelity render engine...');

      sandboxContainer = document.createElement('div');
      sandboxContainer.style.position = 'fixed';
      sandboxContainer.style.top = '-9999px';
      sandboxContainer.style.left = '-9999px';
      sandboxContainer.style.opacity = '0';
      sandboxContainer.style.pointerEvents = 'none';
      sandboxContainer.style.zIndex = '-9999';
      document.body.appendChild(sandboxContainer);

      // 1. Create video element in sandbox
      const video = document.createElement('video');
      videoEl = video;
      video.src = videoSourceUrl;
      video.crossOrigin = 'anonymous';
      video.playsInline = true;
      video.muted = false;
      video.preload = 'auto';
      sandboxContainer.appendChild(video);

      await new Promise<void>((res, rej) => {
        const onLoaded = () => {
          video.removeEventListener('loadedmetadata', onLoaded);
          res();
        };
        video.addEventListener('loadedmetadata', onLoaded);
        video.onerror = () => rej(new Error('Unable to read video stream for rendering'));
        if (video.readyState >= 1) res();
      });

      // Calculate 100% accurate video duration
      const totalVideoDuration = await getAccurateVideoDuration(video);

      // Target Dimensions based on aspect ratio
      const origWidth = video.videoWidth || 1080;
      const origHeight = video.videoHeight || 1920;
      const isPortrait = origHeight > origWidth;

      let targetWidth = 1080;
      let targetHeight = 1920;

      if (resolution === '720p') {
        targetWidth = isPortrait ? 720 : 1280;
        targetHeight = isPortrait ? 1280 : 720;
      } else if (resolution === '1080p') {
        targetWidth = isPortrait ? 1080 : 1920;
        targetHeight = isPortrait ? 1920 : 1080;
      } else if (resolution === '4k') {
        targetWidth = isPortrait ? 2160 : 3840;
        targetHeight = isPortrait ? 3840 : 2160;
      }

      const canvas = document.createElement('canvas');
      canvas.width = targetWidth;
      canvas.height = targetHeight;
      sandboxContainer.appendChild(canvas);

      const ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: false });
      if (!ctx) {
        throw new Error('Canvas 2D context is not available');
      }

      onProgress?.(12, 'Synthesizing subtitle layers...');

      // 2. Setup audio routing
      const stream = canvas.captureStream(30);

      try {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          audioCtx = new AudioContextClass();
          const sourceNode = audioCtx.createMediaElementSource(video);
          const destNode = audioCtx.createMediaStreamDestination();
          sourceNode.connect(destNode);
          const audioTracks = destNode.stream.getAudioTracks();
          if (audioTracks.length > 0) {
            stream.addTrack(audioTracks[0]);
          }
        }
      } catch (audioErr) {
        console.warn('Audio node capture notice:', audioErr);
        try {
          const directCapture = (video as any).captureStream ? (video as any).captureStream() : null;
          if (directCapture && directCapture.getAudioTracks().length > 0) {
            stream.addTrack(directCapture.getAudioTracks()[0]);
          }
        } catch (e) {}
      }

      // 3. AUTO-FILL SILENCE GAPS & HOLD CAPTIONS UNTIL VIDEO END:
      // Modify word end times so effective endTime = startTime of next word,
      // and last word endTime = video.duration
      const totalDurationMs = Math.round(totalVideoDuration * 1000);
      const synchronizedWords = sanitizeAndEnforceMonotonic(words, totalDurationMs);
      const phrases = buildContinuousCaptionPhrases(synchronizedWords, totalDurationMs);

      // 4. Setup MediaRecorder with best supported lightweight mobile mimeType (video/mp4 or video/webm;codecs=vp9,opus)
      const mimeTypes = [
        'video/mp4',
        'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
        'video/mp4;codecs=avc1,mp4a.40.2',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
      ];
      let selectedMimeType = '';
      for (const t of mimeTypes) {
        if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) {
          selectedMimeType = t;
          break;
        }
      }

      let recorder: MediaRecorder;
      try {
        recorder = new MediaRecorder(stream, {
          mimeType: selectedMimeType || undefined,
          videoBitsPerSecond: resolution === '4k' ? 7000000 : resolution === '1080p' ? 3500000 : 2000000,
        });
      } catch (recInitErr) {
        console.warn('Initial MediaRecorder config failed, using basic fallback recorder:', recInitErr);
        recorder = new MediaRecorder(stream);
      }

      const recordedChunks: Blob[] = [];
      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          recordedChunks.push(e.data);
        }
      };

      let isCompleted = false;

      const finishExport = () => {
        if (isCompleted) return;
        isCompleted = true;
        cleanup();

        try {
          if (recorder.state === 'recording') {
            recorder.requestData();
            recorder.stop();
          }
        } catch (e) {}
      };

      recorder.onstop = () => {
        const actualMime = selectedMimeType || recorder.mimeType || 'video/webm;codecs=vp9,opus';
        const isMp4 = actualMime.toLowerCase().includes('mp4');
        const containerType = isMp4 ? 'video/mp4' : 'video/webm;codecs=vp9,opus';

        // Preserve legitimate container MIME type to prevent Android Chrome media scanner parser errors
        const finalBlob = new Blob(recordedChunks, {
          type: containerType,
        });
        // Immediately free intermediate chunk references from memory on long videos
        recordedChunks.length = 0;
        onProgress?.(100, 'Captioned video ready!');
        resolve(finalBlob);
      };

      recorder.onerror = (recErr) => {
        cleanup();
        reject(recErr);
      };

      // 5. Frame-Rate Throttled High-Precision Render Loop
      const targetFps = 30;
      const frameIntervalMs = 1000 / targetFps; // ~33.33ms per frame
      let lastDrawTimestamp = 0;
      let isDrawing = false;

      const renderCurrentFrame = () => {
        // Check if video has reached its real complete end
        if (video.ended || (video.currentTime >= totalVideoDuration - 0.05 && video.currentTime > 0.5)) {
          ctx.drawImage(video, 0, 0, targetWidth, targetHeight);
          const curMs = Math.round(video.currentTime * 1000);
          const pIdx = findActivePhraseIndex(phrases, curMs);
          if (pIdx !== -1) {
            renderSubtitlesOnCanvas({
              ctx,
              phrase: phrases[pIdx],
              curMs,
              preset,
              width: targetWidth,
              height: targetHeight,
            });
          }

          onProgress?.(99, 'Finalizing video stream...');
          setTimeout(finishExport, 200);
          return true;
        }

        // Draw current video frame to canvas
        ctx.drawImage(video, 0, 0, targetWidth, targetHeight);

        // Find active subtitle with binary search and burn it onto canvas using optimized offscreen cache
        const curMs = Math.round(video.currentTime * 1000);
        const pIdx = findActivePhraseIndex(phrases, curMs);
        if (pIdx !== -1) {
          renderSubtitlesOnCanvas({
            ctx,
            phrase: phrases[pIdx],
            curMs,
            preset,
            width: targetWidth,
            height: targetHeight,
          });
        }

        const pct = Math.min(98, Math.round((video.currentTime / Math.max(1, totalVideoDuration)) * 85) + 12);
        onProgress?.(pct, `Burning captions into video... (${Math.round(video.currentTime)}s / ${Math.round(totalVideoDuration)}s)`);
        return false;
      };

      // Constant FPS rendering loop locked directly to video.currentTime
      let lastRecordedVideoTime = -1;
      const drawFrame = () => {
        if (isCompleted) return;

        if (!isDrawing) {
          isDrawing = true;
          try {
            const vTime = video.currentTime;
            // Record frame directly matching video player progression
            if (vTime !== lastRecordedVideoTime || !video.paused) {
              lastRecordedVideoTime = vTime;
              const reachedEnd = renderCurrentFrame();
              if (reachedEnd) return;
            }
          } finally {
            isDrawing = false;
          }
        }

        if (!isCompleted) {
          animId = requestAnimationFrame(drawFrame);
        }
      };

      // Start recording with 500ms timeslice to prevent chunk array bloat on long videos
      recorder.start(500);
      video.currentTime = 0;

      video.onended = () => {
        setTimeout(finishExport, 150);
      };

      // Non-blocking completion listener on video timeupdate
      video.ontimeupdate = () => {
        if (isCompleted) return;
        if (video.ended || (video.currentTime >= totalVideoDuration - 0.05 && video.currentTime > 0.5)) {
          finishExport();
        }
      };

      await video.play();
      animId = requestAnimationFrame(drawFrame);

    } catch (err) {
      cleanup();
      reject(err);
    }
  });
}

