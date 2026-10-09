import { useState, useRef, useEffect, useCallback } from 'react';

interface VoiceDictationOptions {
  onFinalTranscript?: (text: string) => void;
  onInterimTranscript?: (text: string) => void;
  lang?: string;
}

export function useVoiceDictation(options: VoiceDictationOptions = {}) {
  const { onFinalTranscript, onInterimTranscript, lang = 'en-US' } = options;

  const [isListening, setIsListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0); // 0 to 100 for live visualizer
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const recognitionRef = useRef<any>(null);
  const isListeningRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);

  const isSupported = typeof window !== 'undefined' && 
    Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);

  const stopListening = useCallback(() => {
    isListeningRef.current = false;
    setIsListening(false);
    setInterimText('');
    setAudioLevel(0);

    // Stop recognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (_) {}
      recognitionRef.current = null;
    }

    // Stop audio stream and context
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }

    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
  }, []);

  const startListening = useCallback(async () => {
    setError(null);
    setInterimText('');

    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognitionClass) {
      setError('Voice recognition is not supported in this environment.');
      return;
    }

    try {
      // 1. Request microphone access for audio visualization & verify device access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      // 2. Setup audio analysis for live waveform visualization
      try {
        const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioCtx) {
          const audioCtx = new AudioCtx();
          audioContextRef.current = audioCtx;
          const source = audioCtx.createMediaStreamSource(stream);
          const analyser = audioCtx.createAnalyser();
          analyser.fftSize = 64;
          source.connect(analyser);

          const dataArray = new Uint8Array(analyser.frequencyBinCount);
          const updateAudioLevel = () => {
            if (!isListeningRef.current) return;
            analyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < dataArray.length; i++) {
              sum += dataArray[i];
            }
            const average = sum / dataArray.length;
            const normalized = Math.min(100, Math.round((average / 128) * 100));
            setAudioLevel(normalized);
            animFrameRef.current = requestAnimationFrame(updateAudioLevel);
          };
          animFrameRef.current = requestAnimationFrame(updateAudioLevel);
        }
      } catch (audioErr) {
        console.warn('AudioContext visualization setup note:', audioErr);
      }

      // 3. Initialize SpeechRecognition instance with real-time streaming
      const recognition = new SpeechRecognitionClass();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = lang || navigator.language || 'en-US';
      recognition.maxAlternatives = 1;

      recognition.onstart = () => {
        isListeningRef.current = true;
        setIsListening(true);
        setError(null);
      };

      recognition.onresult = (event: any) => {
        let currentInterim = '';

        for (let i = event.resultIndex; i < event.results.length; ++i) {
          const transcriptChunk = event.results[i][0]?.transcript || '';
          if (event.results[i].isFinal) {
            if (transcriptChunk.trim()) {
              onFinalTranscript?.(transcriptChunk);
            }
          } else {
            currentInterim += transcriptChunk;
          }
        }

        setInterimText(currentInterim);
        onInterimTranscript?.(currentInterim);
      };

      recognition.onerror = (event: any) => {
        if (event.error === 'no-speech') {
          // Normal silence, keep listening
          return;
        }
        if (event.error === 'not-allowed') {
          setError('Microphone access was denied. Please allow microphone permissions.');
          stopListening();
        } else if (event.error === 'network') {
          setError('Network issue connecting to speech recognition service.');
        } else {
          console.warn('SpeechRecognition error:', event.error);
        }
      };

      recognition.onend = () => {
        // If still supposed to be listening, restart (browser sometimes terminates on silence)
        if (isListeningRef.current) {
          try {
            recognition.start();
          } catch (_) {
            stopListening();
          }
        } else {
          stopListening();
        }
      };

      recognitionRef.current = recognition;
      recognition.start();
    } catch (err: any) {
      console.error('Failed to start microphone speech recognition:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('Microphone permission denied. Please allow microphone in settings.');
      } else {
        setError(`Microphone error: ${err.message || 'Unable to access microphone'}`);
      }
      stopListening();
    }
  }, [lang, onFinalTranscript, onInterimTranscript, stopListening]);

  const toggleListening = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
  }, [isListening, startListening, stopListening]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopListening();
    };
  }, [stopListening]);

  return {
    isListening,
    isSupported,
    audioLevel,
    interimText,
    error,
    startListening,
    stopListening,
    toggleListening,
  };
}
