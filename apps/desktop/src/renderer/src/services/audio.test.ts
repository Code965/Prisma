import type { VideoMusic } from '@prisma-app/shared';
import { describe, expect, it } from 'vitest';
import {
  audioSummary,
  isSpeakingAt,
  missingTrack,
  musicPreviewGain,
  musicPreviewSeconds,
  musicTrackLabel,
  selectTrack,
  trackLabel,
  volumeLabel,
} from './audio';

const music: VideoMusic = {
  path: 'C:\\Musica\\lofi.mp3',
  fileName: 'lofi.mp3',
  durationMs: 60_000,
  volumeDb: -20,
  ducking: true,
};

describe('audio nell’editor', () => {
  it('riconosce quando si parla', () => {
    const words = [{ text: 'Ciao', startMs: 1000, endMs: 1400, p: 1 }];
    expect(isSpeakingAt(words, 1200)).toBe(true);
    expect(isSpeakingAt(words, 1600)).toBe(true);
    expect(isSpeakingAt(words, 2500)).toBe(false);
  });

  it('il brano ricomincia se è più corto del video', () => {
    expect(musicPreviewSeconds(75_000, music)).toBe(15);
  });

  it('volume dell’anteprima: scelto, abbassato mentre si parla, in dissolvenza', () => {
    const middle = { editedMs: 10_000, totalMs: 30_000 };
    expect(musicPreviewGain(music, { ...middle, speaking: false })).toBeCloseTo(0.1);
    expect(musicPreviewGain(music, { ...middle, speaking: true })).toBeCloseTo(0.0224, 3);
    expect(
      musicPreviewGain({ ...music, ducking: false }, { ...middle, speaking: true }),
    ).toBeCloseTo(0.1);
    expect(
      musicPreviewGain(music, { editedMs: 500, totalMs: 30_000, speaking: false }),
    ).toBeCloseTo(0.05);
    expect(musicPreviewGain(music, { editedMs: 30_000, totalMs: 30_000, speaking: false })).toBe(0);
  });

  it('sceglie un brano tenendo volume e ducking', () => {
    const track = { path: 'C:\\Musica\\b.mp3', fileName: 'b.mp3', durationMs: 5000 };
    const base = { clean: true, normalize: true, music };
    expect(selectTrack(base, [track], track.path).music).toMatchObject({
      fileName: 'b.mp3',
      volumeDb: -20,
    });
    expect(selectTrack({ ...base, music: null }, [track], track.path).music).toMatchObject({
      volumeDb: -10,
      ducking: true,
    });
    expect(selectTrack(base, [track], '').music).toBeNull();
  });

  it('etichette', () => {
    expect(volumeLabel(-10)).toBe('−10 dB');
    expect(volumeLabel(0)).toBe('0 dB');
    expect(trackLabel(music)).toBe('lofi · 1:00');
    expect(musicTrackLabel(music)).toBe('lofi · −20 dB · si abbassa quando parli');
    expect(audioSummary({ clean: true, normalize: true, music })).toBe(
      'voce ripulita · volume a −14 LUFS · musica −20 dB',
    );
    expect(audioSummary({ clean: false, normalize: false, music: null })).toBe('audio originale');
    expect(missingTrack({ clean: true, normalize: true, music }, [])).toBe(true);
  });
});
