import React, { useState, useEffect } from 'react';
import { FolderGit2, Settings, FileText, Terminal, Info, ChevronRight, Github } from 'lucide-react';
import FileViewer from './components/FileViewer';
import { PipelineConfig, PipelineFile } from './types';
import { 
  generateIngestYaml, 
  generateIngestScript, 
  generateReadme, 
  generateQueueFile,
  generateTestAudioYaml 
} from './utils/templates';

const DEFAULT_CONFIG: PipelineConfig = {
  repoName: 'copy-spaces-to-youtube-pipeline',
  ownerName: 'aiandbotsgalore',
  podcastTitle: 'My Spaces Archive',
  podcastDescription: 'An automated archive of Twitter Spaces.',
  authorName: 'Logan Black',
  email: 'loganblack0@gmail.com',
  imageUrl: 'https://picsum.photos/1400/1400'
};

const FILES: PipelineFile[] = [
  {
    path: '.github/workflows/ingest.yml',
    name: 'Workflow',
    language: 'yaml',
    content: generateIngestYaml,
    description: 'Main GitHub Action for download, release, and RSS.'
  },
  {
    path: 'scripts/ingest.sh',
    name: 'Ingest Script',
    language: 'bash',
    content: generateIngestScript,
    description: 'Shell script to handle yt-dlp operations safely.'
  },
  {
    path: 'space_queue.txt',
    name: 'Queue File',
    language: 'text',
    content: generateQueueFile,
    description: 'The input trigger file. Paste URL here.'
  },
  {
    path: 'README.md',
    name: 'Documentation',
    language: 'markdown',
    content: generateReadme,
    description: 'Instructions for repository users.'
  },
  {
    path: '.github/workflows/test_audio.yml',
    name: 'Test Workflow',
    language: 'yaml',
    content: generateTestAudioYaml,
    description: 'Optional workflow to verify runner capabilities.'
  }
];

export default function App() {
  const [config, setConfig] = useState<PipelineConfig>(DEFAULT_CONFIG);
  const [activeFile, setActiveFile] = useState<PipelineFile>(FILES[0]);
  const [activeTab, setActiveTab] = useState<'files' | 'config'>('config');

  const handleConfigChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setConfig(prev => ({ ...prev, [name]: value }));
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 flex flex-col md:flex-row font-sans">
      {/* Sidebar */}
      <aside className="w-full md:w-72 flex-shrink-0 border-r border-slate-800 bg-slate-950 flex flex-col h-screen sticky top-0">
        <div className="p-6 border-b border-slate-800">
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-indigo-500/10 rounded-lg">
              <Terminal className="text-indigo-400" size={24} />
            </div>
            <h1 className="font-bold text-lg tracking-tight text-white">SpacePipe Gen</h1>
          </div>
          <p className="text-xs text-slate-500 leading-relaxed">
            Generate a fully automated Twitter Spaces to YouTube Podcast pipeline using GitHub Actions.
          </p>
        </div>

        <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-6">
          
          <div>
            <div className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Setup
            </div>
            <button
              onClick={() => setActiveTab('config')}
              className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-colors ${
                activeTab === 'config' 
                  ? 'bg-indigo-500/10 text-indigo-400' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
              }`}
            >
              <Settings size={18} />
              Configuration
            </button>
          </div>

          <div>
            <div className="px-3 mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
              Pipeline Files
            </div>
            <div className="space-y-1">
              {FILES.map((file) => (
                <button
                  key={file.path}
                  onClick={() => {
                    setActiveFile(file);
                    setActiveTab('files');
                  }}
                  className={`w-full flex items-center justify-between group px-3 py-2 text-sm font-medium rounded-md transition-all ${
                    activeTab === 'files' && activeFile.path === file.path
                      ? 'bg-slate-800 text-sky-400 border-l-2 border-sky-400'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900 border-l-2 border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    {file.name === 'Queue File' ? <FileText size={16} /> : 
                     file.name.includes('Workflow') ? <FolderGit2 size={16} /> :
                     <Terminal size={16} />}
                    <span className="truncate">{file.name}</span>
                  </div>
                  {activeTab === 'files' && activeFile.path === file.path && (
                    <ChevronRight size={14} className="opacity-50" />
                  )}
                </button>
              ))}
            </div>
          </div>
        </nav>

        <div className="p-4 border-t border-slate-800 text-xs text-slate-600 text-center">
          <p>Generated files comply with</p>
          <p>DevOps strict mode standards</p>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 min-w-0 bg-slate-925 flex flex-col h-screen overflow-hidden">
        {activeTab === 'config' ? (
          <div className="h-full overflow-y-auto p-6 md:p-12 max-w-4xl mx-auto w-full">
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-white mb-2">Pipeline Configuration</h2>
              <p className="text-slate-400 text-sm">
                Fill out these details to generate the correct configuration files for your repository. 
                These values are injected into the GitHub Actions workflows and RSS generation scripts.
              </p>
            </div>

            <div className="grid gap-8">
              <section className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
                  <Github size={18} className="text-slate-500" />
                  <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">Repository Details</h3>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-400">Owner / Username</label>
                    <input
                      type="text"
                      name="ownerName"
                      placeholder="e.g. octocat"
                      value={config.ownerName}
                      onChange={handleConfigChange}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                    <p className="text-[10px] text-slate-500">The GitHub username where this repo will live.</p>
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-400">Repository Name</label>
                    <input
                      type="text"
                      name="repoName"
                      placeholder="e.g. spaces-archive"
                      value={config.repoName}
                      onChange={handleConfigChange}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                    <p className="text-[10px] text-slate-500">The name of your repository on GitHub.</p>
                  </div>
                </div>
              </section>

              <section className="space-y-4">
                <div className="flex items-center gap-2 pb-2 border-b border-slate-800">
                  <Info size={18} className="text-slate-500" />
                  <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wide">Podcast Metadata</h3>
                </div>
                <div className="grid gap-4">
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-400">Podcast Title</label>
                    <input
                      type="text"
                      name="podcastTitle"
                      placeholder="e.g. Engineering Spaces"
                      value={config.podcastTitle}
                      onChange={handleConfigChange}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-400">Description</label>
                    <input
                      type="text"
                      name="podcastDescription"
                      placeholder="e.g. A collection of great engineering discussions..."
                      value={config.podcastDescription}
                      onChange={handleConfigChange}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                  </div>
                  <div className="grid md:grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-400">Author Name</label>
                      <input
                        type="text"
                        name="authorName"
                        placeholder="e.g. The Engineer"
                        value={config.authorName}
                        onChange={handleConfigChange}
                        className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
                      />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium text-slate-400">Email</label>
                      <input
                        type="email"
                        name="email"
                        placeholder="e.g. hello@example.com"
                        value={config.email}
                        onChange={handleConfigChange}
                        className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
                      />
                      <p className="text-[10px] text-slate-500">Used for iTunes owner verification.</p>
                    </div>
                  </div>
                   <div className="space-y-1">
                    <label className="text-xs font-medium text-slate-400">Image URL</label>
                    <input
                      type="text"
                      name="imageUrl"
                      placeholder="https://..."
                      value={config.imageUrl}
                      onChange={handleConfigChange}
                      className="w-full bg-slate-900 border border-slate-800 rounded px-3 py-2 text-sm text-white focus:outline-none focus:border-indigo-500 transition-colors"
                    />
                    <p className="text-[10px] text-slate-500">Must be a direct link to a square image (min 1400x1400px).</p>
                  </div>
                </div>
              </section>

              <div className="pt-4">
                <button
                  onClick={() => setActiveTab('files')}
                  className="px-6 py-2 bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium rounded-md shadow-lg shadow-indigo-500/20 transition-all transform active:scale-95"
                >
                  View Generated Files
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col h-full">
            <header className="px-6 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">{activeFile.name}</h2>
                <p className="text-sm text-slate-400">{activeFile.path}</p>
              </div>
            </header>
            <div className="flex-1 p-4 md:p-6 overflow-hidden bg-slate-925">
               <FileViewer file={activeFile} config={config} />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}