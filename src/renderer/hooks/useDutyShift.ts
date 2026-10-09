import { useState, useEffect, useCallback } from 'react';
import type { DutyShift } from '@/shared/types';
import { api } from '../api';

function formatRemainingTime(targetEndAt: number): string {
  const diff = targetEndAt - Date.now();
  if (diff <= 0) return '0m';

  const totalSeconds = Math.floor(diff / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export function useDutyShift(sessionId?: string) {
  const [activeShift, setActiveShift] = useState<DutyShift | null>(null);
  const [remainingTimeDisplay, setRemainingTimeDisplay] = useState<string>('');

  const refreshActiveShift = useCallback(async () => {
    try {
      const shift = await api.getActiveDutyShift(sessionId);
      setActiveShift(shift);
      if (shift && shift.status === 'active') {
        setRemainingTimeDisplay(formatRemainingTime(shift.targetEndAt));
      } else {
        setRemainingTimeDisplay('');
      }
    } catch (_) {}
  }, [sessionId]);

  useEffect(() => {
    refreshActiveShift();

    const unsubscribe = api.onDutyShiftUpdated((updatedShift) => {
      if (!updatedShift || updatedShift.status === 'stopped' || updatedShift.status === 'completed') {
        if (!sessionId || updatedShift?.sessionId === sessionId) {
          setActiveShift(null);
          setRemainingTimeDisplay('');
        }
      } else {
        if (!sessionId || updatedShift.sessionId === sessionId) {
          setActiveShift(updatedShift);
          setRemainingTimeDisplay(formatRemainingTime(updatedShift.targetEndAt));
        }
      }
    });

    return () => {
      unsubscribe();
    };
  }, [sessionId, refreshActiveShift]);

  // High-frequency 1-second ticker for remaining countdown
  useEffect(() => {
    if (!activeShift || activeShift.status !== 'active') return;

    const interval = setInterval(() => {
      const formatted = formatRemainingTime(activeShift.targetEndAt);
      setRemainingTimeDisplay(formatted);

      if (Date.now() >= activeShift.targetEndAt) {
        refreshActiveShift();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [activeShift, refreshActiveShift]);

  const startShift = useCallback(async (sessId: string, missionPrompt: string, hours: number) => {
    const shift = await api.startDutyShift(sessId, missionPrompt, hours);
    setActiveShift(shift);
    return shift;
  }, []);

  const stopShift = useCallback(async (shiftId?: string) => {
    const id = shiftId || activeShift?.id;
    if (!id) return;
    await api.stopDutyShift(id);
    setActiveShift(null);
    setRemainingTimeDisplay('');
  }, [activeShift]);

  const pauseShift = useCallback(async (shiftId?: string) => {
    const id = shiftId || activeShift?.id;
    if (!id) return;
    await api.pauseDutyShift(id);
    refreshActiveShift();
  }, [activeShift, refreshActiveShift]);

  const resumeShift = useCallback(async (shiftId?: string) => {
    const id = shiftId || activeShift?.id;
    if (!id) return;
    await api.resumeDutyShift(id);
    refreshActiveShift();
  }, [activeShift, refreshActiveShift]);

  return {
    activeShift,
    remainingTimeDisplay,
    startShift,
    stopShift,
    pauseShift,
    resumeShift,
    refreshActiveShift,
  };
}
