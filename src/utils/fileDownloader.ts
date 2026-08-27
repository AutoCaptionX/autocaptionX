// Universal cross-device video & file downloader (Desktop, Android, iOS Safari, Gallery & Camera Roll)
export interface SaveFileResult {
  success: boolean;
  method: 'share-api' | 'direct-download' | 'popup-fallback';
  message: string;
  blobUrl?: string;
}

export async function downloadOrSaveVideoFile(
  blob: Blob,
  fileName: string,
  onNotice?: (msg: string) => void
): Promise<SaveFileResult> {
  const isMobile = /iPhone|iPad|iPod|Android|Mobile|Tablet/i.test(navigator.userAgent || navigator.vendor || '');
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent || navigator.vendor || '');
  const isAndroid = /Android/i.test(navigator.userAgent || navigator.vendor || '');

  // Ensure standard MIME type for video
  const mimeType = blob.type && blob.type.includes('video') ? blob.type : 'video/mp4';
  const cleanBlob = new Blob([blob], { type: mimeType });
  const objectUrl = URL.createObjectURL(cleanBlob);

  // 1. Direct Browser Download via Link Element (Triggers Android Download Manager & Desktop Browser Downloads)
  try {
    const link = document.createElement('a');
    link.style.position = 'fixed';
    link.style.top = '-9999px';
    link.style.left = '-9999px';
    link.style.opacity = '0';
    link.href = objectUrl;
    link.download = fileName;
    link.setAttribute('download', fileName);
    link.target = '_self';
    link.rel = 'noopener noreferrer';

    document.body.appendChild(link);

    // Synthetic click
    if (typeof MouseEvent !== 'undefined') {
      const clickEvt = new MouseEvent('click', {
        view: window,
        bubbles: true,
        cancelable: true,
      });
      link.dispatchEvent(clickEvt);
    } else {
      link.click();
    }

    setTimeout(() => {
      if (document.body.contains(link)) {
        document.body.removeChild(link);
      }
    }, 2000);

    // 2. On iOS or Android devices, also attempt Web Share API if available to enable "Save Video to Gallery / Photos"
    if (isMobile && typeof navigator !== 'undefined' && navigator.share && navigator.canShare) {
      try {
        const file = new File([cleanBlob], fileName, { type: mimeType, lastModified: Date.now() });
        if (navigator.canShare({ files: [file] })) {
          onNotice?.('Opening Gallery save dialog...');
          await navigator.share({
            files: [file],
            title: 'AutoCaptionX Video',
            text: 'Captioned video ready for Gallery / Instagram / YouTube',
          });
          return {
            success: true,
            method: 'share-api',
            message: isIOS
              ? 'Saved to Apple Photos / Camera Roll!'
              : 'Saved to Gallery & Downloads folder!',
            blobUrl: objectUrl,
          };
        }
      } catch (shareErr: any) {
        if (shareErr.name === 'AbortError') {
          return {
            success: true,
            method: 'direct-download',
            message: 'Video downloaded to your device Downloads folder!',
            blobUrl: objectUrl,
          };
        }
        console.warn('Native share sheet notice:', shareErr);
      }
    }

    return {
      success: true,
      method: 'direct-download',
      message: isAndroid
        ? 'Video saved to your phone Downloads & Gallery!'
        : isIOS
        ? 'Video downloaded! Tap Files or Photos to view.'
        : 'Captioned video downloaded to your computer!',
      blobUrl: objectUrl,
    };
  } catch (err: any) {
    console.error('Direct download error:', err);

    // Fallback: Open in new tab so user can Long Press -> Save Video
    try {
      window.open(objectUrl, '_blank');
      return {
        success: true,
        method: 'popup-fallback',
        message: 'Video opened. Press and hold to "Save to Gallery".',
        blobUrl: objectUrl,
      };
    } catch (popupErr) {
      throw new Error(`Failed to save video: ${err.message || 'Browser prevented download'}`);
    }
  }
}
