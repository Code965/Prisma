import { describe, expect, it } from 'vitest';
import { VideoProjectSchema, videoRenderKey } from './video.js';
import { DEFAULT_VIDEO_AUDIO, dbToGain, musicFromTrack, pickTrack } from './video-audio.js';
import { DEFAULT_VIDEO_EDIT } from './video-edit.js';

const source = {
  path: 'C:\v.mp4',
  fileName: 'v.mp4',
  sizeBytes: 10,
  durationMs: 1000,
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: 'h264',
  hasAudio: true,
};
const at = '2026-11-24T10:00:00.000Z';
const id = '0b6f6c1e-8f1b-4c2a-9d0e-1a2b3c4d5e6f';

describe('audio del video', () => {
  it('i progetti vecchi tengono l’audio com’era e il render resta valido', () => {
    const oldEdit = { cuts: [], format: '9:16', cropOffset: 0.5, subtitles: 'word' };
    const project = VideoProjectSchema.parse({
      id,
      title: 't',
      source,
      edit: oldEdit,
      createdAt: at,
      updatedAt: at,
    });
    expect(project.edit.audio).toEqual({ clean: false, normalize: false, music: null });
    expect(videoRenderKey(project)).not.toContain('audio');
  });

  it('i progetti nuovi ripuliscono la voce e uniformano il volume', () => {
    const project = VideoProjectSchema.parse({
      id,
      title: 't',
      source,
      createdAt: at,
      updatedAt: at,
    });
    expect(project.edit.audio).toEqual(DEFAULT_VIDEO_AUDIO);
    expect(DEFAULT_VIDEO_EDIT.audio).toEqual(DEFAULT_VIDEO_AUDIO);
    expect(videoRenderKey(project)).toContain('"audio"');
  });

  it('sceglie un brano e ne prepara volume e ducking', () => {
    const tracks = [
      { path: 'a.mp3', fileName: 'a.mp3', durationMs: 1000 },
      { path: 'b.mp3', fileName: 'b.mp3', durationMs: 2000 },
    ];
    expect(pickTrack(tracks, 0.99)?.fileName).toBe('b.mp3');
    expect(pickTrack([], 0.5)).toBeNull();
    expect(musicFromTrack(tracks[0]!)).toMatchObject({ volumeDb: -10, ducking: true });
    expect(dbToGain(-20)).toBeCloseTo(0.1);
    expect(dbToGain(6)).toBe(1);
  });
});
