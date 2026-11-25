import { describe, expect, it } from 'vitest';
import { mediaErrorMessage, pickMimeType, recordingPlan, timerLabel } from './recorder';

describe('registrazione nell’app', () => {
  it('sceglie il codec: H.264 se c’è, poi VP8', () => {
    expect(pickMimeType(() => true)).toBe('video/webm;codecs=h264,opus');
    expect(pickMimeType((m) => m.includes('vp8'))).toBe('video/webm;codecs=vp8,opus');
    expect(pickMimeType(() => false)).toBe('video/webm');
  });

  it('tracce e microfono: sulla webcam se c’è, altrimenti sullo schermo', () => {
    expect(recordingPlan({ cameraId: 'c', micId: 'm', screenId: 's' })).toEqual({
      tracks: ['camera', 'screen'],
      audioTrack: 'camera',
    });
    expect(recordingPlan({ cameraId: null, micId: 'm', screenId: 's' })).toEqual({
      tracks: ['screen'],
      audioTrack: 'screen',
    });
    expect(recordingPlan({ cameraId: 'c', micId: null, screenId: null })).toEqual({
      tracks: ['camera'],
      audioTrack: null,
    });
    expect(recordingPlan({ cameraId: null, micId: 'm', screenId: null })).toBeNull();
  });

  it('cronometro ed errori dei dispositivi', () => {
    expect(timerLabel(135_400)).toBe('02:15');
    expect(timerLabel(3_735_000)).toBe('1:02:15');
    expect(mediaErrorMessage(new DOMException('x', 'NotAllowedError'))).toMatch(/Privacy/);
    expect(mediaErrorMessage(new Error('boh'))).toBe('boh');
  });
});
