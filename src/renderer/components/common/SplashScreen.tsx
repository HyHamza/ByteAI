import React, { useEffect, useState } from 'react';

interface SplashScreenProps {
  isReady: boolean;
  onFinish?: () => void;
  statusText?: string;
}

export const SplashScreen: React.FC<SplashScreenProps> = ({
  isReady,
  onFinish,
  statusText = 'Starting Byte AI...',
}) => {
  const [minTimeElapsed, setMinTimeElapsed] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  // Guarantee splash stays visible for at least 850ms so startup feels intentional, polished, and smooth
  useEffect(() => {
    const timer = setTimeout(() => {
      setMinTimeElapsed(true);
    }, 850);
    return () => clearTimeout(timer);
  }, []);

  // When both minimum time has elapsed and app is ready, trigger fade out
  useEffect(() => {
    if (minTimeElapsed && isReady) {
      const fadeTimer = setTimeout(() => {
        setIsVisible(false);
        onFinish?.();
      }, 400); // Allow fade-out animation to complete
      return () => clearTimeout(fadeTimer);
    }
  }, [minTimeElapsed, isReady, onFinish]);

  if (!isVisible) return null;

  const isFading = minTimeElapsed && isReady;

  return (
    <div
      className={`fixed inset-0 z-[99999] bg-[#131314] flex flex-col items-center justify-center select-none transition-all duration-400 ease-out ${
        isFading ? 'opacity-0 scale-98 pointer-events-none' : 'opacity-100 scale-100'
      }`}
    >
      {/* Background Radial Glow */}
      <div className="absolute w-96 h-96 rounded-full bg-gradient-to-tr from-purple-600/15 via-rose-500/10 to-cyan-500/15 blur-3xl pointer-events-none animate-pulse" />

      {/* Main Logo Card */}
      <div className="relative flex flex-col items-center z-10">
        <div className="relative mb-5 flex items-center justify-center">
          {/* Outer glow ring */}
          <div className="absolute inset-0 rounded-full bg-gradient-to-r from-rose-500/30 via-purple-500/30 to-blue-500/30 blur-xl scale-125 animate-pulse" />
          
          {/* Logo container */}
          <div className="relative w-28 h-28 rounded-3xl bg-[#1a1a1c]/80 border border-white/10 shadow-2xl flex items-center justify-center backdrop-blur-md overflow-hidden p-3.5 group">
            <img
              src="/logo.png"
              alt="Byte Logo"
              className="w-full h-full object-contain filter drop-shadow-[0_4px_12px_rgba(236,72,153,0.3)] transition-transform duration-700 ease-in-out group-hover:scale-105"
            />
          </div>
        </div>

        {/* Brand Title */}
        <h1 className="text-2xl font-bold tracking-tight text-white mb-1.5 flex items-center space-x-2">
          <span>Byte</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 border border-white/15 text-neutral-300 font-mono font-medium">
            AI
          </span>
        </h1>

        <p className="text-xs text-neutral-400 tracking-wide font-medium mb-6">
          Autonomous Lead Engineer & Pairing Partner
        </p>

        {/* Loading Progress Bar */}
        <div className="w-48 h-1 bg-white/10 rounded-full overflow-hidden mb-3 relative">
          <div className="h-full w-2/5 bg-gradient-to-r from-rose-500 via-purple-500 to-cyan-400 rounded-full animate-shimmer-fast" />
        </div>

        {/* Dynamic Status Text */}
        <span className="text-[11px] font-mono text-neutral-500 transition-all duration-200">
          {statusText}
        </span>
      </div>

      {/* Pinned Bottom Version */}
      <div className="absolute bottom-6 text-[10px] text-neutral-600 font-mono">
        v1.0.0 • Senior Engineer Orchestrator
      </div>
    </div>
  );
};
