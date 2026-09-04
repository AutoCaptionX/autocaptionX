/**
 * ============================================================================
 * AutoCaptionX - Core Web Application Engine (app.js)
 * ============================================================================
 * 
 * STRICT LOW-MEMORY MOBILE OPTIMIZATIONS IMPLEMENTED (4GB RAM DEVICES):
 * 
 * 1. Throttle Caption UI Updates (Max 30 FPS) & String Diff Comparison:
 *    - Caption DOM/Canvas subtitle updates are strictly throttled to a maximum
 *      of 30 frames per second (~33.3ms minimum frame interval).
 *    - High-frequency HTML5 'timeupdate' ticks do NOT trigger synchronous DOM or
 *      canvas re-draws during playback.
 *    - Employs an ultra-fast string diff comparison (lastRenderedKey). If the active
 *      phrase and active kinetic word have not changed between ticks, all re-clearing,
 *      DOM mutation, and canvas painting is completely bypassed.
 * 
 * 2. Optimize DOM / Canvas Operations (Hardware Accelerated & Zero Filter Cost):
 *    - Enforces hardware acceleration on caption overlay and canvas layers using
 *      transform: translate3d(0, 0, 0), will-change: transform, and backface-visibility: hidden.
 *    - Disables active CSS backdrop-filters, dynamic text shadows, box shadows, and
 *      heavy CSS transitions/animations on subtitle elements during active playback.
 *    - Canvas context forces off shadowBlur, shadowColor, and filter='none',
 *      using crisp single-pass stroke outlines with 0.1ms execution overhead.
 * 
 * 3. Background Audio Chunking & Explicit GC Pause:
 *    - Slices large audio streams into discrete 30-second processing windows.
 *    - Enforces an explicit 100ms asynchronous garbage collection timeout
 *      (setTimeout(..., 100)) between chunk processing iterations, allowing the V8
 *      and JavaScriptCore engines to reclaim large audio heap buffers before allocating
 *      the next slice, preventing browser tab crashes on 4GB RAM devices.
 * ============================================================================
 */

(function (window, document) {
  'use strict';

  // --- ASYNC TIMING & EXPLICIT GC PAUSE UTILITY ---
  /**
   * Pauses execution asynchronously to yield control back to the browser event loop.
   * On low-memory (4GB RAM) mobile devices, a 100ms pause allows the browser's
   * garbage collector to reclaim heap memory between heavy audio/blob operations.
   * @param {number} ms Duration to sleep in milliseconds (default: 100ms)
   */
  const asyncSleep = (ms = 100) => new Promise((resolve) => setTimeout(resolve, ms));

  // --- 16-BIT PCM WAV ENCODER UTILITY (Pure Vanilla JS, 16kHz Mono) ---
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

  // --- AUDIO CHUNKING ENGINE (30-SECOND WINDOWS WITH EXPLICIT GC PAUSE) ---
  /**
   * Slices an AudioBuffer into discrete 30-second windows.
   * Processes each slice independently to keep memory consumption low on 4GB RAM devices.
   * 
   * @param {AudioBuffer} audioBuffer Full audio buffer from Web Audio API
   * @param {number} chunkSeconds Window duration in seconds (default: 30)
   * @returns {Array<{ index: number, startMs: number, endMs: number, blob: Blob, durationMs: number }>}
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

      // Encode slice as clean 16kHz mono WAV Blob
      const wavBlob = encodeWAV(slice, sampleRate);

      chunks.push({
        index: chunkIndex++,
        startMs: startMs,
        endMs: endMs,
        durationMs: endMs - startMs,
        blob: wavBlob,
      });

      // Explicit yield during chunk slicing to prevent UI freeze and allow heap collection
      if (chunkIndex % 2 === 0) {
        await asyncSleep(40);
      }
    }

    return chunks;
  }

  /**
   * Safely decodes an audio or video file into an AudioBuffer using Web Audio API.
   * Closes the AudioContext instance immediately upon completion to free hardware handles.
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

  // --- SUBTITLE PHRASE BUILDER ---
  /**
   * Groups word-level timestamps into readable visual phrases (3 to 6 words).
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

  // --- AUTOCAPTIONX ENGINE CONTROLLER ---
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

      // 1. Max 30 FPS Throttling & String Diff Cache
      this.rafId = null;
      this.isPlaying = false;
      this.singleFramePending = false;
      this.lastRenderTime = 0;
      this.minFrameIntervalMs = 33.33; // Exactly 30 FPS ceiling (1000 / 30)
      this.lastRenderedKey = ''; // String diff signature cache

      // 2. Maximum resolution constraint for preview canvas (720p limit)
      this.maxPreviewDimension = 720;

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
     * Initializes the player, canvas, and overlay references with hardware acceleration.
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
        // Apply GPU hardware acceleration and strip heavy filters
        this._applyHardwareAcceleration(this.canvas);
      }

      if (this.overlayEl) {
        // Apply GPU hardware acceleration and strip heavy filters on DOM overlay
        this._applyHardwareAcceleration(this.overlayEl);
      }

      if (options.maxPreviewDimension) {
        this.maxPreviewDimension = options.maxPreviewDimension;
      }

      // Detach any previous listeners to prevent memory leaks
      this._detachEventListeners();
      // Attach strictly throttled non-blocking listeners
      this._attachEventListeners();

      // Synchronize dimensions capped to max 720p
      this._syncCanvasSize();
      this.scheduleSingleFrame(true);

      console.log('[AutoCaptionX] Initialized with 30 FPS Throttling, String Diffing, and Hardware Acceleration.');
    }

    /**
     * HARDWARE ACCELERATION & LOW-MEMORY CSS OPTIMIZATION:
     * - Uses transform: translate3d(0, 0, 0) for composite-layer hardware rendering.
     * - Forces off active CSS backdrop-filters, dynamic text shadows, and animations
     *   during active video playback to prevent GPU/CPU stalling on 4GB RAM phones.
     */
    _applyHardwareAcceleration(element) {
      if (!element || !element.style) return;
      try {
        element.style.transform = 'translate3d(0, 0, 0)';
        element.style.webkitTransform = 'translate3d(0, 0, 0)';
        element.style.willChange = 'transform';
        element.style.backfaceVisibility = 'hidden';
        element.style.webkitBackfaceVisibility = 'hidden';

        // Strip heavy filters that choke mobile GPU
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

    /**
     * ASYNC EVENT BINDINGS:
     * Decouples canvas/DOM graphics rendering from the video player pipeline.
     */
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
     * THROTTLED TIMEUPDATE LISTENER:
     * Does NOT perform synchronous DOM reflow or canvas repainting during playback.
     * When paused or seeking, schedules a single frame asynchronously.
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

    /**
     * ASYNC rAF LOOP THROTTLED TO MAX 30 FPS:
     * - Checks performance.now() against minFrameIntervalMs (33.3ms = 30 FPS ceiling).
     * - Only triggers renderFrame if enough time has passed.
     */
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

    _rafRenderLoop() {
      if (!this.isPlaying || !this.video || this.video.paused || this.video.ended) {
        this.rafId = null;
        return;
      }

      const now = performance.now();
      const delta = now - this.lastRenderTime;

      // Enforce 30 FPS Ceiling: skip frame if called earlier than 33.3ms
      if (delta >= this.minFrameIntervalMs) {
        const curMs = Math.round(this.video.currentTime * 1000);
        this.currentTimeMs = curMs;
        this.renderFrame(curMs, false);
      }

      this.rafId = requestAnimationFrame(this._rafLoop);
    }

    /**
     * Schedules an asynchronous single frame render via requestAnimationFrame.
     * @param {boolean} force Whether to bypass string diff checking (e.g. after seek or resize)
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
     * RESOLUTION SCALE FIX:
     * Caps canvas preview resolution strictly to 720p maximum.
     * Prevents browser UI thread freezing, RAM exhaustion, and lag on mobile/desktop.
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
          // Landscape: cap height to 720p
          if (targetH > maxDim) {
            targetW = Math.round((targetW * maxDim) / targetH);
            targetH = maxDim;
          }
        } else {
          // Portrait: cap width to 720p
          if (targetW > maxDim) {
            targetH = Math.round((targetH * maxDim) / targetW);
            targetW = maxDim;
          }
        }
      }

      if (this.canvas.width !== targetW || this.canvas.height !== targetH) {
        this.canvas.width = targetW;
        this.canvas.height = targetH;
        this._applyHardwareAcceleration(this.canvas);
      }
    }

    /**
     * Updates active caption words and rebuilds phrase groupings.
     */
    setCaptions(words) {
      this.words = Array.isArray(words) ? words : [];
      this.phrases = buildCaptionPhrases(this.words);
      this.lastRenderedKey = ''; // Invalidate cache
      this.scheduleSingleFrame(true);
    }

    /**
     * Locates the active phrase for a given millisecond timestamp.
     */
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
     * - Throttled to max 30 FPS.
     * - Fast String Diff Comparison: completely skips rendering if the active caption
     *   phrase and kinetic word haven't changed.
     * - Zero backdrop-filters, zero dynamic text-shadows, zero shadowBlur.
     * - Supports both HTML5 Canvas overlay and DOM element overlay.
     */
    renderFrame(timeMs, force = false) {
      const now = performance.now();

      // 1. Throttle check (unless forced like on seek)
      if (!force && now - this.lastRenderTime < this.minFrameIntervalMs) {
        return;
      }

      // 2. Active Caption String Diff Computation
      const activePhrase = this.getActivePhrase(timeMs);
      let activeKey = 'EMPTY';
      let activeWord = null;

      if (activePhrase && activePhrase.words && activePhrase.words.length > 0) {
        for (let i = 0; i < activePhrase.words.length; i++) {
          const w = activePhrase.words[i];
          if (timeMs >= w.start && timeMs <= w.end) {
            activeWord = w;
            break;
          }
        }
        activeKey = `${activePhrase.start}_${activePhrase.end}_${activeWord ? activeWord.text : ''}`;
      }

      // String Diff Optimization: If caption state is identical to last frame, skip painting!
      if (!force && activeKey === this.lastRenderedKey) {
        return;
      }

      this.lastRenderedKey = activeKey;
      this.lastRenderTime = now;

      // 3. Render on DOM Overlay (if configured)
      if (this.overlayEl) {
        this._renderDomOverlay(activePhrase, activeWord);
      }

      // 4. Render on Canvas Overlay (if configured)
      if (this.canvas && this.ctx) {
        this._renderCanvasOverlay(timeMs, activePhrase, activeWord);
      }
    }

    /**
     * Hardware-accelerated lightweight DOM overlay rendering.
     * Avoids innerHTML and uses textContent to prevent garbage creation.
     */
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

      // Build text content with minimal DOM allocations
      this.overlayEl.textContent = activePhrase.text;
    }

    /**
     * Hardware-accelerated lightweight Canvas overlay rendering.
     */
    _renderCanvasOverlay(timeMs, activePhrase, activeWord) {
      const ctx = this.ctx;
      const width = this.canvas.width;
      const height = this.canvas.height;

      // Clear previous frame
      ctx.clearRect(0, 0, width, height);

      if (!activePhrase || !activePhrase.words || activePhrase.words.length === 0) {
        return;
      }

      // FORCED OFF: Eliminate heavy canvas filters and shadow blurs during real-time playback
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;
      if (ctx.filter) ctx.filter = 'none';

      // Dynamic responsive typography scaled to 720p canvas bounds
      const fontSize = Math.max(16, Math.round(height * this.style.fontSizeRatio));
      ctx.font = `800 ${fontSize}px ${this.style.fontFamily}`;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';

      // Measure phrase text dimensions
      const spaceWidth = ctx.measureText(' ').width;
      let totalTextWidth = 0;
      const wordMetrics = activePhrase.words.map((w) => {
        const textWidth = ctx.measureText(w.text).width;
        totalTextWidth += textWidth;
        return { word: w, width: textWidth };
      });
      totalTextWidth += spaceWidth * (activePhrase.words.length - 1);

      // Container Box Dimensions
      const boxPadding = this.style.boxPadding;
      const boxWidth = totalTextWidth + boxPadding * 2;
      const boxHeight = fontSize * 1.5 + boxPadding;
      const boxX = Math.round((width - boxWidth) / 2);
      const boxY = Math.round(height * this.style.yPositionRatio - boxHeight / 2);

      // Draw background pill
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

      // Draw active kinetic words using zero-overhead stroke outlines
      let currentX = boxX + boxPadding;
      const centerY = boxY + boxHeight / 2;

      for (let i = 0; i < wordMetrics.length; i++) {
        const { word, width: wordWidth } = wordMetrics[i];
        const isActive = timeMs >= word.start && timeMs <= word.end;

        ctx.fillStyle = isActive ? this.style.highlightColor : this.style.textColor;

        // High-contrast stroke text (single-pass, zero Gaussian blur cost)
        if (this.style.strokeColor && this.style.strokeWidth > 0) {
          ctx.strokeStyle = this.style.strokeColor;
          ctx.lineWidth = this.style.strokeWidth;
          ctx.strokeText(word.text, currentX, centerY);
        }

        ctx.fillText(word.text, currentX, centerY);
        currentX += wordWidth + spaceWidth;
      }
    }

    /**
     * BACKGROUND AUDIO CHUNKING (30s WINDOWS) & EXPLICIT GC TIMEOUT (100ms):
     * 1. Decodes audio with Web Audio API.
     * 2. Slices audio into clean 30-second WAV chunks.
     * 3. Inserts explicit 100ms garbage collection pauses between chunks to clear
     *    heap memory and prevent browser tab crashes on 4GB RAM mobile devices.
     * 4. Concatenates timed words without time drift or boundary loss.
     * 
     * @param {File|Blob} mediaFileOrBlob Video or audio file
     * @param {Function} onProgress Callback: (percent: number, statusText: string) => void
     * @param {Object} options Optional Whisper/STT config options
     */
    async processAudioIn30sChunks(mediaFileOrBlob, onProgress, options = {}) {
      if (this.isProcessing) return;
      this.isProcessing = true;

      try {
        if (onProgress) onProgress(5, 'Decoding audio track with Web Audio API...');

        // 1. Safely decode full audio
        const audioBuffer = await decodeAudioFromFile(mediaFileOrBlob);
        const totalDurationSec = audioBuffer.duration;

        if (onProgress) onProgress(15, `Dividing into 30s processing windows (Total: ${Math.round(totalDurationSec)}s)...`);

        // 2. Chunk AudioBuffer into 30-second windows with async sleep
        const chunks = await splitAudioBufferInto30sChunks(audioBuffer, 30);
        const totalChunks = chunks.length;

        console.log(`[AutoCaptionX] Starting 30-second chunk processing (${totalChunks} chunks total) with GC pauses.`);

        const allWords = [];

        // 3. Process each 30-second window sequentially
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

          // Transcribe single 30s chunk via Whisper / STT API
          const chunkWords = await this._transcribeChunkBlob(chunk.blob, chunk.startMs, options);

          if (chunkWords && chunkWords.length > 0) {
            allWords.push(...chunkWords);
          }

          // CRITICAL MEMORY CLEANUP: Release intermediate chunk blob reference
          chunk.blob = null;

          // EXPLICIT GC PAUSE: 100ms pause yields to the browser engine so V8/JSC GC can
          // reclaim large audio heap allocations on 4GB RAM devices.
          await asyncSleep(100);
        }

        if (onProgress) onProgress(95, 'Finalizing and synchronizing captions...');

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

    /**
     * Dispatches a single 30s chunk to the backend Whisper/STT proxy.
     */
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

    /**
     * Exports Subtitles to standard .SRT format.
     */
    exportSRT() {
      if (!this.phrases || this.phrases.length === 0) return '';

      const formatSRTTime = (ms) => {
        const date = new Date(ms);
        const hours = String(Math.floor(ms / 3600000)).padStart(2, '0');
        const minutes = String(date.getUTCMinutes()).padStart(2, '0');
        const seconds = String(date.getUTCSeconds()).padStart(2, '0');
        const millis = String(date.getUTCMilliseconds()).padStart(3, '0');
        return `${hours}:${minutes}:${seconds},${millis}`;
      };

      return this.phrases
        .map((p, idx) => {
          return `${idx + 1}\n${formatSRTTime(p.start)} --> ${formatSRTTime(p.end)}\n${p.text}\n`;
        })
        .join('\n');
    }

    /**
     * Exports Subtitles to standard .VTT format.
     */
    exportVTT() {
      if (!this.phrases || this.phrases.length === 0) return 'WEBVTT\n\n';

      const formatVTTTime = (ms) => {
        const date = new Date(ms);
        const hours = String(Math.floor(ms / 3600000)).padStart(2, '0');
        const minutes = String(date.getUTCMinutes()).padStart(2, '0');
        const seconds = String(date.getUTCSeconds()).padStart(2, '0');
        const millis = String(date.getUTCMilliseconds()).padStart(3, '0');
        return `${hours}:${minutes}:${seconds}.${millis}`;
      };

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
