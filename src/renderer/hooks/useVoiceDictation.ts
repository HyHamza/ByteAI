import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../api';

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

  const isListeningRef = useRef(false);
  const audioContextRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const recognitionRef = useRef<any>(null);
  const unsubscribersRef = useRef<Array<() => void>>([]);

  const isNativeSupported = typeof window !== 'undefined' && Boolean((window as any).electronAPI?.startSpeech);
  const isWebSpeechSupported = typeof window !== 'undefined' && Boolean((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition);
  const isSupported = isNativeSupported || isWebSpeechSupported;

  const stopListening = useCallback(() => {
    isListeningRef.current = false;
    setIsListening(false);
    setInterimText('');
    setAudioLevel(0);

    // Unsubscribe native listeners
    unsubscribersRef.current.forEach((unsub) => {
      try {
        unsub();
      } catch (_) {}
    });
    unsubscribersRef.current = [];

    // Stop native speech engine
    if (isNativeSupported && api.stopSpeech) {
      api.stopSpeech().catch(() => {});
    }

    // Stop browser web speech fallback
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch (_) {}
      recognitionRef.current = null;
    }

    // Stop audio stream and visualizer context
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
  }, [isNativeSupported]);

  const startListening = useCallback(async () => {
    setError(null);
    setInterimText('');

    if (!isSupported) {
      setError('Voice recognition is not supported on this platform.');
      return;
    }

    // 1. Setup audio analyser for live waveform bars
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

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
    } catch (micErr: any) {
      console.warn('Microphone stream access note:', micErr);
      if (micErr.name === 'NotAllowedError' || micErr.name === 'PermissionDeniedError') {
        setError('Microphone access was denied. Please allow microphone permissions.');
        return;
      }
    }

    // 2. Prefer Native Electron Speech Engine (Windows native / offline / real-time streaming)
    if (isNativeSupported && api.startSpeech) {
      isListeningRef.current = true;
      setIsListening(true);

      const unsubs: Array<() => void> = [];

      if (api.onSpeechInterim) {
        unsubs.push(
          api.onSpeechInterim(({ text }) => {
            setInterimText(text);
            onInterimTranscript?.(text);
          })
        );
      }

      if (api.onSpeechFinal) {
        unsubs.push(
          api.onSpeechFinal(({ text }) => {
            if (text && text.trim()) {
              onFinalTranscript?.(text.trim());
            }
            setInterimText('');
          })
        );
      }

      if (api.onSpeechStatus) {
        unsubs.push(
          api.onSpeechStatus((status) => {
            if (!status.isListening && isListeningRef.current) {
              stopListening();
            }
            if (status.error) {
              setError(status.error);
            }
          })
        );
      }

      if (api.onSpeechError) {
        unsubs.push(
          api.onSpeechError(({ error: errText }) => {
            setError(errText);
            stopListening();
          })
        );
      }

      unsubscribersRef.current = unsubs;

      const res = await api.startSpeech(lang);
      if (!res.success) {
        setError(res.error || 'Failed to start native speech recognizer');
        stopListening();
      }
      return;
    }

    // 3. Web Speech Fallback (if running outside Electron)
    const SpeechRecognitionClass = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognitionClass) {
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
          const chunk = event.results[i][0]?.transcript || '';
          if (event.results[i].isFinal) {
            if (chunk.trim()) onFinalTranscript?.(chunk);
          } else {
            currentInterim += chunk;
          }
        }
        setInterimText(currentInterim);
        onInterimTranscript?.(currentInterim);
      };

      recognition.onerror = (event: any) => {
        if (event.error === 'no-speech') return;
        if (event.error === 'not-allowed') {
          setError('Microphone permission denied.');
        } else if (event.error === 'network') {
          setError('Speech service unavailable in browser.');
        } else {
          setError(`Speech error: ${event.error}`);
        }
        stopListening();
      };

      recognition.onend = () => {
        stopListening();
      };

      recognitionRef.current = recognition;
      try {
        recognition.start();
      } catch (err: any) {
        setError(err.message || 'Failed to start browser recognition');
        stopListening();
      }
    }
  }, [lang, isNativeSupported, isSupported, onFinalTranscript, onInterimTranscript, stopListening]);

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
