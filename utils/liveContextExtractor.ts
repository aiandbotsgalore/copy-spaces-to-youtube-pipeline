import { EPISODE_SEGMENTS_CACHE } from './transcriptData';

export interface LiveStudioContext {
  activeTab: string;
  badge: string;
  contextSummary: string;
  contextData: Record<string, any>;
}

/**
 * Dynamically reads the LIVE, non-stale state of the current studio tab.
 */
export function extractLiveStudioContext(activeTab: string): LiveStudioContext {
  const panel = activeTab || 'dashboard';
  let badge = `Tab: ${panel}`;
  const contextData: Record<string, any> = { activeTab: panel };
  const summaryParts: string[] = [`CURRENT ACTIVE VIEW: ${panel.toUpperCase()}`];

  try {
    switch (panel) {
      case 'dashboard':
      case 'configuration': {
        badge = panel === 'dashboard' ? 'Command Center' : 'Settings & Pipeline';
        try {
          const cfg = localStorage.getItem('spacepipe_config');
          if (cfg) {
            const parsed = JSON.parse(cfg);
            contextData.targetRepo = `${parsed.ownerName || 'owner'}/${parsed.repoName || 'repo'}`;
            contextData.features = {
              transcription: Boolean(parsed.enableTranscription),
              scheduledMonitoring: Boolean(parsed.enableScheduledMonitoring),
              discord: Boolean(parsed.enableDiscordWebhook),
              slack: Boolean(parsed.enableSlackWebhook),
            };
            summaryParts.push(`Target Repository: ${contextData.targetRepo}`);
            summaryParts.push(`Features: Transcription=${contextData.features.transcription}, Monitoring=${contextData.features.scheduledMonitoring}`);
          }
        } catch {}
        break;
      }

      case 'submit-space': {
        badge = 'Ingest Queue';
        try {
          const queue = localStorage.getItem('spacepipe_batch_urls');
          if (queue) {
            const urls = JSON.parse(queue);
            contextData.urlQueueCount = Array.isArray(urls) ? urls.length : 0;
            contextData.urlQueueSample = Array.isArray(urls) ? urls.slice(0, 3) : [];
            summaryParts.push(`Pending URLs in Ingest Queue: ${contextData.urlQueueCount}`);
            if (contextData.urlQueueSample.length > 0) {
              summaryParts.push(`Next URLs: ${contextData.urlQueueSample.join(', ')}`);
            }
          }
        } catch {}
        break;
      }

      case 'library':
      case 'transcripts': {
        badge = panel === 'library' ? 'Episode Library' : 'Transcripts Studio';
        try {
          const currentEp = localStorage.getItem('spacepipe_last_selected_episode') || sessionStorage.getItem('spacepipe_active_transcript_tag');
          if (currentEp) {
            contextData.selectedEpisodeTag = currentEp;
            summaryParts.push(`Currently Selected Episode: ${currentEp}`);
            if (EPISODE_SEGMENTS_CACHE.has(currentEp)) {
              const segs = EPISODE_SEGMENTS_CACHE.get(currentEp)!;
              contextData.segmentCount = segs.length;
              summaryParts.push(`Cached Dialogue Turns: ${segs.length}`);
            }
          }
          const activeSearch = sessionStorage.getItem('spacepipe_transcript_search_q');
          if (activeSearch) {
            contextData.activeSearch = activeSearch;
            summaryParts.push(`Active Search Filter: "${activeSearch}"`);
          }
        } catch {}
        break;
      }

      case 'investigative-radar': {
        badge = 'Investigative Radar (GraphRAG)';
        try {
          const radarState = sessionStorage.getItem('spacepipe_radar_selection');
          if (radarState) {
            const parsed = JSON.parse(radarState);
            contextData.selectedEntity = parsed.selectedEntity || parsed.entity;
            contextData.selectedCluster = parsed.cluster;
            summaryParts.push(`Active Radar Entity Focus: ${parsed.selectedEntity || 'None'}`);
          } else {
            summaryParts.push(`GraphRAG Knowledge Graph loaded with cross-episode entity links.`);
          }
        } catch {}
        break;
      }

      case 'clips':
      case 'montage': {
        badge = panel === 'clips' ? 'Best Clips' : 'Montage Studio';
        try {
          const reelJson = localStorage.getItem('spacepipe_montage_reel_v1');
          if (reelJson) {
            const reel = JSON.parse(reelJson);
            if (Array.isArray(reel)) {
              contextData.reelClipCount = reel.length;
              contextData.totalReelDurationSec = Math.round(
                reel.reduce((acc: number, c: any) => acc + (c.endSec - c.startSec), 0)
              );
              summaryParts.push(`Active Montage Reel: ${reel.length} clips (${contextData.totalReelDurationSec}s total)`);
              if (reel.length > 0) {
                summaryParts.push(`Reel Clips: ${reel.map((c: any) => `"${c.title || c.quote?.slice(0, 30)}"`).join(', ')}`);
              }
            }
          }
        } catch {}
        break;
      }

      case 'script-studio': {
        badge = 'Script Studio';
        try {
          const scriptDraft = localStorage.getItem('spacepipe_script_studio_active_draft');
          if (scriptDraft) {
            const parsed = JSON.parse(scriptDraft);
            contextData.scriptTitle = parsed.title || 'Untitled Documentary';
            contextData.sceneCount = Array.isArray(parsed.scenes) ? parsed.scenes.length : 0;
            summaryParts.push(`Active Script: "${contextData.scriptTitle}" (${contextData.sceneCount} scenes)`);
            if (parsed.outlineSummary) {
              summaryParts.push(`Outline: ${parsed.outlineSummary.slice(0, 200)}...`);
            }
          } else {
            summaryParts.push(`Script Studio: Ready for new project outline or debate draft.`);
          }
        } catch {}
        break;
      }

      case 'voice-profiles': {
        badge = 'Voice Profiles';
        try {
          const profiles = localStorage.getItem('spacepipe_voice_profiles_v1');
          if (profiles) {
            const parsed = JSON.parse(profiles);
            contextData.enrolledSpeakerCount = Array.isArray(parsed) ? parsed.length : 0;
            contextData.speakers = Array.isArray(parsed) ? parsed.map((p: any) => p.speakerName || p.name).slice(0, 10) : [];
            summaryParts.push(`Enrolled Voice Profiles: ${contextData.enrolledSpeakerCount}`);
            if (contextData.speakers.length > 0) {
              summaryParts.push(`Speakers: ${contextData.speakers.join(', ')}`);
            }
          }
        } catch {}
        break;
      }

      case 'vox-studio':
      case 'avatar-studio': {
        badge = panel === 'vox-studio' ? 'Vox Studio (VoxCPM-2)' : 'Avatar Studio (LivePortrait)';
        summaryParts.push(`Active Media Studio: ${panel === 'vox-studio' ? 'Neural Voice Synthesis' : 'LivePortrait Talking Avatar Generation'}`);
        break;
      }

      default:
        badge = `Tab: ${panel}`;
        break;
    }
  } catch (err) {
    console.warn('[liveContextExtractor] Error reading live tab state:', err);
  }

  return {
    activeTab: panel,
    badge,
    contextSummary: summaryParts.join(' | '),
    contextData,
  };
}
