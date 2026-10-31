import { describe, expect, it } from 'vitest';
import { AvatarRenderInputError, normalizeAvatarRenderRequest } from '../../server/avatarRender';

describe('avatar render request contract', () => {
  it('preserves every rig control and clamps numeric values at the API boundary', () => {
    const request = normalizeAvatarRenderRequest({
      personaId: 'doc-anchor',
      backdropId: 'broadcast-room',
      cameraAngle: 'cinematic',
      aspectRatio: '9-16',
      lipSyncTightness: 101,
      headSwayAmplitude: 4,
      eyeGazeMode: 'notes',
      blinkRate: 18,
      microExpressionScale: 65,
      showMeshOverlay: true,
      showPipExhibit: false,
    });

    expect(request).toMatchObject({
      personaId: 'doc-anchor',
      backdropId: 'broadcast-room',
      cameraAngle: 'cinematic',
      aspectRatio: '9-16',
      lipSyncTightness: 100,
      headSwayAmplitude: 10,
      eyeGazeMode: 'notes',
      blinkRate: 18,
      microExpressionScale: 65,
      showMeshOverlay: true,
      showPipExhibit: false,
    });
  });

  it('rejects unsupported enum values instead of silently selecting a default', () => {
    expect(() => normalizeAvatarRenderRequest({ cameraAngle: 'orbit' })).toThrow(AvatarRenderInputError);
  });
});

