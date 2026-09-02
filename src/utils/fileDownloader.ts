// Universal cross-device video & file downloader (Desktop, Android, iOS Safari, Gallery & Camera Roll)
export interface SaveFileResult {
  success: boolean;
  method: 'share-api' | 'direct-download' | 'popup-fallback';
  message: string;
  blobUrl?: string;
}

export async function downloadOrSaveVideoFile(
  blob: Blob,
  fileName?: string,
  onNotice?: (msg: string) => void
): Promise<SaveFileResult> {
  const isMobile = /iPhone|iPad|iPod|Android|Mobile|Tablet/i.test(navigator.userAgent || navigator.vendor || '');
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent || navigator.vendor || '');
  const isAndroid = /Android/i.test(navigator.userAgent || navigator.vendor || '');

  const safeFileName = fileName && fileName.trim().length > 0 
    ? fileName 
    : `AutoCaptionX_${Date.now()}.mp4`;

  // Ensure standard MIME type for video
  const mimeType = blob.type && blob.type.includes('video') ? blob.type : 'video/mp4';
  const cleanBlob = new Blob([blob], { type: mimeType });
  const objectUrl = URL.createObjectURL(cleanBlob);

  // 1. Trigger DOM Anchor Download
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

    // Keep ObjectURL alive for 15 seconds so Android Download Manager finishes saving to Gallery/Downloads
    setTimeout(() => {
      try {
        URL.revokeObjectURL(objectUrl);
      } catch (e) {}
    }, 15000);

    return {
      success: true,
      method: 'direct-download',
      message: isAndroid
        ? 'Video download started! Saving directly to Phone Gallery & Downloads.'
        : isIOS
        ? 'Video downloaded! Tap to open and save to Camera Roll.'
        : 'Captioned video downloaded successfully!',
      blobUrl: objectUrl,
    };
  } catch (err: any) {
    console.error('Direct DOM download error:', err);

    // Fallback: Open in new window/tab so user can long-press to save
    try {
      window.open(objectUrl, '_blank');
      return {
        success: true,
        method: 'popup-fallback',
        message: 'Video opened in preview tab. Long-press to save to phone.',
        blobUrl: objectUrl,
      };
    } catch (popupErr) {
      throw new Error(`Failed to save video: ${err.message || 'Browser prevented download'}`);
    }
  }
}

