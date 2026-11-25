import { describe, expect, it } from 'vitest';
import { appAssetName } from './app-assets.js';

describe('file dell’app per MediaPipe', () => {
  it('serve solo nomi semplici con le estensioni ammesse', () => {
    expect(appAssetName('prisma-app://assets/vision_wasm_internal-Ab12.wasm')).toBe(
      'vision_wasm_internal-Ab12.wasm',
    );
    expect(appAssetName('prisma-app://assets/blaze_face_short_range-x.tflite')).toBe(
      'blaze_face_short_range-x.tflite',
    );
    expect(appAssetName('prisma-app://assets/..%2Fmain%2Findex.js')).toBeNull();
    expect(appAssetName('prisma-app://assets/index.html')).toBeNull();
    expect(appAssetName('prisma-app://altro/a.wasm')).toBeNull();
    expect(appAssetName('prisma-media://assets/a.wasm')).toBeNull();
  });
});
