import { render, waitFor, act } from '@testing-library/react';
import React, { useEffect, useState } from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import App from '../renderer/App';
import { api } from '../renderer/api';

// Mock the API responses
vi.mock('../renderer/api', () => ({
  api: {
    getSettings: vi.fn().mockResolvedValue({
      mode: 'standard',
      theme: 'obsidian',
      selectedModel: 'test',
      activeWorkspacePath: '/test'
    }),
    getWorkspaceInfo: vi.fn().mockResolvedValue({
      name: 'test-workspace',
      path: '/test'
    }),
    listSessions: vi.fn().mockResolvedValue([]),
    createSession: vi.fn().mockResolvedValue({ id: 'test-session', messages: [] }),
    getProjects: vi.fn().mockResolvedValue([]),
    getAvailableModels: vi.fn().mockResolvedValue(['test-model']),
    onStreamToken: vi.fn().mockReturnValue(() => {}),
    onToolCallUpdate: vi.fn().mockReturnValue(() => {}),
    onExecutionCompleted: vi.fn().mockReturnValue(() => {}),
    onAgentStatus: vi.fn().mockReturnValue(() => {}),
    onJulesAllSessions: vi.fn().mockReturnValue(() => {}),
    onSessionsUpdated: vi.fn().mockReturnValue(() => {}),
    saveSettings: vi.fn().mockResolvedValue(true),
    getActiveDutyShift: vi.fn().mockResolvedValue(null),
    onDutyShiftUpdated: vi.fn().mockReturnValue(() => {}),
  }
}));

// We have a ResizeObserver in the app components
global.ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};

describe('Theme Test', () => {
  beforeEach(() => {
    document.body.className = '';
    vi.clearAllMocks();
  });

  it('should toggle theme-white class on body when settings change', async () => {
    const { rerender } = render(<App />);

    // Wait for the app to load with default obsidian
    await waitFor(() => {
      expect(document.body.classList.contains('theme-white')).toBe(false);
    });

    // Update the mock to return whiteTheme and re-render to trigger useEffect
    api.getSettings = vi.fn().mockResolvedValue({
      mode: 'standard',
      theme: 'whiteTheme',
      selectedModel: 'test',
      activeWorkspacePath: '/test'
    });

    // We can simulate an App remount or re-render which calls getSettings in useEffect
    rerender(<App key="force-remount" />);

    await waitFor(() => {
      expect(document.body.classList.contains('theme-white')).toBe(true);
    });
  });
});
