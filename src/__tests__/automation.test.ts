import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DesktopAutomationService } from '../main/services/automation/desktop';
import { BrowserAutomationService } from '../main/services/automation/browser';

describe('Desktop and Browser Automation Services', () => {
  describe('DesktopAutomationService', () => {
    let service: DesktopAutomationService;

    beforeEach(() => {
      service = DesktopAutomationService.getInstance();
      service.resetEmergencyStop();
    });

    it('should be a singleton', () => {
      const another = DesktopAutomationService.getInstance();
      expect(service).toBe(another);
    });

    it('should trigger and reset emergency stop', async () => {
      expect(service.isStopped()).toBe(false);
      service.triggerEmergencyStop();
      expect(service.isStopped()).toBe(true);

      // Actions should throw when emergency stop is active
      await expect(
        service.mouseAction({ action: 'move', x: 100, y: 100 })
      ).rejects.toThrow('kill-switch');

      service.resetEmergencyStop();
      expect(service.isStopped()).toBe(false);
    });

    it('should validate mouse parameters', async () => {
      await expect(
        service.mouseAction({ action: 'move' as any })
      ).rejects.toThrow('coordinates required');

      await expect(
        service.mouseAction({ action: 'drag', x: 0, y: 0, to_x: 100 })
      ).rejects.toThrow('all required for mouse drag');
    });

    it('should validate keyboard parameters', async () => {
      await expect(
        service.keyboardAction({ action: 'type' })
      ).rejects.toThrow('text is required');

      await expect(
        service.keyboardAction({ action: 'key_press' })
      ).rejects.toThrow('key is required');

      await expect(
        service.keyboardAction({ action: 'hotkey' })
      ).rejects.toThrow('keys array is required');
    });
  });

  describe('BrowserAutomationService', () => {
    let browserService: BrowserAutomationService;

    beforeEach(() => {
      browserService = BrowserAutomationService.getInstance();
    });

    it('should be a singleton', () => {
      const another = BrowserAutomationService.getInstance();
      expect(browserService).toBe(another);
    });

    it('should return empty log summary when no session is active', () => {
      const logs = browserService.getLogs();
      expect(logs.totalErrors).toBe(0);
      expect(logs.errors).toEqual([]);
      expect(logs.networkErrors).toEqual([]);
      expect(logs.summary).toContain('0 issue(s)');
    });

    it('should gracefully handle close when no window is active', () => {
      const res = browserService.close();
      expect(res).toBe('No active browser window to close.');
    });

    it('should reject interact when no browser is open', async () => {
      await expect(
        browserService.interact({ action: 'click', selector: 'button' })
      ).rejects.toThrow('Call browser_open first');
    });
  });
});
