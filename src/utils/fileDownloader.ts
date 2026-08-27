// Universal cross-device video & file downloader (Desktop, Android, iOS Safari, Gallery & Files)
export interface SaveFileResult {
  success: boolean;
  method: 'share-api' | 'direct-download' | 'popup-fallback';
  message: string;
}

export async function downloadOrSaveVideoFile(
  blob: Blob,
  fileName: string,
  onNotice?: (msg: string) => void
): Promise<SaveFileResult> {
  const isMobile = /iPhone|iPad|iPod|Android|Mobile|Tablet/i.test(navigator.userAgent || navigator.vendor || '');
  const isIOS = /iPhone|iPad|iPod/i.test(navigator.userAgent || navigator.vendor || '');

  // Ensure valid MIME type for video
  const mimeType = blob.type && blob.type.includes('video') ? blob.type : 'video/mp4';
  const cleanBlob = new Blob([blob], { type: mimeType });

  // 1. Try Mobile Native Web Share API (Direct Save to Photos / Gallery / Device Storage)
  if (isMobile && typeof navigator !== 'undefined' && navigator.share && navigator.canShare) {
    try {
      const file = new File([cleanBlob], fileName, { type: mimeType, lastModified: Date.now() });

      if (navigator.canShare({ files: [file] })) {
        onNotice?.('Opening gallery save dialog...');
        await navigator.share({
          files: [file],
          title: 'AutoCaptionX Video',
          text: 'Captioned video with AI subtitles',
        });
        return {
          success: true,
          method: 'share-api',
          message: 'Saved to Gallery / Camera Roll via share sheet!',
        };
      }
    } catch (shareErr: any) {
      // If user cancelled the share sheet, don't fail, fall back to direct download
      if (shareErr.name === 'AbortError') {
        return {
          success: true,
          method: 'share-api',
          message: 'Download cancelled by user',
        };
      }
      console.warn('Web Share API notice, falling back to direct download:', shareErr);
    }
  }

  // 2. Direct Browser Download via Blob URL and synthetic click
  try {
    const objectUrl = URL.createObjectURL(cleanBlob);
    const link = document.createElement('a');
    link.style.display = 'none';
    link.href = objectUrl;
    link.download = fileName;
    link.target = '_self';
    link.rel = 'noopener noreferrer';

    document.body.appendChild(link);

    // Dispatch synthetic mouse event for maximum mobile browser compatibility
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

    // iOS Safari fallback: If link.click didn't start direct download, trigger window location
    if (isIOS) {
      setTimeout(() => {
        try {
          const fallbackA = document.createElement('a');
          fallbackA.href = objectUrl;
          fallbackA.download = fileName;
          fallbackA.click();
        } catch {}
      }, 300);
    }

    // Clean up DOM and revoke URL after enough time for mobile download manager
    setTimeout(() => {
      if (document.body.contains(link)) {
        document.body.removeChild(link);
      }
      URL.revokeObjectURL(objectUrl);
    }, 60000);

    return {
      success: true,
      method: 'direct-download',
      message: isMobile
        ? 'Video downloaded to your device Downloads / Gallery folder!'
        : 'Captioned video downloaded to your computer!',
    };
  } catch (err: any) {
    console.error('Direct download error:', err);

    // 3. Fallback: Open in new tab so user can Long Press -> Save Video
    try {
      const fallbackUrl = URL.createObjectURL(cleanBlob);
      window.open(fallbackUrl, '_blank');
      return {
        success: true,
        method: 'popup-fallback',
        message: 'Video opened in new tab. Press and hold to "Save Video".',
      };
    } catch (popupErr) {
      throw new Error(`Failed to save video: ${err.message || 'Browser prevented download'}`);
    }
  }
}
