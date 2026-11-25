import { describe, expect, it } from 'vitest';
import { convertArgs, isAllowedPermission, recordingTitle } from './recording.js';

describe('registrazione (main)', () => {
  it('permessi: solo webcam, microfono, schermo, appunti e schermo intero', () => {
    expect(isAllowedPermission('media')).toBe(true);
    expect(isAllowedPermission('display-capture')).toBe(true);
    expect(isAllowedPermission('clipboard-sanitized-write')).toBe(true);
    expect(isAllowedPermission('geolocation')).toBe(false);
    expect(isAllowedPermission('notifications')).toBe(false);
  });

  it('converte in H.264 a 30 fps; l’audio solo dove c’è il microfono', () => {
    const camera = convertArgs('camera.webm', 'webcam.mp4', 'camera', true);
    expect(camera).toEqual(expect.arrayContaining(['-c:a', 'aac', '-r', '30', '-crf', '20']));
    const screen = convertArgs('screen.webm', 'schermo.mp4', 'screen', false);
    expect(screen).toContain('-an');
    expect(screen).toContain('22');
  });

  it('titolo con data e ora italiane', () => {
    expect(recordingTitle(new Date('2026-11-25T13:03:00Z'))).toBe(
      'Registrazione del 25 nov, 14:03',
    );
  });
});
