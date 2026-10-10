import React, { useState, useEffect, useRef } from 'react';
import { 
  X, 
  ZoomIn, 
  ZoomOut, 
  RotateCcw, 
  Download, 
  Copy, 
  Check, 
  Maximize2,
  FileImage
} from 'lucide-react';

export interface ImagePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl: string;
  imageName?: string;
  imageSize?: number;
}

export const ImagePreviewModal: React.FC<ImagePreviewModalProps> = ({
  isOpen,
  onClose,
  imageUrl,
  imageName = 'Screenshot',
  imageSize,
}) => {
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const [copied, setCopied] = useState(false);

  // Reset zoom & pan when image changes or modal opens
  useEffect(() => {
    if (isOpen) {
      setScale(1);
      setPosition({ x: 0, y: 0 });
      setIsDragging(false);
      setCopied(false);
    }
  }, [isOpen, imageUrl]);

  // Keyboard navigation: Escape to close, + / - to zoom, 0 to reset
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === '+' || e.key === '=') {
        e.preventDefault();
        setScale((prev) => Math.min(5, Number((prev + 0.25).toFixed(2))));
      } else if (e.key === '-') {
        e.preventDefault();
        setScale((prev) => Math.max(0.2, Number((prev - 0.25).toFixed(2))));
      } else if (e.key === '0') {
        e.preventDefault();
        setScale(1);
        setPosition({ x: 0, y: 0 });
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen || !imageUrl) return null;

  const handleZoomIn = () => {
    setScale((prev) => Math.min(5, Number((prev + 0.25).toFixed(2))));
  };

  const handleZoomOut = () => {
    setScale((prev) => Math.max(0.2, Number((prev - 0.25).toFixed(2))));
  };

  const handleResetZoom = () => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  };

  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const delta = e.deltaY < 0 ? 0.15 : -0.15;
    setScale((prev) => Math.max(0.2, Math.min(5, Number((prev + delta).toFixed(2)))));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left-click
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y,
    };
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setPosition({
      x: e.clientX - dragStartRef.current.x,
      y: e.clientY - dragStartRef.current.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleDoubleClick = () => {
    if (scale !== 1) {
      handleResetZoom();
    } else {
      setScale(2);
    }
  };

  const handleCopyImage = async () => {
    try {
      // 1. Try Electron native clipboard API first
      if (window.electronAPI?.copyImageToClipboard) {
        const success = await window.electronAPI.copyImageToClipboard({ imageUrl });
        if (success) {
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
          return;
        }
      }

      // 2. Fallback: Draw image to an off-screen HTML5 Canvas and convert to PNG Blob
      // Standard ClipboardItem requires 'image/png' format
      await new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth || img.width;
            canvas.height = img.naturalHeight || img.height;
            const ctx = canvas.getContext('2d');
            if (!ctx) {
              reject(new Error('Canvas 2D context not available'));
              return;
            }
            ctx.drawImage(img, 0, 0);
            canvas.toBlob(async (blob) => {
              if (blob) {
                try {
                  await navigator.clipboard.write([
                    new ClipboardItem({ 'image/png': blob }),
                  ]);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                  resolve();
                } catch (writeErr) {
                  reject(writeErr);
                }
              } else {
                reject(new Error('Canvas blob generation failed'));
              }
            }, 'image/png');
          } catch (canvasErr) {
            reject(canvasErr);
          }
        };
        img.onerror = () => reject(new Error('Failed loading image for clipboard copy'));
        img.src = imageUrl;
      });
    } catch (err) {
      console.warn('Failed copying image to clipboard:', err);
    }
  };

  const handleDownloadImage = () => {
    const a = document.createElement('a');
    a.href = imageUrl;
    a.download = imageName || 'screenshot.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  };

  return (
    <div 
      className="fixed inset-0 z-50 bg-black/90 backdrop-blur-md flex flex-col select-none animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      {/* Top Header Bar */}
      <div className="h-14 px-6 flex items-center justify-between border-b border-white/10 bg-[#121316]/90 shrink-0 z-10">
        <div className="flex items-center space-x-3 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-sky-500/15 border border-sky-500/30 flex items-center justify-center shrink-0">
            <FileImage className="w-4 h-4 text-sky-400" />
          </div>
          <div className="flex flex-col min-w-0">
            <span className="text-sm font-semibold text-white truncate max-w-md">{imageName}</span>
            {imageSize && (
              <span className="text-[11px] text-zinc-400 font-mono">
                {Math.max(1, Math.round(imageSize / 1024))} KB
              </span>
            )}
          </div>
        </div>

        {/* Floating Zoom and Action Controls */}
        <div className="flex items-center space-x-2">
          {/* Zoom controls */}
          <div className="flex items-center bg-[#1e2024] border border-white/10 rounded-full px-2 py-1 space-x-1 shadow-lg">
            <button
              type="button"
              onClick={handleZoomOut}
              className="p-1 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title="Zoom out (-)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-xs font-mono text-zinc-300 px-2 min-w-[50px] text-center font-medium">
              {Math.round(scale * 100)}%
            </span>
            <button
              type="button"
              onClick={handleZoomIn}
              className="p-1 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
              title="Zoom in (+)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleResetZoom}
              className="p-1 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-colors ml-1 cursor-pointer"
              title="Reset Zoom (0)"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Action buttons */}
          <button
            type="button"
            onClick={handleCopyImage}
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-[#1e2024] hover:bg-white/10 border border-white/10 text-xs text-zinc-300 hover:text-white transition-colors cursor-pointer"
            title="Copy Image"
          >
            {copied ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-400" />
                <span className="text-emerald-400">Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5" />
                <span>Copy</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleDownloadImage}
            className="p-2 rounded-full bg-[#1e2024] hover:bg-white/10 border border-white/10 text-zinc-300 hover:text-white transition-colors cursor-pointer"
            title="Download Image"
          >
            <Download className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full bg-[#1e2024] hover:bg-red-500/20 hover:text-red-400 border border-white/10 text-zinc-300 transition-colors cursor-pointer ml-2"
            title="Close (Esc)"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Main Viewport Container */}
      <div 
        className="flex-1 relative overflow-hidden flex items-center justify-center cursor-default p-4"
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onDoubleClick={handleDoubleClick}
      >
        <img
          src={imageUrl}
          alt={imageName}
          draggable={false}
          style={{
            transform: `translate(${position.x}px, ${position.y}px) scale(${scale})`,
            transition: isDragging ? 'none' : 'transform 0.15s ease-out',
            cursor: scale > 1 ? (isDragging ? 'grabbing' : 'grab') : 'zoom-in',
          }}
          className="max-h-[85vh] max-w-[85vw] object-contain rounded-lg shadow-2xl pointer-events-auto"
        />

        {/* Bottom Hint */}
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-black/60 border border-white/10 text-[11px] text-zinc-400 backdrop-blur-md pointer-events-none">
          Scroll to zoom • Double click to toggle • Drag to pan when zoomed
        </div>
      </div>
    </div>
  );
};
