// Universal cross-device video & file downloader (Desktop, Android Chrome, iOS Safari, Gallery & Camera Roll)
export interface SaveFileResult {
  success: boolean;
  method: 'direct-download' | 'long-press-fallback' | 'new-tab-fallback' | 'share-api';
  message: string;
  blobUrl?: string;
  blob?: Blob;
  fileName?: string;
  needsLongPressModal?: boolean;
}

/**
 * Share video file using Web Share API (native Android/iOS share sheet)
 */
export async function shareVideoFile(
  blob: Blob,
  fileName?: string
): Promise<{ success: boolean; error?: string }> {
  if (typeof navigator === 'undefined' || !navigator.share) {
    return { success: false, error: 'Web Share API not supported on this browser' };
  }

  try {
    const isWebm = blob.type.includes('webm');
    const targetMime = isWebm ? 'video/webm' : 'video/mp4';
    const targetExt = isWebm ? '.webm' : '.mp4';
    const safeName = (fileName ? fileName.replace(/\.[^/.]+$/, '') : 'AutoCaptionX_Video') + targetExt;

    const file = new File([blob], safeName, {
      type: targetMime,
      lastModified: Date.now(),
    });

    if (navigator.canShare && !navigator.canShare({ files: [file] })) {
      return { success: false, error: 'File sharing not supported on this device' };
    }

    await navigator.share({
      files: [file],
      title: 'AutoCaptionX Captioned Video',
      text: 'Captioned video with burned-in subtitles',
    });

    return { success: true };
  } catch (err: any) {
    if (err.name === 'AbortError') {
      return { success: false, error: 'Share was cancelled by user' };
    }
    console.warn('Share error:', err);
    return { success: false, error: err.message || 'Share failed' };
  }
}

/**
 * Robust Blob/Stream download function:
 * 1. Recognizes video format (MP4 or WebM).
 * 2. On Android Chrome: avoids broken programmatic a.click() which triggers Android download manager
 *    "1 download failed" error due to cross-process blob access restrictions.
 *    Instead routes smoothly to the Long-Press / View to Save Modal & Web Share API.
 * 3. On Desktop & iOS: triggers direct download with hidden <a> tag and delayed revocation.
 */
export async function downloadOrSaveVideoFile(
  blob: Blob,
  fileName?: string,
  onNotice?: (msg: string) => void
): Promise<SaveFileResult> {
  const isAndroid = typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent || navigator.vendor || '');
  const isIOS = typeof navigator !== 'undefined' && /iPhone|iPad|iPod/i.test(navigator.userAgent || navigator.vendor || '');

  // Detect format
  const isWebm = blob.type.includes('webm');
  const targetMime = isWebm ? 'video/webm' : 'video/mp4';
  const targetExt = isWebm ? '.webm' : '.mp4';
  const finalBlob = new Blob([blob], { type: targetMime });

  // Safe file name
  let safeFileName = 'AutoCaptionX_Video' + targetExt;
  if (fileName && fileName.trim().length > 0) {
    safeFileName = fileName.replace(/\.[^/.]+$/, '') + targetExt;
  }

  // Create persistent object URL
  let objectUrl = '';
  try {
    objectUrl = URL.createObjectURL(finalBlob);
  } catch (err) {
    console.warn('createObjectURL notice:', err);
  }

  // ANDROID CHROME FIX:
  // Android Chrome's OS DownloadManager runs in an external service process that cannot
  // read browser in-memory blob: URLs, causing the infamous "1 download failed" notification.
  // We NEVER call a.click() with blob: URLs on Android. Instead, we return needsLongPressModal: true
  // so the user can save via long-press, open in new tab, or share to gallery without download errors.
  if (isAndroid) {
    onNotice?.('Opening video preview for saving to Gallery...');
    return {
      success: true,
      method: 'long-press-fallback',
      message: 'Long press video to Save to Gallery, or use Share.',
      blobUrl: objectUrl,
      blob: finalBlob,
      fileName: safeFileName,
      needsLongPressModal: true,
    };
  }

  // For Desktop & non-Android: trigger standard browser download
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

    // Keep ObjectURL alive for 45s before revoking
    setTimeout(() => {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch (e) {}
    }, 45000);

    return {
      success: true,
      method: 'direct-download',
      message: isIOS
        ? 'Video downloaded! Tap to open and save to Camera Roll.'
        : 'Captioned video downloaded successfully!',
      blobUrl: objectUrl,
      blob: finalBlob,
      fileName: safeFileName,
      needsLongPressModal: false,
    };
  } catch (clickErr: any) {
    console.warn('Standard a.click() download blocked or failed:', clickErr);

    return {
      success: true,
      method: 'long-press-fallback',
      message: 'Tap & hold video in the preview to save to Gallery.',
      blobUrl: objectUrl,
      blob: finalBlob,
      fileName: safeFileName,
      needsLongPressModal: true,
    };
  }
}


