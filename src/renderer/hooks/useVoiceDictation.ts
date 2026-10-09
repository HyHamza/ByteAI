import { useState, useRef, useEffect, useCallback } from 'react';
import { api } from '../api';

interface VoiceDictationOptions {
  onFinalTranscript?: (text: string) => void;
  onInterimTranscript?: (text: string) => void;
  lang?: string;
}

export function useVoiceDictation(options: VoiceDictationOptions = {}) {
  const { onFinalTranscript, onInterimTranscript } = options;

  const [isListening, setIsListening] = useState(false);
  const [audioLevel, setAudioLevel] = useState(0); // 0 to 100 for live visualizer
  const [interimText, setInterimText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const isListeningRef = useRef(false);
  const isTranscribingRef = useRef(false);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const audioContextRef = useRef<AudioContext | null>(null);
  const animFrameRef = useRef<number | null>(null);
  const hasSpokenRef = useRef(false);
  const lastSpokenTimeRef = useRef(0);
  const silenceTimerRef = useRef<any>(null);

  const isSupported = typeof window !== 'undefined' && 
    typeof navigator !== 'undefined' && 
    Boolean(navigator.mediaDevices) && 
    typeof window.MediaRecorder !== 'undefined';

  const transcribeCurrentAudio = useCallback(async (blob: Blob) => {
    if (!blob || blob.size < 1000) return;
    if (!api.transcribeAudio) return;

    try {
      isTranscribingRef.current = true;
      setInterimText('Transcribing with Whisper...');
      onInterimTranscript?.('Transcribing with Whisper...');

      const arrayBuffer = await blob.arrayBuffer();
      const res = await api.transcribeAudio(arrayBuffer, blob.type || 'audio/webm');

      if (res.error) {
        setError(res.error);
      } else if (res.text && res.text.trim()) {
        const cleaned = res.text.trim();
        onFinalTranscript?.(cleaned);
        setError(null);
      }
    } catch (err: any) {
      console.error('Groq Whisper transcription error:', err);
      setError(`Transcription error: ${err.message || 'Failed to process audio'}`);
    } finally {
      isTranscribingRef.current = false;
      setInterimText('');
      onInterimTranscript?.('');
    }
  }, [onFinalTranscript, onInterimTranscript]);

  const stopListening = useCallback(async () => {
    if (!isListeningRef.current) return;
    isListeningRef.current = false;
    setIsListening(false);
    setAudioLevel(0);

    if (silenceTimerRef.current) {
      clearInterval(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }

    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = null;
    }

    // Stop MediaRecorder and trigger final transcription
    const recorder = mediaRecorderRef.current;
    if (recorder && recorder.state !== 'inactive') {
      try {
        recorder.requestData();
        recorder.stop();
      } catch (_) {}
    }
    mediaRecorderRef.current = null;

    // Stop microphone tracks
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
    audioChunksRef.current = [];
    hasSpokenRef.current = false;
    lastSpokenTimeRef.current = 0;

    if (!isSupported) {
      setError('Microphone audio recording is not supported in this environment.');
      return;
    }

    try {
      // 1. Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: {
          channelCount: 1,
          sampleRate: 16000,
          echoCancellation: true,
          noiseSuppression: true,
        }
      });
      mediaStreamRef.current = stream;

      // 2. Setup AudioContext for live 60fps waveform animation and VAD silence tracking
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

            if (normalized > 14) {
              hasSpokenRef.current = true;
              lastSpokenTimeRef.current = Date.now();
            }

            animFrameRef.current = requestAnimationFrame(updateAudioLevel);
          };
          animFrameRef.current = requestAnimationFrame(updateAudioLevel);
        }
      } catch (audioErr) {
        console.warn('AudioContext visualization setup note:', audioErr);
      }

      // 3. Setup MediaRecorder
      let mimeType = 'audio/webm;codecs=opus';
      if (!MediaRecorder.isTypeSupported(mimeType)) {
        mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : '';
      }

      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = () => {
        if (audioChunksRef.current.length > 0) {
          const recordedBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
          audioChunksRef.current = [];
          if (hasSpokenRef.current || recordedBlob.size > 2000) {
            transcribeCurrentAudio(recordedBlob);
          }
        }
      };

      recorder.start(500); // chunk every 500ms
      isListeningRef.current = true;
      setIsListening(true);

      // 4. Auto-detect silence after speech (1.5 seconds of silence automatically commits transcription)
      silenceTimerRef.current = setInterval(() => {
        if (!isListeningRef.current || isTranscribingRef.current) return;
        if (hasSpokenRef.current && lastSpokenTimeRef.current > 0) {
          const elapsedSinceSpeech = Date.now() - lastSpokenTimeRef.current;
          if (elapsedSinceSpeech > 1500 && audioChunksRef.current.length > 0) {
            // Snapshot current audio and transcribe
            recorder.requestData();
            setTimeout(() => {
              if (audioChunksRef.current.length > 0) {
                const recordedBlob = new Blob(audioChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
                audioChunksRef.current = [];
                hasSpokenRef.current = false;
                lastSpokenTimeRef.current = 0;
                transcribeCurrentAudio(recordedBlob);
              }
            }, 100);
          }
        }
      }, 300);

    } catch (err: any) {
      console.error('Failed to access microphone:', err);
      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        setError('Microphone access was denied. Please allow microphone permissions.');
      } else {
        setError(`Microphone error: ${err.message || 'Unable to access microphone'}`);
      }
      stopListening();
    }
  }, [isSupported, stopListening, transcribeCurrentAudio]);

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
