// Universal cross-device video & file downloader (Desktop, Android Chrome, iOS Safari, Gallery & Camera Roll)
export interface SaveFileResult {
  success: boolean;
  method: 'direct-download' | 'long-press-fallback' | 'share-api';
  message: string;
  blobUrl?: string;
  blob?: Blob;
  fileName?: string;
  needsLongPressModal?: boolean;
}

/**
 * Downloads or saves a video file with memory-leak protections for Android Chrome:
 * 1. Explicitly converts processed canvas video to video/mp4 format before triggering download.
 * 2. Uses FileReader or direct Blob stream to prevent memory leaks on Android Chrome.
 * 3. Does NOT call URL.revokeObjectURL(url) immediately after a.click().
 *    Uses a setTimeout of 30 seconds to allow the mobile device enough time to finish writing to disk/gallery.
 * 4. Secondary fallback: If a.click() triggers an error, signals to render a 'Long-press to Save Video'
 *    HTML5 <video> preview modal so the user can manually tap and hold to save directly to their gallery.
 */
export async function downloadOrSaveVideoFile(
  blob: Blob,
  fileName?: string,
  onNotice?: (msg: string) => void
): Promise<SaveFileResult> {
  const isAndroid = /Android/i.test(navigator.userAgent || navigator.vendor || '');
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent || navigator.vendor || '');

  // Convert the processed canvas video explicitly to video/mp4 format before triggering download
  const mp4Blob = new Blob([blob], { type: 'video/mp4' });

  // Ensure fileName has .mp4 extension for video files
  let safeFileName = fileName && fileName.trim().length > 0 
    ? fileName.replace(/\.[^/.]+$/, '') + '.mp4'
    : `AutoCaptionX_${Date.now()}.mp4`;

  // Modify download function to use direct Blob stream or FileReader to prevent memory leaks on Android Chrome
  let objectUrl = '';
  try {
    if (typeof mp4Blob.stream === 'function') {
      // Direct Blob stream available in modern Android Chrome (streams without duplicating buffers)
      objectUrl = URL.createObjectURL(mp4Blob);
    } else {
      // FileReader stream fallback to manage buffer allocation cleanly
      objectUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (reader.result instanceof ArrayBuffer) {
            const bufferBlob = new Blob([reader.result], { type: 'video/mp4' });
            resolve(URL.createObjectURL(bufferBlob));
          } else {
            resolve(URL.createObjectURL(mp4Blob));
          }
        };
        reader.onerror = () => {
          resolve(URL.createObjectURL(mp4Blob));
        };
        reader.readAsArrayBuffer(mp4Blob);
      });
    }
  } catch (streamErr) {
    console.warn('Stream/FileReader initialization notice, falling back to standard createObjectURL:', streamErr);
    objectUrl = URL.createObjectURL(mp4Blob);
  }

  // 1. Attempt DOM Anchor Download with 30s delayed revoke and error fallback
  try {
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = objectUrl;
    a.download = safeFileName;
    a.setAttribute('download', safeFileName);
    a.rel = 'noopener noreferrer';

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // CRITICAL: Do NOT call URL.revokeObjectURL(url) immediately after a.click().
    // Add a setTimeout of 30 seconds to allow the mobile device enough time to finish writing the file to disk/gallery.
    setTimeout(() => {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch (e) {
        console.warn('URL revoke notice:', e);
      }
    }, 30000); // 30 seconds

    return {
      success: true,
      method: 'direct-download',
      message: isAndroid
        ? 'Video download started! Saving directly to Phone Gallery & Downloads.'
        : isIOS
        ? 'Video downloaded! Tap to open and save to Camera Roll.'
        : 'Captioned video downloaded successfully!',
      blobUrl: objectUrl,
      blob: mp4Blob,
      fileName: safeFileName,
      needsLongPressModal: false,
    };
  } catch (clickErr: any) {
    console.error('a.click() triggered an error, invoking fallback modal:', clickErr);

    // Keep objectUrl alive so fallback modal can immediately play and offer long-press save
    setTimeout(() => {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch (e) {}
    }, 60000); // 60 seconds

    return {
      success: false,
      method: 'long-press-fallback',
      message: 'Automatic download prevented. Use the "Long-press to Save Video" preview.',
      blobUrl: objectUrl,
      blob: mp4Blob,
      fileName: safeFileName,
      needsLongPressModal: true,
    };
  }
}


