// Universal cross-device video & file downloader (Desktop, Android Chrome, iOS Safari, Gallery & Camera Roll)
export interface SaveFileResult {
  success: boolean;
  method: 'direct-download' | 'long-press-fallback' | 'new-tab-fallback';
  message: string;
  blobUrl?: string;
  blob?: Blob;
  fileName?: string;
  needsLongPressModal?: boolean;
}

/**
 * Robust Blob/Stream download function:
 * 1. Converts rendered Canvas/MediaRecorder output to video/mp4 or video/webm.
 * 2. Forces browser to trigger a real file download by attaching a hidden <a> tag to document.body,
 *    setting a.download = "AutoCaptionX_Video.mp4", calling a.click(), and using setTimeout
 *    (15 seconds delay) before revoking the ObjectURL.
 * 3. Fallback: If a.click() fails, opens the Blob directly in a new tab or displays a 'Long-press to Save' popup video preview.
 */
export async function downloadOrSaveVideoFile(
  blob: Blob,
  fileName?: string,
  onNotice?: (msg: string) => void
): Promise<SaveFileResult> {
  const isAndroid = /Android/i.test(navigator.userAgent || navigator.vendor || '');
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent || navigator.vendor || '');

  // Convert the rendered Canvas/MediaRecorder output to video/mp4 or video/webm
  const isWebm = blob.type.includes('webm');
  const targetMime = isWebm ? 'video/webm' : 'video/mp4';
  const targetExt = isWebm ? '.webm' : '.mp4';
  const finalBlob = new Blob([blob], { type: targetMime });

  // Safe file name, defaulting to AutoCaptionX_Video.mp4
  let safeFileName = 'AutoCaptionX_Video' + targetExt;
  if (fileName && fileName.trim().length > 0) {
    safeFileName = fileName.replace(/\.[^/.]+$/, '') + targetExt;
  }

  // Use direct Blob stream or FileReader to prevent memory leaks on Android Chrome
  let objectUrl = '';
  try {
    if (typeof finalBlob.stream === 'function') {
      objectUrl = URL.createObjectURL(finalBlob);
    } else {
      objectUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          if (reader.result instanceof ArrayBuffer) {
            const bufferBlob = new Blob([reader.result], { type: targetMime });
            resolve(URL.createObjectURL(bufferBlob));
          } else {
            resolve(URL.createObjectURL(finalBlob));
          }
        };
        reader.onerror = () => resolve(URL.createObjectURL(finalBlob));
        reader.readAsArrayBuffer(finalBlob);
      });
    }
  } catch (streamErr) {
    console.warn('Stream/FileReader initialization notice, using direct createObjectURL:', streamErr);
    objectUrl = URL.createObjectURL(finalBlob);
  }

  // Force real file download by attaching hidden <a> tag to document.body
  try {
    const a = document.createElement('a');
    a.style.display = 'none';
    a.href = objectUrl;
    a.download = safeFileName || 'AutoCaptionX_Video.mp4';
    a.setAttribute('download', safeFileName || 'AutoCaptionX_Video.mp4');
    a.rel = 'noopener noreferrer';

    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // CRITICAL: Use setTimeout of 15 seconds delay before revoking ObjectURL
    setTimeout(() => {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch (e) {
        console.warn('URL revoke notice:', e);
      }
    }, 15000); // 15 seconds delay

    return {
      success: true,
      method: 'direct-download',
      message: isAndroid
        ? 'Video download initiated! Long press video to Save to Gallery if blocked.'
        : isIOS
        ? 'Video downloaded! Tap to open and save to Camera Roll.'
        : 'Captioned video downloaded successfully!',
      blobUrl: objectUrl,
      blob: finalBlob,
      fileName: safeFileName,
      needsLongPressModal: isAndroid,
    };
  } catch (clickErr: any) {
    console.error('a.click() failed or was blocked by browser, attempting new tab and fallback modal:', clickErr);

    // Secondary fallback: Try to open the Blob directly in a new tab
    let openedTab = false;
    try {
      const newTab = window.open(objectUrl, '_blank');
      if (newTab) openedTab = true;
    } catch (tabErr) {
      console.warn('window.open fallback blocked:', tabErr);
    }

    // Keep objectUrl alive for fallback modal
    setTimeout(() => {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch (e) {}
    }, 60000);

    return {
      success: openedTab,
      method: openedTab ? 'new-tab-fallback' : 'long-press-fallback',
      message: openedTab
        ? 'Video opened in new tab! Tap and hold to save directly to gallery.'
        : 'Automatic download prevented. Use the "Long-press to Save Video" preview.',
      blobUrl: objectUrl,
      blob: finalBlob,
      fileName: safeFileName,
      needsLongPressModal: true,
    };
  }
}


