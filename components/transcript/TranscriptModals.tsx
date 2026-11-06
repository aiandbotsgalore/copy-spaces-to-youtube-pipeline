import React from 'react';
import { AudioSlicerModal, SlicerTurnTarget } from '../AudioSlicerModal';
import { SpeakerRenameModal } from './SpeakerRenameModal';
import { SavedSpeakersModal } from './SavedSpeakersModal';
import {
  SavedSpeaker,
  DEFAULT_SAVED_SPEAKERS,
  SPEAKER_COLOR_MAP,
  DYNAMIC_COLOR_ORDER,
  getAutoSpeakerColor,
  getAutoSpeakerEmoji,
} from './useTranscriptSession';

export interface QuickRenameTarget {
  rawSpeaker: string;
  currentName: string;
  turnCount?: number;
}

export interface TranscriptModalsProps {
  quickRenameTarget: QuickRenameTarget | null;
  onCloseRenameModal: () => void;
  onApplyRename: (rawSpeaker: string, newName: string, color: string, emoji: string, addToSaved: boolean) => void;
  onResetRename: (rawSpeaker: string) => void;
  savedSpeakers: SavedSpeaker[];
  showSavedSpeakersModal: boolean;
  setShowSavedSpeakersModal: (open: boolean) => void;
  onDeletePermanentSpeaker: (idOrName: string) => void;
  onAddPermanentSpeaker: (speaker: SavedSpeaker) => void;
  getSpeakerTheme: (displayName: string, savedSpeakers?: SavedSpeaker[]) => any;
  isSlicerOpen: boolean;
  setIsSlicerOpen: (open: boolean) => void;
  slicerTarget: SlicerTurnTarget | null;
}

export const TranscriptModals: React.FC<TranscriptModalsProps> = ({
  quickRenameTarget,
  onCloseRenameModal,
  onApplyRename,
  onResetRename,
  savedSpeakers,
  showSavedSpeakersModal,
  setShowSavedSpeakersModal,
  onDeletePermanentSpeaker,
  onAddPermanentSpeaker,
  getSpeakerTheme,
  isSlicerOpen,
  setIsSlicerOpen,
  slicerTarget,
}) => {
  return (
    <>
      {/* Quick Rename Single Speaker Modal */}
      <SpeakerRenameModal
        target={quickRenameTarget}
        onClose={onCloseRenameModal}
        onApply={onApplyRename}
        onReset={onResetRename}
        onOpenSavedModal={() => {
          onCloseRenameModal();
          setShowSavedSpeakersModal(true);
        }}
        savedSpeakers={savedSpeakers}
        defaultSavedSpeakers={DEFAULT_SAVED_SPEAKERS}
        speakerColorMap={SPEAKER_COLOR_MAP}
        dynamicColorOrder={DYNAMIC_COLOR_ORDER}
        getSpeakerTheme={getSpeakerTheme}
        getAutoSpeakerColor={getAutoSpeakerColor}
        getAutoSpeakerEmoji={getAutoSpeakerEmoji}
      />

      {/* Saved Speakers Modal */}
      <SavedSpeakersModal
        isOpen={showSavedSpeakersModal}
        onClose={() => setShowSavedSpeakersModal(false)}
        savedSpeakers={savedSpeakers}
        onDeleteSpeaker={onDeletePermanentSpeaker}
        onAddSpeaker={onAddPermanentSpeaker}
        getSpeakerTheme={getSpeakerTheme}
      />

      {/* Interactive In-Browser Audio Slicer Modal */}
      <AudioSlicerModal
        isOpen={isSlicerOpen}
        onClose={() => setIsSlicerOpen(false)}
        target={slicerTarget}
      />
    </>
  );
};
