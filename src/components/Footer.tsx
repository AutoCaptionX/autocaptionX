import React from 'react';
import {
  Info,
  Mail,
  Clock,
  MapPin,
  FileText,
  Shield,
  AlertTriangle,
  Sparkles,
} from 'lucide-react';

export const Footer: React.FC = () => {
  return (
    <footer id="footer-section" className="w-full mt-12 border-t border-slate-800/80 bg-slate-950/90 pt-10 pb-8 text-slate-300">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 space-y-6">
        
        {/* Brand Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 pb-4 border-b border-slate-800/80">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-md">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <span className="text-base font-bold text-white tracking-tight">AutoCaptionX</span>
              <p className="text-[11px] text-slate-400">AI-Powered Automatic Video Captioning & Subtitling</p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-[11px] text-emerald-400 bg-emerald-950/40 border border-emerald-800/50 px-2.5 py-1 rounded-full">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
            Zero-Storage Privacy Guaranteed
          </div>
        </div>

        {/* BOX 1: About Us */}
        <section id="footer-about-us" className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xs">
          <div className="flex items-center gap-2.5 mb-2.5">
            <div className="w-7 h-7 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-400 flex items-center justify-center">
              <Info className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-slate-100 tracking-wide">About Us</h3>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed">
            Welcome to AutoCaptionX! AutoCaptionX is an advanced AI-powered platform designed to make video captioning and subtitling effortless for content creators, marketers, and editors. Our tool automatically transcribes speech into accurate text, burns subtitles directly into your videos using FFmpeg, and allows high-quality exports up to 4K resolution. We prioritize privacy and efficiency by ensuring a zero-storage workflow where files are automatically deleted right after download.
          </p>
        </section>

        {/* BOX 2: Contact Us */}
        <section id="footer-contact-us" className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xs">
          <div className="flex items-center gap-2.5 mb-2.5">
            <div className="w-7 h-7 rounded-lg bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 flex items-center justify-center">
              <Mail className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-slate-100 tracking-wide">Contact Us</h3>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed mb-3">
            Get in Touch with AutoCaptionX. If you have any questions, feedback, or support inquiries, feel free to reach out to us. We are here to help you enhance your video content!
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-2 border-t border-slate-800/80 text-xs">
            <div className="flex items-center gap-2 p-2 rounded-xl bg-slate-950/60 border border-slate-800/60">
              <Mail className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <div className="min-w-0">
                <span className="text-[10px] text-slate-400 block font-medium">Email</span>
                <a href="mailto:hasbunkhatun625@gmail.com" className="text-indigo-300 hover:text-indigo-200 font-semibold truncate block">
                  hasbunkhatun625@gmail.com
                </a>
              </div>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-xl bg-slate-950/60 border border-slate-800/60">
              <Clock className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <div>
                <span className="text-[10px] text-slate-400 block font-medium">Response Time</span>
                <span className="text-slate-200 font-medium">Within 24–48 hours</span>
              </div>
            </div>
            <div className="flex items-center gap-2 p-2 rounded-xl bg-slate-950/60 border border-slate-800/60">
              <MapPin className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
              <div>
                <span className="text-[10px] text-slate-400 block font-medium">Location</span>
                <span className="text-slate-200 font-medium">Nepal (simraungadh)</span>
              </div>
            </div>
          </div>
        </section>

        {/* BOX 3: Terms & Conditions */}
        <section id="footer-terms-conditions" className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xs">
          <div className="flex items-center gap-2.5 mb-2.5">
            <div className="w-7 h-7 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center">
              <FileText className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-slate-100 tracking-wide">Terms & Conditions</h3>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed mb-3">
            By accessing and using AutoCaptionX, you agree to comply with the following terms:
          </p>
          <ol className="space-y-2 text-xs text-slate-300">
            <li className="flex items-start gap-2 bg-slate-950/40 p-2 rounded-lg border border-slate-800/60">
              <span className="font-bold text-amber-400 font-mono text-[11px] shrink-0 mt-0.5">1.</span>
              <div><strong className="text-slate-200 font-semibold">Service Usage:</strong> AutoCaptionX provides automated subtitle generation and video processing. You are responsible for the content you upload.</div>
            </li>
            <li className="flex items-start gap-2 bg-slate-950/40 p-2 rounded-lg border border-slate-800/60">
              <span className="font-bold text-amber-400 font-mono text-[11px] shrink-0 mt-0.5">2.</span>
              <div><strong className="text-slate-200 font-semibold">Content Ownership:</strong> You retain full ownership of all video files you upload and export using our platform.</div>
            </li>
            <li className="flex items-start gap-2 bg-slate-950/40 p-2 rounded-lg border border-slate-800/60">
              <span className="font-bold text-amber-400 font-mono text-[11px] shrink-0 mt-0.5">3.</span>
              <div><strong className="text-slate-200 font-semibold">Prohibited Content:</strong> Users must not upload illegal, harmful, or copyrighted videos without authorization.</div>
            </li>
            <li className="flex items-start gap-2 bg-slate-950/40 p-2 rounded-lg border border-slate-800/60">
              <span className="font-bold text-amber-400 font-mono text-[11px] shrink-0 mt-0.5">4.</span>
              <div><strong className="text-slate-200 font-semibold">Storage Policy:</strong> Uploaded and processed videos are temporarily hosted solely for processing and are automatically deleted upon download completion.</div>
            </li>
            <li className="flex items-start gap-2 bg-slate-950/40 p-2 rounded-lg border border-slate-800/60">
              <span className="font-bold text-amber-400 font-mono text-[11px] shrink-0 mt-0.5">5.</span>
              <div><strong className="text-slate-200 font-semibold">Limitation of Liability:</strong> AutoCaptionX is provided &quot;as is&quot; without warranties of any kind. We are not liable for data loss or temporary service interruptions.</div>
            </li>
          </ol>
        </section>

        {/* BOX 4: Privacy Policy */}
        <section id="footer-privacy-policy" className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xs">
          <div className="flex items-center gap-2.5 mb-2.5">
            <div className="w-7 h-7 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 flex items-center justify-center">
              <Shield className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-slate-100 tracking-wide">Privacy Policy</h3>
          </div>
          <p className="text-xs text-slate-300 leading-relaxed mb-3">
            At AutoCaptionX, we take your privacy seriously:
          </p>
          <ol className="space-y-2 text-xs text-slate-300">
            <li className="flex items-start gap-2 bg-slate-950/40 p-2 rounded-lg border border-slate-800/60">
              <span className="font-bold text-emerald-400 font-mono text-[11px] shrink-0 mt-0.5">1.</span>
              <div><strong className="text-slate-200 font-semibold">Data Processing:</strong> We process your uploaded video and audio files strictly to generate subtitles and render the final video.</div>
            </li>
            <li className="flex items-start gap-2 bg-slate-950/40 p-2 rounded-lg border border-slate-800/60">
              <span className="font-bold text-emerald-400 font-mono text-[11px] shrink-0 mt-0.5">2.</span>
              <div><strong className="text-slate-200 font-semibold">Zero Storage Commitment:</strong> Your files are temporary and are permanently removed from our servers immediately after you complete your download.</div>
            </li>
            <li className="flex items-start gap-2 bg-slate-950/40 p-2 rounded-lg border border-slate-800/60">
              <span className="font-bold text-emerald-400 font-mono text-[11px] shrink-0 mt-0.5">3.</span>
              <div><strong className="text-slate-200 font-semibold">User Information:</strong> If you sign in via Firebase, we only collect basic account identifiers necessary for authentication.</div>
            </li>
            <li className="flex items-start gap-2 bg-slate-950/40 p-2 rounded-lg border border-slate-800/60">
              <span className="font-bold text-emerald-400 font-mono text-[11px] shrink-0 mt-0.5">4.</span>
              <div><strong className="text-slate-200 font-semibold">Third-Party Services:</strong> We utilize secure APIs strictly for core application functionality. We do not sell or trade your personal data to third parties.</div>
            </li>
          </ol>
        </section>

        {/* BOX 5: Disclaimer */}
        <section id="footer-disclaimer" className="bg-slate-900/80 border border-slate-800 rounded-2xl p-5 shadow-xs">
          <div className="flex items-center gap-2.5 mb-2.5">
            <div className="w-7 h-7 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
            <h3 className="text-sm font-bold text-slate-100 tracking-wide">Disclaimer</h3>
          </div>
          <ol className="space-y-2 text-xs text-slate-300">
            <li className="flex items-start gap-2 bg-slate-950/40 p-2 rounded-lg border border-slate-800/60">
              <span className="font-bold text-rose-400 font-mono text-[11px] shrink-0 mt-0.5">1.</span>
              <div><strong className="text-slate-200 font-semibold">Accuracy:</strong> AutoCaptionX uses artificial intelligence for speech-to-text transcription. While our system strives for maximum accuracy, minor transcription errors may occur based on audio clarity, accents, or background noise.</div>
            </li>
            <li className="flex items-start gap-2 bg-slate-950/40 p-2 rounded-lg border border-slate-800/60">
              <span className="font-bold text-rose-400 font-mono text-[11px] shrink-0 mt-0.5">2.</span>
              <div><strong className="text-slate-200 font-semibold">External Use:</strong> AutoCaptionX is not responsible for how users utilize the final exported videos on third-party platforms.</div>
            </li>
            <li className="flex items-start gap-2 bg-slate-950/40 p-2 rounded-lg border border-slate-800/60">
              <span className="font-bold text-rose-400 font-mono text-[11px] shrink-0 mt-0.5">3.</span>
              <div><strong className="text-slate-200 font-semibold">Service Availability:</strong> We reserve the right to update or modify features, processing limits, or terms of service at any time without prior notice.</div>
            </li>
          </ol>
        </section>

        {/* Creator / Developer Profile Section */}
        <div id="footer-creator-profile" className="pt-6 pb-2 border-t border-slate-800/80 flex flex-col items-center justify-center text-center">
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4 sm:gap-6 mb-3">
            <div className="relative inline-block">
              <img
                src="https://i.ibb.co/R4zknTjT/IMG-20260825-152808.jpg"
                alt="Creator & Developer Profile"
                className="w-[120px] h-[120px] rounded-full object-cover border-2 border-indigo-500/60 shadow-lg shadow-indigo-950/40"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  // Fallback to local copy if network/CORS blocks external cdn
                  e.currentTarget.src = '/creator_original.jpg';
                }}
              />
            </div>
            <div className="relative inline-block">
              <img
                src="https://i.ibb.co/Z1kLzPNK/IMG-20260825-155612.jpg"
                data-page-url="https://ibb.co/WpYxvwsF"
                alt="Creator Photo 2"
                className="w-[120px] h-[120px] rounded-full object-cover border-2 border-indigo-500/60 shadow-lg shadow-indigo-950/40"
                referrerPolicy="no-referrer"
                onError={(e) => {
                  // Fallback to local copy if network/CORS blocks external cdn
                  e.currentTarget.src = '/creator_photo_2.jpg';
                }}
              />
            </div>
          </div>
          <span className="text-sm font-semibold text-slate-200 tracking-wide">
            Creator & Lead Developer
          </span>
          <p className="text-xs text-slate-400 mt-1">
            Designed & Engineered with ❤️ in Simraungadh, Nepal
          </p>
        </div>

        {/* Bottom Bar */}
        <div className="pt-4 text-center text-xs text-slate-500 border-t border-slate-900 flex flex-col sm:flex-row items-center justify-between gap-2">
          <p>© 2026 AutoCaptionX. All rights reserved.</p>
          <p className="text-[11px]">Crafted for creators worldwide • Nepal (simraungadh)</p>
        </div>

      </div>
    </footer>
  );
};
