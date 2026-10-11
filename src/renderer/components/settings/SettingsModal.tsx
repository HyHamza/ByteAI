import React, { useState, useEffect } from 'react';
import { 
  X, 
  Save, 
  Globe, 
  Sparkles, 
  Sliders, 
  Mic, 
  Eye, 
  EyeOff, 
  Check, 
  Loader2, 
  Folder, 
  FolderGit2, 
  Cpu, 
  Palette, 
  ShieldCheck, 
  Terminal, 
  ExternalLink,
  Trash2,
  Plus,
  Zap
} from 'lucide-react';
import type { AppSettings, ProjectInfo } from '@/shared/types';
import { api } from '../../api';

interface SettingsModalProps {
  settings: AppSettings;
  isOpen: boolean;
  onClose: () => void;
  onSave: (settings: Partial<AppSettings>) => void | Promise<void>;
  projects?: ProjectInfo[];
  availableModels?: string[];
  activeWorkspacePath?: string | null;
  onSelectProject?: (path: string) => void;
  onDeleteProject?: (path: string) => void;
  onAddProject?: () => void;
}

type SettingsTab = 'general' | 'models' | 'voice' | 'jules' | 'appearance' | `project_${string}`;

export const SettingsModal: React.FC<SettingsModalProps> = ({
  settings,
  isOpen,
  onClose,
  onSave,
  projects = [],
  availableModels = [],
  activeWorkspacePath,
  onSelectProject,
  onDeleteProject,
  onAddProject,
}) => {
  const [form, setForm] = useState<AppSettings>({ ...settings });
  const [activeTab, setActiveTab] = useState<SettingsTab>('general');
  const [showApiKey, setShowApiKey] = useState(false);
  const [showJulesKey, setShowJulesKey] = useState(false);
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedSuccess, setSavedSuccess] = useState(false);
  const [testEndpointStatus, setTestEndpointStatus] = useState<'idle' | 'testing' | 'success' | 'error'>('idle');
  const [testEndpointMsg, setTestEndpointMsg] = useState('');
  const [isMicTesting, setIsMicTesting] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  // Sync form with fresh settings from the local database whenever modal opens
  useEffect(() => {
    if (isOpen) {
      setSavedSuccess(false);
      setTestEndpointStatus('idle');
      api.getSettings().then((latest) => {
        if (latest) {
          setForm({ ...latest });
        }
      }).catch(() => {
        setForm({ ...settings });
      });
    } else {
      setIsMicTesting(false);
    }
  }, [isOpen, settings]);

  // Microphone tester logic
  useEffect(() => {
    if (!isMicTesting) {
      setMicLevel(0);
      return;
    }

    let stream: MediaStream | null = null;
    let audioCtx: AudioContext | null = null;
    let animId: number | null = null;

    navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => {
      stream = s;
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;
      audioCtx = new AudioContextClass();
      const source = audioCtx.createMediaStreamSource(s);
      const analyser = audioCtx.createAnalyser();
      analyser.fftSize = 64;
      source.connect(analyser);

      const data = new Uint8Array(analyser.frequencyBinCount);
      const loop = () => {
        analyser.getByteFrequencyData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) sum += data[i];
        const avg = sum / data.length;
        setMicLevel(Math.min(100, Math.round((avg / 128) * 100)));
        animId = requestAnimationFrame(loop);
      };
      animId = requestAnimationFrame(loop);
    }).catch(() => {
      setIsMicTesting(false);
    });

    return () => {
      if (animId) cancelAnimationFrame(animId);
      if (stream) stream.getTracks().forEach((t) => t.stop());
      if (audioCtx && audioCtx.state !== 'closed') audioCtx.close().catch(() => {});
    };
  }, [isMicTesting]);

  if (!isOpen) return null;

  const handleTestEndpoint = async () => {
    setTestEndpointStatus('testing');
    setTestEndpointMsg('');
    try {
      const models = await api.getAvailableModels();
      if (models && models.length > 0) {
        setTestEndpointStatus('success');
        setTestEndpointMsg(`Connected! ${models.length} models available.`);
      } else {
        setTestEndpointStatus('error');
        setTestEndpointMsg('Connected, but returned 0 models.');
      }
    } catch (err: any) {
      setTestEndpointStatus('error');
      setTestEndpointMsg(err.message || 'Connection failed.');
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setSavedSuccess(false);

    try {
      await onSave(form);
      setSavedSuccess(true);
      setTimeout(() => {
        setIsSaving(false);
        onClose();
      }, 700);
    } catch (err) {
      console.error('Failed to save settings:', err);
      setIsSaving(false);
    }
  };

  // Find active project if a project tab is selected
  const selectedProject = activeTab.startsWith('project_')
    ? projects.find((p) => p.id === activeTab.replace('project_', ''))
    : null;

  return (
    <div className="fixed inset-0 bg-black/75 backdrop-blur-xs z-50 flex items-center justify-center p-4 select-none">
      <div className="bg-[var(--bg-sidebar)] border border-[var(--border-card)] rounded-2xl w-full max-w-4xl h-[620px] shadow-2xl overflow-hidden flex flex-col text-xs text-[var(--text-primary)]">
        
        {/* Modal Main Area: Left Sidebar + Right Content */}
        <div className="flex flex-1 overflow-hidden">
          
          {/* Left Navigation Sidebar */}
          <div className="w-56 bg-[var(--bg-sidebar)] border-r border-[var(--border-subtle)] flex flex-col justify-between py-4 select-none">
            <div className="flex flex-col space-y-4 px-2 overflow-y-auto">
              {/* Brand Header */}
              <div className="px-3 pb-3 pt-1 border-b border-[var(--border-subtle)] flex items-center space-x-2.5">
                <div className="w-9 h-9 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center p-1 shrink-0">
                  <img src="/logo-bw.png" alt="Byte" className="w-full h-full object-contain select-none" />
                </div>
                <div>
                  <div className="font-semibold text-sm text-[var(--text-primary)] leading-tight">Byte AI</div>
                  <div className="text-[10px] text-[var(--text-muted)] font-mono">v1.0.0</div>
                </div>
              </div>

              {/* Settings Section */}
              <div>
                <div className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider px-3 mb-1.5">
                  Settings
                </div>
                <div className="space-y-0.5">
                  <button
                    type="button"
                    onClick={() => setActiveTab('general')}
                    className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer text-left ${
                      activeTab === 'general'
                        ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'
                    }`}
                  >
                    <Sliders className="w-4 h-4 text-[#70a6ff]" />
                    <span>General</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('models')}
                    className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer text-left ${
                      activeTab === 'models'
                        ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'
                    }`}
                  >
                    <Cpu className="w-4 h-4 text-[#38bdf8]" />
                    <span>Models & API</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('voice')}
                    className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer text-left ${
                      activeTab === 'voice'
                        ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'
                    }`}
                  >
                    <Mic className="w-4 h-4 text-rose-400" />
                    <span>Voice Dictation</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('jules')}
                    className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer text-left ${
                      activeTab === 'jules'
                        ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'
                    }`}
                  >
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    <span>Jules AI Lead</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('appearance')}
                    className={`w-full flex items-center space-x-2.5 px-3 py-2 rounded-xl text-xs font-medium transition-colors cursor-pointer text-left ${
                      activeTab === 'appearance'
                        ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                        : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'
                    }`}
                  >
                    <Palette className="w-4 h-4 text-purple-400" />
                    <span>Appearance</span>
                  </button>
                </div>
              </div>

              {/* Projects Section (Real projects from user's workspace) */}
              <div>
                <div className="flex items-center justify-between px-3 mb-1.5">
                  <span className="text-[11px] font-semibold text-[var(--text-muted)] uppercase tracking-wider">
                    Projects
                  </span>
                  {onAddProject && (
                    <button
                      type="button"
                      onClick={onAddProject}
                      className="text-[var(--text-muted)] hover:text-[var(--text-primary)] p-0.5 rounded transition-colors cursor-pointer"
                      title="Add folder to projects"
                    >
                      <Plus className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
                <div className="space-y-0.5">
                  {projects.length === 0 ? (
                    <div className="px-3 py-1.5 text-[11px] text-[var(--text-muted)] italic">
                      No saved projects
                    </div>
                  ) : (
                    projects.map((proj) => {
                      const isActiveWs = activeWorkspacePath === proj.path;
                      const isSelected = activeTab === `project_${proj.id}`;
                      return (
                        <button
                          key={proj.id}
                          type="button"
                          onClick={() => setActiveTab(`project_${proj.id}`)}
                          className={`w-full flex items-center justify-between px-3 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer text-left ${
                            isSelected
                              ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                              : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)]'
                          }`}
                        >
                          <div className="flex items-center space-x-2 truncate">
                            <Folder className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
                            <span className="truncate">{proj.name}</span>
                          </div>
                          {isActiveWs && (
                            <span className="w-1.5 h-1.5 rounded-full bg-sky-400 shrink-0 ml-1.5" title="Active Workspace" />
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            </div>

            {/* Bottom Profile Badge (Antigravity Style) */}
            <div className="px-3 pt-3 border-t border-[var(--border-subtle)] flex items-center space-x-2.5">
              <div className="w-7 h-7 rounded-full bg-[var(--bg-surface-hover)] flex items-center justify-center font-bold text-[var(--text-primary)] text-xs shrink-0 shadow-sm">
                {(form.userName || 'H')[0].toUpperCase()}
              </div>
              <div className="min-w-0 flex-1 leading-tight">
                <div className="font-medium text-[var(--text-primary)] text-[11px] truncate">
                  {form.userName || 'Hamza'}
                </div>
                <div className="text-[10px] text-[var(--text-muted)] truncate font-mono">
                  {form.userEmail || 'talkdrove@gmail.com'}
                </div>
              </div>
            </div>
          </div>

          {/* Right Main Content Panel */}
          <div className="flex-1 flex flex-col overflow-hidden bg-[var(--bg-sidebar)]">
            
            {/* Top Header */}
            <div className="px-6 py-4 border-b border-[var(--border-subtle)] flex items-center justify-between shrink-0">
              <div>
                <h2 className="text-base font-semibold text-[var(--text-primary)]">
                  {activeTab === 'general' && 'General'}
                  {activeTab === 'models' && 'Models & API Gateway'}
                  {activeTab === 'voice' && 'Voice Dictation (Groq Whisper AI)'}
                  {activeTab === 'jules' && 'Jules AI Configuration (Senior Lead)'}
                  {activeTab === 'appearance' && 'Appearance & Workspace'}
                  {selectedProject && `Project: ${selectedProject.name}`}
                </h2>
                <p className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                  {activeTab === 'general' && 'Configure agent execution, queued message delivery, and global permissions.'}
                  {activeTab === 'models' && 'Configure your LLM endpoint, API keys, and default reasoning models.'}
                  {activeTab === 'voice' && 'Configure ultra-fast Groq Whisper AI voice transcription.'}
                  {activeTab === 'jules' && 'Configure Google Labs Jules supervisor keys and target repository settings.'}
                  {activeTab === 'appearance' && 'Customize theme styling and workspace layout settings.'}
                  {selectedProject && selectedProject.path}
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                className="p-1.5 rounded-lg text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:bg-[var(--bg-surface)] transition-colors cursor-pointer"
                title="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content Body */}
            <form onSubmit={handleSubmit} className="flex-1 flex flex-col overflow-hidden">
              <div className="flex-1 overflow-y-auto p-6 space-y-6">
                
                {/* Success Banner */}
                {savedSuccess && (
                  <div className="flex items-center space-x-2 text-xs text-emerald-400 bg-emerald-950/40 border border-emerald-800/40 px-3.5 py-2.5 rounded-xl animate-in fade-in duration-150">
                    <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>All settings and keys successfully saved to local SQLite database (~/.seniorengineer/seniorengineer.db)!</span>
                  </div>
                )}

                {/* ─── TAB: GENERAL ─── */}
                {activeTab === 'general' && (
                  <>
                    {/* Execution Section */}
                    <div>
                      <h4 className="text-xs font-semibold text-[var(--text-primary)] mb-2">Execution</h4>
                      <div className="bg-[var(--bg-surface)] border border-[var(--border-card)] rounded-xl p-3.5 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-xs font-medium text-[var(--text-primary)]">Queued Messages</div>
                            <div className="text-[11px] text-[var(--text-secondary)]">Configure how follow-up messages are handled during active runs.</div>
                          </div>
                          <div className="flex items-center bg-[var(--bg-canvas)] border border-[var(--border-card)] rounded-lg p-0.5">
                            <button
                              type="button"
                              onClick={() => setForm({ ...form, queuedMessages: 'queue' })}
                              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                                (form.queuedMessages || 'queue') === 'queue'
                                  ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                              }`}
                            >
                              Queue
                            </button>
                            <button
                              type="button"
                              onClick={() => setForm({ ...form, queuedMessages: 'immediate' })}
                              className={`px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                                form.queuedMessages === 'immediate'
                                  ? 'bg-[var(--bg-surface)] text-[var(--text-primary)] shadow-xs'
                                  : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                              }`}
                            >
                              Send Immediately
                            </button>
                          </div>
                        </div>

                        <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between">
                          <div>
                            <div className="text-xs font-medium text-[var(--text-primary)]">Max Autonomous Turns</div>
                            <div className="text-[11px] text-[var(--text-secondary)]">Safety limit before requiring human review or check-in.</div>
                          </div>
                          <input
                            type="number"
                            value={form.maxAutonomousTurns || 50}
                            onChange={(e) => setForm({ ...form, maxAutonomousTurns: Number(e.target.value) || 50 })}
                            min={5}
                            max={200}
                            className="w-20 bg-[var(--bg-surface)] border border-[var(--border-card)] rounded-lg px-2.5 py-1 text-center text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-subtle)] font-mono text-xs"
                          />
                        </div>
                      </div>
                    </div>

                    {/* Global Permissions */}
                    <div>
                      <h4 className="text-xs font-semibold text-[var(--text-primary)] mb-2">Global Permissions</h4>
                      <div className="bg-[var(--bg-surface)] border border-[var(--border-card)] rounded-xl p-3.5 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-xs font-medium text-[var(--text-primary)]">Security Preset</div>
                            <div className="text-[11px] text-[var(--text-secondary)]">Controls the actions the agent can take when executing tools.</div>
                          </div>
                          <select
                            value={form.securityPreset || 'turbo'}
                            onChange={(e) => setForm({ ...form, securityPreset: e.target.value as any })}
                            className="bg-[var(--bg-canvas)] border border-[var(--border-card)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-subtle)]"
                          >
                            <option value="turbo">Turbo Mode (Full Auto)</option>
                            <option value="confirm">Ask Confirmation for Destructive Tools</option>
                          </select>
                        </div>

                        <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between">
                          <div>
                            <div className="flex items-center space-x-1.5">
                              <span className="text-xs font-medium text-[var(--text-primary)]">Tool Capabilities</span>
                              <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-[var(--bg-surface-hover)] text-[#70a6ff] font-medium">Active</span>
                            </div>
                            <div className="text-[11px] text-[var(--text-secondary)]">Terminal, File Edit, Read, Web Search, Audio Dictation, Jules Merge</div>
                          </div>
                          <span className="text-[11px] text-emerald-400 font-medium">Ready</span>
                        </div>
                      </div>
                    </div>

                    {/* Agent Behavior */}
                    <div>
                      <h4 className="text-xs font-semibold text-[var(--text-primary)] mb-2">Agent Behavior</h4>
                      <div className="bg-[var(--bg-surface)] border border-[var(--border-card)] rounded-xl p-3.5 space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <div className="text-xs font-medium text-[var(--text-primary)]">Plan Review Policy</div>
                            <div className="text-[11px] text-[var(--text-secondary)]">Whether the agent asks you to review execution steps before coding.</div>
                          </div>
                          <select
                            value={form.planReviewPolicy || 'proceed'}
                            onChange={(e) => setForm({ ...form, planReviewPolicy: e.target.value as any })}
                            className="bg-[var(--bg-canvas)] border border-[var(--border-card)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-subtle)]"
                          >
                            <option value="proceed">Always Proceed Automatically</option>
                            <option value="review">Pause for Plan Review</option>
                          </select>
                        </div>

                        <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between">
                          <div>
                            <div className="text-xs font-medium text-[var(--text-primary)]">Default Assistant Mode</div>
                            <div className="text-[11px] text-[var(--text-secondary)]">Starting mode for new conversations.</div>
                          </div>
                          <select
                            value={form.mode || 'standard'}
                            onChange={(e) => setForm({ ...form, mode: e.target.value as any })}
                            className="bg-[var(--bg-canvas)] border border-[var(--border-card)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-subtle)]"
                          >
                            <option value="standard">Standard AI Developer</option>
                            <option value="jules">Jules Senior Lead Supervisor</option>
                          </select>
                        </div>

                        <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between">
                          <div className="pr-4">
                            <div className="flex items-center space-x-2">
                              <span className="text-xs font-medium text-[var(--text-primary)]">Continuous Autonomous Mode</span>
                              {form.defaultAutonomousMode ? (
                                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-amber-500/15 text-amber-400 border border-amber-500/30 font-medium">
                                  Default ON
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-[var(--bg-surface-hover)] text-[var(--text-muted)] border border-[var(--border-subtle)] font-medium">
                                  Default OFF
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                              Enables continuous autonomous execution on new tasks. If inactive for 2 minutes, Byte will automatically wake up and continue driving the task to 100% completion.
                            </div>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={Boolean(form.defaultAutonomousMode)}
                            onClick={() => setForm({ ...form, defaultAutonomousMode: !form.defaultAutonomousMode })}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                              form.defaultAutonomousMode ? 'bg-amber-500' : 'bg-[var(--border-card)]'
                            }`}
                          >
                            <span
                              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                                form.defaultAutonomousMode ? 'translate-x-4' : 'translate-x-0'
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Power Management / Prevent Sleep Mode */}
                    <div>
                      <h4 className="text-xs font-semibold text-[var(--text-primary)] mb-2 flex items-center space-x-1.5">
                        <Zap className="w-3.5 h-3.5 text-amber-400" />
                        <span>Power Management</span>
                      </h4>
                      <div className="bg-[var(--bg-surface)] border border-[var(--border-card)] rounded-xl p-3.5 space-y-3">
                        <div className="flex items-center justify-between">
                          <div className="pr-4">
                            <div className="flex items-center space-x-2">
                              <span className="text-xs font-medium text-[var(--text-primary)]">Prevent Device Sleep Mode</span>
                              {form.preventSleep ? (
                                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-amber-500/15 text-amber-400 border border-amber-500/30 font-medium">
                                  Active (Awake)
                                </span>
                              ) : (
                                <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-[var(--bg-surface-hover)] text-[var(--text-muted)] border border-[var(--border-subtle)] font-medium">
                                  Disabled
                                </span>
                              )}
                            </div>
                            <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
                              Prevents your computer and display from going to sleep while Byte is open. Essential for uninterrupted long-running tasks, test suites, and overnight duty shifts.
                            </div>
                          </div>
                          <button
                            type="button"
                            role="switch"
                            aria-checked={Boolean(form.preventSleep)}
                            onClick={() => setForm({ ...form, preventSleep: !form.preventSleep })}
                            className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                              form.preventSleep ? 'bg-amber-500' : 'bg-[var(--border-card)]'
                            }`}
                          >
                            <span
                              className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                                form.preventSleep ? 'translate-x-4' : 'translate-x-0'
                              }`}
                            />
                          </button>
                        </div>
                      </div>
                    </div>
                  </>
                )}

                {/* ─── TAB: MODELS & API ─── */}
                {activeTab === 'models' && (
                  <div className="space-y-4">
                    <div className="bg-[var(--bg-surface)] border border-[var(--border-card)] rounded-xl p-4 space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-primary)] mb-1">API Base URL</label>
                        <input
                          type="text"
                          value={form.apiBaseUrl || ''}
                          onChange={(e) => setForm({ ...form, apiBaseUrl: e.target.value })}
                          placeholder="http://127.0.0.1:31415/v1 or https://api.openai.com/v1"
                          className="w-full bg-[var(--bg-surface)] border border-[var(--border-card)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-subtle)] font-mono text-xs"
                        />
                        <span className="text-[10px] text-[var(--text-secondary)] mt-1 block">Supports local FreeLLM proxies, Ollama, vLLM, and OpenAI-compatible gateways.</span>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-[var(--text-primary)] mb-1">API Key</label>
                        <div className="relative">
                          <input
                            type={showApiKey ? 'text' : 'password'}
                            value={form.apiKey || ''}
                            onChange={(e) => setForm({ ...form, apiKey: e.target.value })}
                            placeholder="freellmapi-... or sk-..."
                            className="w-full bg-[var(--bg-surface)] border border-[var(--border-card)] rounded-lg pl-3 pr-9 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-subtle)] font-mono text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => setShowApiKey(!showApiKey)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                            title={showApiKey ? 'Hide key' : 'Show key'}
                          >
                            {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-[var(--text-primary)] mb-1">Default Selected Model</label>
                        <select
                          value={form.selectedModel || 'auto'}
                          onChange={(e) => setForm({ ...form, selectedModel: e.target.value })}
                          className="w-full bg-[var(--bg-surface)] border border-[var(--border-card)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-subtle)] font-mono text-xs"
                        >
                          <option value="auto">Auto Router (Smart Dynamic Selection)</option>
                          {availableModels.filter((m) => m !== 'auto').map((m) => (
                            <option key={m} value={m}>{m}</option>
                          ))}
                        </select>
                      </div>

                      <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between">
                        <button
                          type="button"
                          onClick={handleTestEndpoint}
                          disabled={testEndpointStatus === 'testing'}
                          className="px-3.5 py-1.5 rounded-lg bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-primary)] font-medium transition-colors cursor-pointer flex items-center space-x-1.5"
                        >
                          {testEndpointStatus === 'testing' ? (
                            <>
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              <span>Connecting...</span>
                            </>
                          ) : (
                            <span>Test Endpoint Connection</span>
                          )}
                        </button>

                        {testEndpointStatus === 'success' && (
                          <span className="text-xs text-emerald-400 font-medium">✓ {testEndpointMsg}</span>
                        )}
                        {testEndpointStatus === 'error' && (
                          <span className="text-xs text-rose-400 font-medium">✕ {testEndpointMsg}</span>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* ─── TAB: VOICE DICTATION ─── */}
                {activeTab === 'voice' && (
                  <div className="space-y-4">
                    <div className="bg-[var(--bg-surface)] border border-[var(--border-card)] rounded-xl p-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs font-semibold text-[var(--text-primary)]">Groq Whisper Large v3 Voice Engine</div>
                          <div className="text-[11px] text-[var(--text-secondary)]">Fastest neural speech transcription (~200ms turnaround, 0 MB local RAM).</div>
                        </div>
                        <a
                          href="https://console.groq.com/keys"
                          target="_blank"
                          rel="noreferrer"
                          className="text-xs text-[#70a6ff] hover:underline flex items-center space-x-1"
                        >
                          <span>Get Free Key</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-[var(--text-primary)] mb-1">Groq API Key</label>
                        <div className="relative">
                          <input
                            type={showGroqKey ? 'text' : 'password'}
                            value={form.groqApiKey || ''}
                            onChange={(e) => setForm({ ...form, groqApiKey: e.target.value })}
                            placeholder="gsk_..."
                            className="w-full bg-[var(--bg-surface)] border border-[var(--border-card)] rounded-lg pl-3 pr-9 py-2 text-[var(--text-primary)] focus:outline-none focus:border-rose-400 font-mono text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => setShowGroqKey(!showGroqKey)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                            title={showGroqKey ? 'Hide key' : 'Show key'}
                          >
                            {showGroqKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>

                      <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between">
                        <div>
                          <div className="text-xs font-medium text-[var(--text-primary)]">Voice Activity Detection (VAD)</div>
                          <div className="text-[11px] text-[var(--text-secondary)]">Automatically transcribe speech upon 1.5s natural pause.</div>
                        </div>
                        <input
                          type="checkbox"
                          checked={form.vadEnabled !== false}
                          onChange={(e) => setForm({ ...form, vadEnabled: e.target.checked })}
                          className="w-4 h-4 accent-rose-500 rounded cursor-pointer"
                        />
                      </div>

                      {/* Live Microphone Test Bar */}
                      <div className="pt-2 border-t border-[var(--border-subtle)]">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs font-medium text-[var(--text-primary)]">Live Microphone Test</span>
                          <button
                            type="button"
                            onClick={() => setIsMicTesting(!isMicTesting)}
                            className={`px-3 py-1 rounded-lg text-xs font-medium transition-colors cursor-pointer ${
                              isMicTesting
                                ? 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                                : 'bg-[var(--bg-surface-hover)] text-[var(--text-primary)] hover:text-[var(--text-primary)]'
                            }`}
                          >
                            {isMicTesting ? 'Stop Test' : 'Test Microphone'}
                          </button>
                        </div>
                        <div className="w-full bg-[var(--bg-canvas)] h-3 rounded-full overflow-hidden border border-[var(--border-card)] p-0.5">
                          <div
                            style={{ width: `${micLevel}%` }}
                            className={`h-full rounded-full transition-all duration-75 ${
                              micLevel > 60 ? 'bg-emerald-400' : micLevel > 20 ? 'bg-sky-400' : 'bg-zinc-600'
                            }`}
                          />
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ─── TAB: JULES AI ─── */}
                {activeTab === 'jules' && (
                  <div className="space-y-4">
                    <div className="bg-[var(--bg-surface)] border border-[var(--border-card)] rounded-xl p-4 space-y-4">
                      <div>
                        <label className="block text-xs font-medium text-[var(--text-primary)] mb-1">Google Labs Jules API Key</label>
                        <div className="relative">
                          <input
                            type={showJulesKey ? 'text' : 'password'}
                            value={form.julesApiKey || ''}
                            onChange={(e) => setForm({ ...form, julesApiKey: e.target.value })}
                            placeholder="AQ.Ab8..."
                            className="w-full bg-[var(--bg-surface)] border border-[var(--border-card)] rounded-lg pl-3 pr-9 py-2 text-[var(--text-primary)] focus:outline-none focus:border-amber-400 font-mono text-xs"
                          />
                          <button
                            type="button"
                            onClick={() => setShowJulesKey(!showJulesKey)}
                            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
                            title={showJulesKey ? 'Hide key' : 'Show key'}
                          >
                            {showJulesKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                        <span className="text-[10px] text-[var(--text-secondary)] mt-1 block">Autonomous cloud coding worker key from Google Labs.</span>
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-[var(--text-primary)] mb-1">Default GitHub Repo Source</label>
                        <input
                          type="text"
                          value={form.julesDefaultRepo || ''}
                          onChange={(e) => setForm({ ...form, julesDefaultRepo: e.target.value })}
                          placeholder="sources/github/HyHamza/SeniorEngineer"
                          className="w-full bg-[var(--bg-surface)] border border-[var(--border-card)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-amber-400 font-mono text-xs"
                        />
                      </div>

                      <div>
                        <label className="block text-xs font-medium text-[var(--text-primary)] mb-1">Default Starting Branch</label>
                        <input
                          type="text"
                          value={form.julesDefaultBranch || ''}
                          onChange={(e) => setForm({ ...form, julesDefaultBranch: e.target.value })}
                          placeholder="main"
                          className="w-full bg-[var(--bg-surface)] border border-[var(--border-card)] rounded-lg px-3 py-2 text-[var(--text-primary)] focus:outline-none focus:border-amber-400 font-mono text-xs"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* ─── TAB: APPEARANCE ─── */}
                {activeTab === 'appearance' && (
                  <div className="space-y-4">
                    <div className="bg-[var(--bg-surface)] border border-[var(--border-card)] rounded-xl p-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <div className="text-xs font-medium text-[var(--text-primary)]">Color Theme</div>
                          <div className="text-[11px] text-[var(--text-secondary)]">Select the visual aesthetic for Byte.</div>
                        </div>
                        <select
                          value={form.theme || 'obsidian'}
                          onChange={(e) => {
                            const newTheme = e.target.value as any;
                            setForm((prev) => ({ ...prev, theme: newTheme }));
                            onSave({ theme: newTheme });
                          }}
                          className="bg-[var(--bg-canvas)] border border-[var(--border-card)] rounded-lg px-3 py-1.5 text-xs text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-subtle)]"
                        >
                          <option value="obsidian">Antigravity Obsidian (Default)</option>
                          <option value="contrast">High Contrast Deep Charcoal</option>
                          <option value="whiteTheme">Clean White Theme</option>
                        </select>
                      </div>

                      <div className="pt-2 border-t border-[var(--border-subtle)]">
                        <div className="text-xs font-medium text-[var(--text-primary)] mb-2">User Profile</div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <label className="block text-[11px] text-[var(--text-secondary)] mb-1">Display Name</label>
                            <input
                              type="text"
                              value={form.userName || 'Hamza'}
                              onChange={(e) => setForm({ ...form, userName: e.target.value })}
                              className="w-full bg-[var(--bg-surface)] border border-[var(--border-card)] rounded-lg px-3 py-1.5 text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-subtle)] text-xs"
                            />
                          </div>
                          <div>
                            <label className="block text-[11px] text-[var(--text-secondary)] mb-1">Email</label>
                            <input
                              type="text"
                              value={form.userEmail || 'talkdrove@gmail.com'}
                              onChange={(e) => setForm({ ...form, userEmail: e.target.value })}
                              className="w-full bg-[var(--bg-surface)] border border-[var(--border-card)] rounded-lg px-3 py-1.5 text-[var(--text-primary)] focus:outline-none focus:border-[var(--border-subtle)] text-xs font-mono"
                            />
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* ─── TAB: SELECTED PROJECT DETAILS ─── */}
                {selectedProject && (
                  <div className="space-y-4">
                    <div className="bg-[var(--bg-surface)] border border-[var(--border-card)] rounded-xl p-4 space-y-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <Folder className="w-5 h-5 text-sky-400" />
                          <h3 className="text-sm font-semibold text-[var(--text-primary)]">{selectedProject.name}</h3>
                        </div>
                        {activeWorkspacePath === selectedProject.path && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] bg-sky-950/60 border border-sky-800/60 text-sky-300 font-medium">
                            Current Active Workspace
                          </span>
                        )}
                      </div>

                      <div>
                        <label className="block text-[11px] text-[var(--text-secondary)] mb-1">Directory Path</label>
                        <div className="bg-[var(--bg-surface)] border border-[var(--border-card)] rounded-lg px-3 py-2 text-[var(--text-primary)] font-mono text-xs break-all">
                          {selectedProject.path}
                        </div>
                      </div>

                      {selectedProject.gitRepo && (
                        <div>
                          <label className="block text-[11px] text-[var(--text-secondary)] mb-1">Git Repository & Branch</label>
                          <div className="bg-[var(--bg-surface)] border border-[var(--border-card)] rounded-lg px-3 py-2 text-[#70a6ff] font-mono text-xs flex items-center space-x-2">
                            <FolderGit2 className="w-3.5 h-3.5" />
                            <span>{selectedProject.gitRepo} ({selectedProject.gitBranch || 'main'})</span>
                          </div>
                        </div>
                      )}

                      <div className="pt-2 border-t border-[var(--border-subtle)] flex items-center justify-between">
                        <div className="flex items-center space-x-2">
                          <button
                            type="button"
                            onClick={() => api.showInExplorer?.(selectedProject.path)}
                            className="px-3 py-1.5 rounded-lg bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-primary)] transition-colors cursor-pointer flex items-center space-x-1.5"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                            <span>Open in Explorer</span>
                          </button>

                          {activeWorkspacePath !== selectedProject.path && onSelectProject && (
                            <button
                              type="button"
                              onClick={() => {
                                onSelectProject(selectedProject.path);
                                onClose();
                              }}
                              className="px-3 py-1.5 rounded-lg bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-primary)] font-medium transition-colors cursor-pointer"
                            >
                              Set as Active Workspace
                            </button>
                          )}
                        </div>

                        {onDeleteProject && (
                          <button
                            type="button"
                            onClick={() => {
                              onDeleteProject(selectedProject.path);
                              setActiveTab('general');
                            }}
                            className="text-rose-400 hover:text-rose-300 p-1.5 rounded-lg hover:bg-rose-950/30 transition-colors cursor-pointer"
                            title="Remove project from workspace list"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Bottom Footer Actions */}
              <div className="px-6 py-3 border-t border-[var(--border-subtle)] bg-[var(--bg-sidebar)] flex items-center justify-between shrink-0">
                <div className="text-[11px] text-[var(--text-muted)]">
                  Database: <span className="text-sky-400 font-medium">SQLite</span> (<code className="font-mono text-[var(--text-secondary)]">~/.seniorengineer/seniorengineer.db</code>)
                </div>

                <div className="flex items-center space-x-2">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={isSaving}
                    className="px-4 py-1.5 rounded-lg bg-[var(--bg-surface)] text-[var(--text-primary)] hover:bg-[var(--bg-surface-hover)] transition-colors cursor-pointer disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="flex items-center space-x-1.5 px-4 py-1.5 rounded-lg bg-[var(--bg-surface-hover)] hover:bg-[var(--bg-surface-hover)] text-[var(--text-primary)] font-medium transition-colors cursor-pointer shadow disabled:opacity-75"
                  >
                    {isSaving ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        <span>Saving...</span>
                      </>
                    ) : savedSuccess ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-[var(--text-primary)]" />
                        <span>Saved!</span>
                      </>
                    ) : (
                      <>
                        <Save className="w-3.5 h-3.5" />
                        <span>Save Changes</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
