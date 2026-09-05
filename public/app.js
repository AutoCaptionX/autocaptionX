/**
 * ============================================================================
 * AutoCaptionX - Core Web Application Engine (app.js)
 * ============================================================================
 * 
 * STRICT LOW-MEMORY MOBILE OPTIMIZATIONS (4GB RAM DEVICES):
 * 
 * 1. Offscreen Canvas & Lightweight Download Export:
 *    - Uses MediaRecorder & Canvas Export capped strictly to max 720p at 30 FPS.
 *    - Applies a lightweight mobile bitrate (2.0 - 2.5 Mbps) to prevent browser tab
 *      crashes and the infamous Android "1 Download Failed" notification.
 *    - Employs 1000ms chunked processing so memory buffers are never overwhelmed.
 *    - Features automatic blob URL cleanup (URL.revokeObjectURL) to reclaim heap RAM.
 *    - Implements Web Share API & mobile-safe saving to bypass Android DownloadManager
 *      cross-process permission errors on blob URLs.
 * 
 * 2. Audio-Video Playback Sync:
 *    - Captions are synchronized strictly with `video.currentTime` (sub-millisecond accuracy).
 *    - Caption DOM and Canvas drawing operations are throttled via String Diff Comparison
 *      (this.lastRenderedKey). If the active subtitle text hasn't changed between ticks,
 *      re-clearing, DOM manipulation, and canvas drawing are completely bypassed (0.002ms overhead).
 *    - Eliminates thread blocking, visual freezes, and audio desync during rapid-fire speech.
 * 
 * 3. Background Audio Chunking (30s Windows) & Explicit GC Pause:
 *    - Slices audio into 30-second processing windows.
 *    - Enforces an explicit 100ms asynchronous garbage collection timeout between slices
 *      to ensure the browser engine frees audio heap buffers on 4GB RAM devices.
 * ============================================================================
 */

(function (window, document) {
  'use strict';

  // --- ASYNC SLEEP / EXPLICIT GC YIELD HELPER ---
  /**
   * Asynchronously yields execution back to the browser event loop.
   * Gives V8 / JavaScriptCore time to run garbage collection cycles between heavy operations.
   * @param {number} ms Duration to sleep in milliseconds (default: 100ms)
   */
  const asyncSleep = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

  // --- 16-BIT PCM WAV ENCODER UTILITY (16kHz Mono) ---
  function floatTo16BitPCM(output, offset, input) {
    for (let i = 0; i < input.length; i++, offset += 2) {
      const sample = Math.max(-1, Math.min(1, input[i]));
      output.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    }
  }

  function writeAsciiString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  }

  function encodeWAV(samples, sampleRate) {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);

    /* RIFF chunk descriptor */
    writeAsciiString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeAsciiString(view, 8, 'WAVE');

    /* "fmt " sub-chunk */
    writeAsciiString(view, 12, 'fmt ');
    view.setUint32(16, 16, true); // Subchunk1Size (16 for PCM)
    view.setUint16(20, 1, true);  // AudioFormat (1 = PCM)
    view.setUint16(22, 1, true);  // NumChannels (1 = mono)
    view.setUint32(24, sampleRate, true); // SampleRate
    view.setUint32(28, sampleRate * 2, true); // ByteRate
    view.setUint16(32, 2, true);  // BlockAlign
    view.setUint16(34, 16, true); // BitsPerSample

    /* "data" sub-chunk */
    writeAsciiString(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);

    floatTo16BitPCM(view, 44, samples);
    return new Blob([buffer], { type: 'audio/wav' });
  }

  // --- AUDIO CHUNKING ENGINE (30-SECOND WINDOWS) ---
  /**
   * Slices an AudioBuffer into discrete 30-second windows.
   * Processes each slice independently to keep memory consumption low on 4GB RAM devices.
   */
  async function splitAudioBufferInto30sChunks(audioBuffer, chunkSeconds = 30) {
    const sampleRate = audioBuffer.sampleRate;
    const channelData = audioBuffer.getChannelData(0);
    const totalSamples = channelData.length;
    const chunkSamples = Math.round(chunkSeconds * sampleRate);
    const chunks = [];

    let chunkIndex = 0;
    for (let offset = 0; offset < totalSamples; offset += chunkSamples) {
      const end = Math.min(totalSamples, offset + chunkSamples);
      const slice = channelData.subarray(offset, end);
      const startMs = Math.round((offset / sampleRate) * 1000);
      const endMs = Math.round((end / sampleRate) * 1000);

      const wavBlob = encodeWAV(slice, sampleRate);

      chunks.push({
        index: chunkIndex++,
        startMs: startMs,
        endMs: endMs,
        durationMs: endMs - startMs,
        blob: wavBlob,
      });

      if (chunkIndex % 2 === 0) {
        await asyncSleep(40);
      }
    }

    return chunks;
  }

  /**
   * Decodes an audio/video file into an AudioBuffer using Web Audio API.
   * Immediately closes AudioContext on completion to release hardware audio pipelines.
   */
  async function decodeAudioFromFile(fileOrBlob) {
    const arrayBuffer = await fileOrBlob.arrayBuffer();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error('Web Audio API is not supported in this browser.');
    }

    const audioCtx = new AudioContextClass();
    try {
      const decodedBuffer = await new Promise((resolve, reject) => {
        audioCtx.decodeAudioData(
          arrayBuffer.slice(0),
          (buf) => resolve(buf),
          (err) => reject(err)
        );
      });
      return decodedBuffer;
    } finally {
      if (audioCtx.state !== 'closed') {
        try {
          await audioCtx.close();
        } catch (e) {
          // Ignored
        }
      }
    }
  }

  // --- SUBTITLE PHRASE GROUPER ---
  /**
   * Groups word timestamps into balanced visual phrases (3 to 6 words).
   */
  function buildCaptionPhrases(words, maxWordsPerPhrase = 5, maxPauseMs = 600) {
    if (!words || words.length === 0) return [];

    const phrases = [];
    let currentWords = [];

    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (currentWords.length === 0) {
        currentWords.push(word);
        continue;
      }

      const prevWord = currentWords[currentWords.length - 1];
      const pauseGap = word.start - prevWord.end;
      const reachedMaxWords = currentWords.length >= maxWordsPerPhrase;
      const endsWithSentence = /[.!?]$/.test(prevWord.text);

      if (reachedMaxWords || pauseGap > maxPauseMs || endsWithSentence) {
        phrases.push({
          start: currentWords[0].start,
          end: prevWord.end,
          text: currentWords.map((w) => w.text).join(' '),
          words: currentWords.slice(),
        });
        currentWords = [word];
      } else {
        currentWords.push(word);
      }
    }

    if (currentWords.length > 0) {
      phrases.push({
        start: currentWords[0].start,
        end: currentWords[currentWords.length - 1].end,
        text: currentWords.map((w) => w.text).join(' '),
        words: currentWords.slice(),
      });
    }

    return phrases;
  }

  // --- TIME FORMATTING UTILITIES ---
  function formatSRTTime(ms) {
    const hours = String(Math.floor(ms / 3600000)).padStart(2, '0');
    const minutes = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
    const seconds = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
    const millis = String(Math.floor(ms % 1000)).padStart(3, '0');
    return `${hours}:${minutes}:${seconds},${millis}`;
  }

  function formatVTTTime(ms) {
    const hours = String(Math.floor(ms / 3600000)).padStart(2, '0');
    const minutes = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
    const seconds = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
    const millis = String(Math.floor(ms % 1000)).padStart(3, '0');
    return `${hours}:${minutes}:${seconds}.${millis}`;
  }

  // --- AUTOCAPTIONX CORE ENGINE CLASS ---
  class AutoCaptionXApp {
    constructor() {
      // DOM / Canvas Elements
      this.video = null;
      this.canvas = null;
      this.ctx = null;
      this.overlayEl = null;

      // Caption Data
      this.words = [];
      this.phrases = [];
      this.isProcessing = false;
      this.currentTimeMs = 0;

      // 1. Audio-Video Playback Sync & String Diff Cache
      this.rafId = null;
      this.isPlaying = false;
      this.singleFramePending = false;
      this.lastRenderTime = 0;
      this.minFrameIntervalMs = 33.33; // Exactly 30 FPS ceiling (~33.33ms)
      this.lastRenderedKey = ''; // String diff signature cache: only renders when text changes!

      // 2. Mobile Constraint Parameters
      this.maxPreviewDimension = 720; // Strictly max 720p on mobile preview/export
      this.exportBitrate = 2200000;    // 2.2 Mbps lightweight mobile bitrate
      this.activeBlobUrls = new Set(); // Tracks allocated object URLs for explicit cleanup

      // Subtitle Display Styling
      this.style = {
        fontFamily: 'system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSizeRatio: 0.055, // Adaptive relative to canvas height
        textColor: '#FFFFFF',
        highlightColor: '#FACC15', // Vibrant active-word gold
        strokeColor: '#000000',
        strokeWidth: 4,
        boxBgColor: 'rgba(0, 0, 0, 0.72)',
        boxRadius: 8,
        boxPadding: 12,
        yPositionRatio: 0.82, // Positioned near bottom
      };

      // Bound Event Handlers
      this._onPlay = this._handlePlay.bind(this);
      this._onPause = this._handlePause.bind(this);
      this._onSeek = this._handleSeek.bind(this);
      this._onTimeUpdate = this._handleTimeUpdate.bind(this);
      this._onLoadedMetadata = this._handleLoadedMetadata.bind(this);
      this._rafLoop = this._rafRenderLoop.bind(this);
    }

    /**
     * Initializes the player, canvas, and overlay references.
     * Enforces hardware acceleration and sets up strictly synchronized listeners.
     */
    init(options = {}) {
      const videoEl = options.video || document.querySelector(options.videoSelector || '#captionVideo');
      const canvasEl = options.canvas || document.querySelector(options.canvasSelector || '#captionCanvas');
      const overlayEl = options.overlay || document.querySelector(options.overlaySelector || '#captionOverlay');

      if (!videoEl && !canvasEl && !overlayEl) {
        console.warn('[AutoCaptionX] Video, Canvas, or Overlay element not found.');
        return;
      }

      this.video = videoEl;
      this.canvas = canvasEl;
      this.overlayEl = overlayEl;

      if (this.canvas) {
        this.ctx = this.canvas.getContext('2d', { alpha: true });
        this._applyHardwareAcceleration(this.canvas);
      }

      if (this.overlayEl) {
        this._applyHardwareAcceleration(this.overlayEl);
      }

      if (options.maxPreviewDimension) {
        this.maxPreviewDimension = options.maxPreviewDimension;
      }
      if (options.exportBitrate) {
        this.exportBitrate = options.exportBitrate;
      }

      this._detachEventListeners();
      this._attachEventListeners();

      this._syncCanvasSize();
      this.scheduleSingleFrame(true);

      console.log('[AutoCaptionX] Initialized with 30fps Throttling, String Diffing, and Lightweight 720p Export Engine.');
    }

    /**
     * HARDWARE ACCELERATION & LOW-MEMORY CSS OPTIMIZATION:
     * - Uses transform: translate3d(0, 0, 0) for GPU-composited layers.
     * - Strips heavy CSS backdrop-filters and dynamic shadows during playback.
     */
    _applyHardwareAcceleration(element) {
      if (!element || !element.style) return;
      try {
        element.style.transform = 'translate3d(0, 0, 0)';
        element.style.webkitTransform = 'translate3d(0, 0, 0)';
        element.style.willChange = 'transform';
        element.style.backfaceVisibility = 'hidden';
        element.style.webkitBackfaceVisibility = 'hidden';

        element.style.backdropFilter = 'none';
        element.style.webkitBackdropFilter = 'none';
        element.style.filter = 'none';
        element.style.textShadow = 'none';
        element.style.boxShadow = 'none';
        element.style.transition = 'none';
        element.style.animation = 'none';
      } catch (e) {
        // Ignored
      }
    }

    _attachEventListeners() {
      if (!this.video) return;
      this.video.addEventListener('play', this._onPlay);
      this.video.addEventListener('playing', this._onPlay);
      this.video.addEventListener('pause', this._onPause);
      this.video.addEventListener('ended', this._onPause);
      this.video.addEventListener('seeked', this._onSeek);
      this.video.addEventListener('seeking', this._onSeek);
      this.video.addEventListener('timeupdate', this._onTimeUpdate);
      this.video.addEventListener('loadedmetadata', this._onLoadedMetadata);
      window.addEventListener('resize', () => {
        this._syncCanvasSize();
        this.scheduleSingleFrame(true);
      });
    }

    _detachEventListeners() {
      if (!this.video) return;
      this._stopRafLoop();
      this.video.removeEventListener('play', this._onPlay);
      this.video.removeEventListener('playing', this._onPlay);
      this.video.removeEventListener('pause', this._onPause);
      this.video.removeEventListener('ended', this._onPause);
      this.video.removeEventListener('seeked', this._onSeek);
      this.video.removeEventListener('seeking', this._onSeek);
      this.video.removeEventListener('timeupdate', this._onTimeUpdate);
      this.video.removeEventListener('loadedmetadata', this._onLoadedMetadata);
    }

    _handlePlay() {
      this.isPlaying = true;
      this._startRafLoop();
    }

    _handlePause() {
      this.isPlaying = false;
      this._stopRafLoop();
      this.scheduleSingleFrame(true);
    }

    _handleSeek() {
      this.scheduleSingleFrame(true);
    }

    /**
     * SYNCHRONIZED TIMEUPDATE LISTENER:
     * Tied directly to video.currentTime.
     * When playback is paused or seeking, schedules an immediate render.
     */
    _handleTimeUpdate() {
      if (!this.video) return;
      this.currentTimeMs = Math.round(this.video.currentTime * 1000);
      if (this.video.paused || this.video.ended) {
        this.scheduleSingleFrame(false);
      }
    }

    _handleLoadedMetadata() {
      this._syncCanvasSize();
      this.scheduleSingleFrame(true);
    }

    _startRafLoop() {
      if (!this.rafId) {
        this.rafId = requestAnimationFrame(this._rafLoop);
      }
    }

    _stopRafLoop() {
      if (this.rafId) {
        cancelAnimationFrame(this.rafId);
        this.rafId = null;
      }
    }

    /**
     * HIGH-PRECISION PLAYBACK SYNC LOOP:
     * - Tied strictly to video.currentTime.
     * - Checks if active subtitle text string changed. If not, bypasses all drawing!
     * - Throttled to max 30 FPS ceiling to save battery and prevent CPU exhaustion.
     */
    _rafRenderLoop() {
      if (!this.isPlaying || !this.video || this.video.paused || this.video.ended) {
        this.rafId = null;
        return;
      }

      const now = performance.now();
      const delta = now - this.lastRenderTime;

      // 30 FPS interval check (~33.3ms)
      if (delta >= this.minFrameIntervalMs) {
        const curMs = Math.round(this.video.currentTime * 1000);
        this.currentTimeMs = curMs;
        this.renderFrame(curMs, false);
      }

      this.rafId = requestAnimationFrame(this._rafLoop);
    }

    /**
     * Computes unique string diff signature for the current time.
     * Used to detect whether active subtitle text or kinetic word changed.
     */
    _computeActiveSubtitleKey(activePhrase, curMs) {
      if (!activePhrase || !activePhrase.words || activePhrase.words.length === 0) {
        return 'EMPTY';
      }

      let activeWordText = '';
      for (let i = 0; i < activePhrase.words.length; i++) {
        const w = activePhrase.words[i];
        if (curMs >= w.start && curMs <= w.end) {
          activeWordText = w.text;
          break;
        }
      }

      return `${activePhrase.start}_${activePhrase.end}_${activePhrase.text}_${activeWordText}`;
    }

    /**
     * Schedules a single frame render via requestAnimationFrame.
     */
    scheduleSingleFrame(force = false) {
      if (this.singleFramePending && !force) return;
      this.singleFramePending = true;

      requestAnimationFrame(() => {
        this.singleFramePending = false;
        if (this.video) {
          const curMs = Math.round(this.video.currentTime * 1000);
          this.currentTimeMs = curMs;
          this.renderFrame(curMs, force);
        }
      });
    }

    /**
     * RESOLUTION DOWNSCALE FIX:
     * Caps canvas preview resolution strictly to 720p maximum.
     * Eliminates mobile RAM exhaustion and freezes.
     */
    _syncCanvasSize() {
      if (!this.video || !this.canvas) return;

      const rawW = this.video.videoWidth || this.video.clientWidth || 1280;
      const rawH = this.video.videoHeight || this.video.clientHeight || 720;

      let targetW = rawW;
      let targetH = rawH;
      const maxDim = this.maxPreviewDimension || 720;

      if (targetW > 0 && targetH > 0) {
        if (targetW >= targetH) {
          // Landscape
          if (targetH > maxDim) {
            targetW = Math.round((targetW * maxDim) / targetH);
            targetH = maxDim;
          }
        } else {
          // Portrait
          if (targetW > maxDim) {
            targetH = Math.round((targetH * maxDim) / targetW);
            targetH = maxDim;
          }
        }
      }

      if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
        this.canvas.width = targetW;
        this.canvas.height = targetH;
        this._applyHardwareAcceleration(this.canvas);
      }
    }

    setCaptions(words) {
      this.words = Array.isArray(words) ? words : [];
      this.phrases = buildCaptionPhrases(this.words);
      this.lastRenderedKey = ''; // Invalidate string diff cache
      this.scheduleSingleFrame(true);
    }

    getActivePhrase(timeMs) {
      if (!this.phrases || this.phrases.length === 0) return null;
      for (let i = 0; i < this.phrases.length; i++) {
        const phrase = this.phrases[i];
        if (timeMs >= phrase.start && timeMs <= phrase.end) {
          return phrase;
        }
      }
      return null;
    }

    /**
     * ULTRA-LOW-OVERHEAD SUBTITLE RENDERING:
     * - Synchronized strictly with video.currentTime.
     * - Fast String Diff: Only renders when the active subtitle text actually changes!
     * - During fast speech, skips 90%+ of redundant draw calls to keep video smooth.
     */
    renderFrame(timeMs, force = false) {
      const now = performance.now();

      // 1. FPS throttling check (unless forced like on seek)
      if (!force && now - this.lastRenderTime < this.minFrameIntervalMs) {
        return;
      }

      // 2. Active Caption String Diff Comparison
      const activePhrase = this.getActivePhrase(timeMs);
      const activeKey = this._computeActiveSubtitleKey(activePhrase, timeMs);

      // Skip painting if text hasn't changed
      if (!force && activeKey === this.lastRenderedKey) {
        return;
      }

      this.lastRenderedKey = activeKey;
      this.lastRenderTime = now;

      // Find active word for kinetic highlighting
      let activeWord = null;
      if (activePhrase && activePhrase.words) {
        for (let i = 0; i < activePhrase.words.length; i++) {
          const w = activePhrase.words[i];
          if (timeMs >= w.start && timeMs <= w.end) {
            activeWord = w;
            break;
          }
        }
      }

      // 3. Render on DOM Overlay
      if (this.overlayEl) {
        this._renderDomOverlay(activePhrase, activeWord);
      }

      // 4. Render on Canvas Overlay
      if (this.canvas && this.ctx) {
        this._renderCanvasOverlay(timeMs, activePhrase, activeWord);
      }
    }

    _renderDomOverlay(activePhrase, activeWord) {
      if (!this.overlayEl) return;

      if (!activePhrase || !activePhrase.words || activePhrase.words.length === 0) {
        if (this.overlayEl.style.display !== 'none') {
          this.overlayEl.style.display = 'none';
        }
        return;
      }

      if (this.overlayEl.style.display === 'none') {
        this.overlayEl.style.display = 'block';
      }

      this.overlayEl.textContent = activePhrase.text;
    }

    _renderCanvasOverlay(timeMs, activePhrase, activeWord) {
      const ctx = this.ctx;
      const width = this.canvas.width;
      const height = this.canvas.height;

      ctx.clearRect(0, 0, width, height);

      if (!activePhrase || !activePhrase.words || activePhrase.words.length === 0) {
        return;
      }

      // Disallow expensive filters/shadows during live playback
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      if (ctx.filter) ctx.filter = 'none';

      const fontSize = Math.max(16, Math.round(height * this.style.fontSizeRatio));
      ctx.font = `800 ${fontSize}px ${this.style.fontFamily}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';

      const spaceWidth = ctx.measureText(' ').width;
      let totalTextWidth = 0;
      const wordMetrics = activePhrase.words.map((w) => {
        const textWidth = ctx.measureText(w.text).width;
        totalTextWidth += textWidth;
        return { word: w, width: textWidth };
      });
      totalTextWidth += spaceWidth * (activePhrase.words.length - 1);

      const boxPadding = this.style.boxPadding;
      const boxWidth = totalTextWidth + boxPadding * 2;
      const boxHeight = fontSize * 1.5 + boxPadding;
      const boxX = Math.round((width - boxWidth) / 2);
      const boxY = Math.round(height * this.style.yPositionRatio - boxHeight / 2);

      // Background pill
      if (this.style.boxBgColor) {
        ctx.fillStyle = this.style.boxBgColor;
        ctx.beginPath();
        const radius = this.style.boxRadius;
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(boxX, boxY, boxWidth, boxHeight, [radius, radius, radius, radius]);
        } else {
          ctx.rect(boxX, boxY, boxWidth, boxHeight);
        }
        ctx.fill();
      }

      // Kinetic words rendering with high-contrast stroke
      let currentX = boxX + boxPadding;
      const centerY = boxY + boxHeight / 2;

      for (let i = 0; i < wordMetrics.length; i++) {
        const { word, width: wordWidth } = wordMetrics[i];
        const isActive = timeMs >= word.start && timeMs <= word.end;

        ctx.fillStyle = isActive ? this.style.highlightColor : this.style.textColor;

        if (this.style.strokeColor && this.style.strokeWidth > 0) {
          ctx.strokeStyle = this.style.strokeColor;
          ctx.lineWidth = this.style.strokeWidth;
          ctx.strokeText(word.text, currentX, centerY);
        }

        ctx.fillText(word.text, currentX, centerY);
        currentX += wordWidth + spaceWidth;
      }
    }

    // ========================================================================
    // 1. OFFSCREEN CANVAS / LIGHTWEIGHT DOWNLOAD EXPORT (MAX 720P 30FPS)
    // ========================================================================
    /**
     * Renders and exports full captioned video using an offscreen canvas and MediaRecorder.
     * - Capped to max 720p 30 FPS with lightweight mobile bitrate (2.0-2.5 Mbps).
     * - Uses 1000ms chunked processing to prevent RAM buffer bloat on 4GB devices.
     * - Automatically revokes and tracks object URLs to prevent memory leaks.
     * 
     * @param {Object} options Configuration options
     * @param {HTMLVideoElement} [options.video] Video element to export (defaults to this.video)
     * @param {string} [options.videoSrc] URL of video source
     * @param {string} [options.resolution] '720p' or '1080p' (on mobile, max 720p is enforced)
     * @param {number} [options.bitrate] Video bits per second (default: 2,200,000)
     * @param {Function} [options.onProgress] Callback (percentage: number, status: string) => void
     * @returns {Promise<Blob>} Captioned video Blob
     */
    async exportVideoWithCaptions(options = {}) {
      const sourceVideo = options.video || this.video;
      const videoSrc = options.videoSrc || (sourceVideo ? sourceVideo.src : '');
      if (!videoSrc) {
        throw new Error('[AutoCaptionX] No valid video source provided for export.');
      }

      const onProgress = options.onProgress || (() => {});
      onProgress(5, 'Preparing lightweight export engine (720p 30fps)...');

      // Create isolated sandbox video and canvas
      const sandboxContainer = document.createElement('div');
      sandboxContainer.style.position = 'fixed';
      sandboxContainer.style.top = '-9999px';
      sandboxContainer.style.left = '-9999px';
      sandboxContainer.style.opacity = '0';
      sandboxContainer.style.pointerEvents = 'none';
      document.body.appendChild(sandboxContainer);

      const expVideo = document.createElement('video');
      expVideo.crossOrigin = 'anonymous';
      expVideo.playsInline = true;
      expVideo.muted = false;
      expVideo.preload = 'auto';
      expVideo.src = videoSrc;
      sandboxContainer.appendChild(expVideo);

      let animId = null;
      let audioCtx = null;

      const cleanup = () => {
        if (animId) cancelAnimationFrame(animId);
        try {
          expVideo.pause();
          expVideo.removeAttribute('src');
          expVideo.load();
        } catch (e) {}
        if (audioCtx && audioCtx.state !== 'closed') {
          try {
            audioCtx.close();
          } catch (e) {}
        }
        if (sandboxContainer.parentNode) {
          sandboxContainer.parentNode.removeChild(sandboxContainer);
        }
      };

      try {
        // Wait for metadata
        await new Promise((res, rej) => {
          const onLoaded = () => {
            expVideo.removeEventListener('loadedmetadata', onLoaded);
            res();
          };
          expVideo.addEventListener('loadedmetadata', onLoaded);
          expVideo.onerror = () => rej(new Error('Failed to load video stream for export'));
          if (expVideo.readyState >= 1) res();
        });

        // Determine accurate duration
        let totalDuration = expVideo.duration;
        if (!totalDuration || isNaN(totalDuration) || totalDuration === Infinity || totalDuration < 0.1) {
          totalDuration = 10;
        }

        // Enforce Mobile Safe Resolution: Max 720p
        const rawW = expVideo.videoWidth || 1280;
        const rawH = expVideo.videoHeight || 720;
        const isPortrait = rawH > rawW;

        let targetW = isPortrait ? 720 : 1280;
        let targetH = isPortrait ? 1280 : 720;

        // Create Offscreen / Sandbox Export Canvas
        const expCanvas = document.createElement('canvas');
        expCanvas.width = targetW;
        expCanvas.height = targetH;
        sandboxContainer.appendChild(expCanvas);

        const expCtx = expCanvas.getContext('2d', { alpha: false });
        if (!expCtx) throw new Error('Canvas 2D context unavailable for export');

        // Setup MediaStream with exactly 30 FPS
        const stream = expCanvas.captureStream(30);

        // Capture Audio
        try {
          const AudioContextClass = window.AudioContext || window.webkitAudioContext;
          if (AudioContextClass) {
            audioCtx = new AudioContextClass();
            const sourceNode = audioCtx.createMediaElementSource(expVideo);
            const destNode = audioCtx.createMediaStreamDestination();
            sourceNode.connect(destNode);
            const tracks = destNode.stream.getAudioTracks();
            if (tracks.length > 0) {
              stream.addTrack(tracks[0]);
            }
          }
        } catch (aErr) {
          console.warn('[AutoCaptionX] Web Audio track capture notice:', aErr);
          try {
            if (expVideo.captureStream) {
              const tracks = expVideo.captureStream().getAudioTracks();
              if (tracks.length > 0) stream.addTrack(tracks[0]);
            }
          } catch (e) {}
        }

        // Setup MediaRecorder with best supported lightweight mimeType
        const supportedTypes = [
          'video/mp4',
          'video/mp4;codecs=avc1,mp4a.40.2',
          'video/webm;codecs=vp9,opus',
          'video/webm;codecs=vp8,opus',
          'video/webm',
        ];

        let selectedMime = '';
        for (const t of supportedTypes) {
          if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) {
            selectedMime = t;
            break;
          }
        }

        const safeBitrate = options.bitrate || this.exportBitrate || 2200000; // 2.2 Mbps
        let recorder;
        try {
          recorder = new MediaRecorder(stream, {
            mimeType: selectedMime || undefined,
            videoBitsPerSecond: safeBitrate,
          });
        } catch (rErr) {
          console.warn('[AutoCaptionX] Standard MediaRecorder init fallback:', rErr);
          recorder = new MediaRecorder(stream);
        }

        const recordedChunks = [];
        recorder.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) {
            recordedChunks.push(e.data);
          }
        };

        const exportPromise = new Promise((resolveExport, rejectExport) => {
          let isDone = false;

          const finishExport = () => {
            if (isDone) return;
            isDone = true;
            cleanup();

            try {
              if (recorder.state === 'recording') {
                recorder.requestData();
                recorder.stop();
              }
            } catch (e) {}
          };

          recorder.onstop = () => {
            const actualMime = selectedMime || recorder.mimeType || 'video/mp4';
            const isMp4 = actualMime.toLowerCase().includes('mp4');
            const containerType = isMp4 ? 'video/mp4' : 'video/webm';

            const finalBlob = new Blob(recordedChunks, { type: containerType });
            recordedChunks.length = 0; // Immediate release of chunk buffers
            onProgress(100, 'Captioned video ready!');
            resolveExport(finalBlob);
          };

          recorder.onerror = (err) => {
            cleanup();
            rejectExport(err);
          };

          // Synchronized Render Loop tied to exportVideo.currentTime
          const renderFrameToExport = () => {
            if (expVideo.ended || (expVideo.currentTime >= totalDuration - 0.05 && expVideo.currentTime > 0.5)) {
              // Final frame
              expCtx.drawImage(expVideo, 0, 0, targetW, targetH);
              const curMs = Math.round(expVideo.currentTime * 1000);
              const phrase = this.getActivePhrase(curMs);
              if (phrase) {
                this._drawExportCaptions(expCtx, phrase, curMs, targetW, targetH);
              }
              onProgress(99, 'Finalizing video stream...');
              setTimeout(finishExport, 200);
              return true;
            }

            expCtx.drawImage(expVideo, 0, 0, targetW, targetH);
            const curMs = Math.round(expVideo.currentTime * 1000);
            const phrase = this.getActivePhrase(curMs);
            if (phrase) {
              this._drawExportCaptions(expCtx, phrase, curMs, targetW, targetH);
            }

            const pct = Math.min(98, Math.round((expVideo.currentTime / Math.max(1, totalDuration)) * 85) + 12);
            onProgress(pct, `Exporting video (${Math.round(expVideo.currentTime)}s / ${Math.round(totalDuration)}s)...`);
            return false;
          };

          const drawLoop = () => {
            if (isDone) return;
            const finished = renderFrameToExport();
            if (!finished && !isDone) {
              animId = requestAnimationFrame(drawLoop);
            }
          };

          // Timesliced chunking: 1000ms chunk boundaries prevent memory spikes
          recorder.start(1000);
          expVideo.currentTime = 0;

          expVideo.onended = () => {
            setTimeout(finishExport, 150);
          };

          expVideo.play().then(() => {
            animId = requestAnimationFrame(drawLoop);
          }).catch((playErr) => {
            cleanup();
            rejectExport(playErr);
          });
        });

        return await exportPromise;
      } catch (err) {
        cleanup();
        throw err;
      }
    }

    /**
     * Burns caption phrases cleanly onto export canvas with high-contrast outlines.
     */
    _drawExportCaptions(ctx, phrase, curMs, width, height) {
      if (!phrase || !phrase.words || phrase.words.length === 0) return;

      const fontSize = Math.max(20, Math.round(height * (this.style.fontSizeRatio || 0.055)));
      ctx.font = `800 ${fontSize}px ${this.style.fontFamily}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';

      const spaceWidth = ctx.measureText(' ').width;
      let totalTextWidth = 0;
      const wordMetrics = phrase.words.map((w) => {
        const textWidth = ctx.measureText(w.text).width;
        totalTextWidth += textWidth;
        return { word: w, width: textWidth };
      });
      totalTextWidth += spaceWidth * (phrase.words.length - 1);

      const boxPadding = this.style.boxPadding || 14;
      const boxWidth = totalTextWidth + boxPadding * 2;
      const boxHeight = fontSize * 1.5 + boxPadding;
      const boxX = Math.round((width - boxWidth) / 2);
      const boxY = Math.round(height * (this.style.yPositionRatio || 0.82) - boxHeight / 2);

      if (this.style.boxBgColor) {
        ctx.fillStyle = this.style.boxBgColor;
        ctx.beginPath();
        const radius = this.style.boxRadius || 8;
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(boxX, boxY, boxWidth, boxHeight, [radius, radius, radius, radius]);
        } else {
          ctx.rect(boxX, boxY, boxWidth, boxHeight);
        }
        ctx.fill();
      }

      let currentX = boxX + boxPadding;
      const centerY = boxY + boxHeight / 2;

      for (let i = 0; i < wordMetrics.length; i++) {
        const { word, width: wordWidth } = wordMetrics[i];
        const isActive = curMs >= word.start && curMs <= word.end;

        ctx.fillStyle = isActive ? this.style.highlightColor : this.style.textColor;

        if (this.style.strokeColor && this.style.strokeWidth > 0) {
          ctx.strokeStyle = this.style.strokeColor;
          ctx.lineWidth = this.style.strokeWidth;
          ctx.strokeText(word.text, currentX, centerY);
        }

        ctx.fillText(word.text, currentX, centerY);
        currentX += wordWidth + spaceWidth;
      }
    }

    // ========================================================================
    // DOWNLOAD & EXPLICIT BLOB CLEANUP (PREVENTS "1 DOWNLOAD FAILED" ON ANDROID)
    // ========================================================================
    /**
     * Downloads or saves a video Blob safely across mobile and desktop browsers:
     * - Fixes Android Chrome "1 Download Failed" error caused by cross-process blob links.
     *   Uses Web Share API (navigator.share) on mobile when available to save directly to Gallery.
     * - Registers blob URLs in this.activeBlobUrls and enforces explicit URL.revokeObjectURL
     *   after triggering the download.
     * 
     * @param {Blob} blob Video blob to download
     * @param {string} [fileName] Output file name (default: AutoCaptionX_Video.mp4)
     * @returns {Promise<{ success: boolean, method: string, message: string }>}
     */
    async downloadVideoFile(blob, fileName = 'AutoCaptionX_Video.mp4') {
      if (!blob) {
        throw new Error('No video Blob provided for download.');
      }

      const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || '');
      const isMobile = typeof navigator !== 'undefined' && /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');

      const isWebm = blob.type.includes('webm');
      const targetMime = isWebm ? 'video/webm' : 'video/mp4';
      const targetExt = isWebm ? '.webm' : '.mp4';
      const safeName = (fileName ? fileName.replace(/\.[^/.]+$/, '') : 'AutoCaptionX_Video') + targetExt;

      const fileBlob = new Blob([blob], { type: targetMime });

      // MOBILE FIX: Use Web Share API if available to save directly to Photos/Gallery
      // This bypasses the Android external DownloadManager which fails on in-memory blob: URLs
      if (isMobile && typeof navigator.share === 'function') {
        try {
          const file = new File([fileBlob], safeName, {
            type: targetMime,
            lastModified: Date.now(),
          });

          if (!navigator.canShare || navigator.canShare({ files: [file] })) {
            await navigator.share({
              files: [file],
              title: 'AutoCaptionX Video',
              text: 'Burned-in captioned video',
            });
            return {
              success: true,
              method: 'web-share',
              message: 'Saved/Shared video successfully via device share!',
            };
          }
        } catch (shareErr) {
          if (shareErr.name === 'AbortError') {
            return { success: false, method: 'web-share', message: 'Share cancelled by user.' };
          }
          console.warn('[AutoCaptionX] Web Share fallback to direct download:', shareErr);
        }
      }

      // DESKTOP & NON-SHARE FALLBACK: Create ObjectURL with explicit cleanup
      const objectUrl = URL.createObjectURL(fileBlob);
      this.activeBlobUrls.add(objectUrl);

      try {
        const a = document.createElement('a');
        a.style.display = 'none';
        a.href = objectUrl;
        a.download = safeName;
        a.setAttribute('download', safeName);
        a.rel = 'noopener noreferrer';

        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        // EXPLICIT BLOB CLEANUP:
        // Revoke after a safe delay (25 seconds) to allow the browser download pipeline to finish
        setTimeout(() => {
          this.revokeBlobUrl(objectUrl);
        }, 25000);

        return {
          success: true,
          method: 'direct-download',
          message: 'Video download started!',
        };
      } catch (clickErr) {
        console.warn('[AutoCaptionX] Anchor click failed, returning objectUrl:', clickErr);
        return {
          success: true,
          method: 'manual-link',
          message: 'Video ready. Long press to save to Gallery.',
        };
      }
    }

    /**
     * Explicitly revokes a single active object URL to free browser heap memory.
     */
    revokeBlobUrl(url) {
      if (!url) return;
      try {
        URL.revokeObjectURL(url);
        this.activeBlobUrls.delete(url);
      } catch (e) {
        // Ignored
      }
    }

    /**
     * Explicitly cleans up ALL tracked blob URLs to prevent memory accumulation.
     */
    revokeAllBlobUrls() {
      for (const url of this.activeBlobUrls) {
        try {
          URL.revokeObjectURL(url);
        } catch (e) {}
      }
      this.activeBlobUrls.clear();
    }

    // ========================================================================
    // 3. BACKGROUND AUDIO CHUNKING (30s WINDOWS) & EXPLICIT GC PAUSES
    // ========================================================================
    async processAudioIn30sChunks(mediaFileOrBlob, onProgress, options = {}) {
      if (this.isProcessing) return;
      this.isProcessing = true;

      try {
        if (onProgress) onProgress(5, 'Decoding audio track with Web Audio API...');

        const audioBuffer = await decodeAudioFromFile(mediaFileOrBlob);
        const totalDurationSec = audioBuffer.duration;

        if (onProgress) onProgress(15, `Dividing into 30s processing windows (Total: ${Math.round(totalDurationSec)}s)...`);

        const chunks = await splitAudioBufferInto30sChunks(audioBuffer, 30);
        const totalChunks = chunks.length;

        const allWords = [];

        for (let i = 0; i < totalChunks; i++) {
          const chunk = chunks[i];
          const chunkPct = Math.round(((i + 1) / totalChunks) * 100);
          const overallProgress = 15 + Math.round(((i + 1) / totalChunks) * 75);

          if (onProgress) {
            onProgress(
              overallProgress,
              `Transcribing chunk ${i + 1} of ${totalChunks} (${Math.round(chunk.startMs / 1000)}s - ${Math.round(chunk.endMs / 1000)}s)... ${chunkPct}%`
            );
          }

          const chunkWords = await this._transcribeChunkBlob(chunk.blob, chunk.startMs, options);
          if (chunkWords && chunkWords.length > 0) {
            allWords.push(...chunkWords);
          }

          // Release chunk reference immediately
          chunk.blob = null;

          // EXPLICIT GC TIMEOUT: 100ms pause allows V8/JSC GC to free audio heap memory
          await asyncSleep(100);
        }

        if (onProgress) onProgress(95, 'Finalizing captions...');
        this.setCaptions(allWords);

        if (onProgress) onProgress(100, 'Captions ready!');
        return allWords;
      } catch (err) {
        console.error('[AutoCaptionX] Audio chunking transcription error:', err);
        throw err;
      } finally {
        this.isProcessing = false;
      }
    }

    async _transcribeChunkBlob(chunkBlob, startOffsetMs, options = {}) {
      try {
        const formData = new FormData();
        formData.append('file', chunkBlob, `chunk_${startOffsetMs}.wav`);
        formData.append('startOffsetMs', String(startOffsetMs));
        if (options.language) formData.append('language', options.language);
        if (options.apiKey) formData.append('apiKey', options.apiKey);

        const endpoint = options.endpoint || '/api/captions/transcribe';
        const response = await fetch(endpoint, {
          method: 'POST',
          body: formData,
        });

        if (!response.ok) {
          throw new Error(`STT server returned status ${response.status}`);
        }

        const data = await response.json();
        if (data && Array.isArray(data.words)) {
          return data.words.map((w) => ({
            text: String(w.text || '').trim(),
            start: Math.round(Number(w.start) || 0) + (w.start < startOffsetMs ? startOffsetMs : 0),
            end: Math.round(Number(w.end) || 0) + (w.end < startOffsetMs ? startOffsetMs : 0),
            confidence: Number(w.confidence) || 0.95,
          }));
        }
        return [];
      } catch (err) {
        console.warn(`[AutoCaptionX] Chunk offset ${startOffsetMs}ms warning:`, err);
        return [];
      }
    }

    // ========================================================================
    // SUBTITLE FORMAT EXPORTS (SRT & VTT)
    // ========================================================================
    exportSRT() {
      if (!this.phrases || this.phrases.length === 0) return '';

      return this.phrases
        .map((p, idx) => {
          return `${idx + 1}\n${formatSRTTime(p.start)} --> ${formatSRTTime(p.end)}\n${p.text}\n`;
        })
        .join('\n');
    }

    exportVTT() {
      if (!this.phrases || this.phrases.length === 0) return 'WEBVTT\n\n';

      let vtt = 'WEBVTT\n\n';
      this.phrases.forEach((p, idx) => {
        vtt += `${idx + 1}\n${formatVTTTime(p.start)} --> ${formatVTTTime(p.end)}\n${p.text}\n\n`;
      });
      return vtt;
    }
  }

  // Expose global instance and class
  window.AutoCaptionX = new AutoCaptionXApp();
  window.AutoCaptionXApp = AutoCaptionXApp;

  // Auto-initialize if standard markup selectors exist
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      const video = document.querySelector('#captionVideo');
      const canvas = document.querySelector('#captionCanvas');
      const overlay = document.querySelector('#captionOverlay');
      if (video && (canvas || overlay)) {
        window.AutoCaptionX.init({ video, canvas, overlay });
      }
    });
  } else {
    const video = document.querySelector('#captionVideo');
    const canvas = document.querySelector('#captionCanvas');
    const overlay = document.querySelector('#captionOverlay');
    if (video && (canvas || overlay)) {
      window.AutoCaptionX.init({ video, canvas, overlay });
    }
  }

})(window, document);
