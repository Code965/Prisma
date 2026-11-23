import type { VideoSource } from '@prisma-app/shared';
import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

interface ProbeStream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  tags?: { rotate?: string };
  side_data_list?: Array<{ rotation?: number }>;
}

interface ProbeOutput {
  streams?: ProbeStream[];
  format?: { duration?: string; size?: string };
}

/** «30000/1001» → 29,97. */
function frameRate(value: string | undefined): number | null {
  if (!value) return null;
  const [num, den] = value.split('/').map(Number);
  if (!num || !den) return null;
  return Math.round((num / den) * 1000) / 1000;
}

/**
 * Metadati dal JSON di `ffprobe -show_format -show_streams`. I video girati in verticale col
 * telefono hanno spesso larghezza e altezza «da sdraiati» e una rotazione: si scambiano.
 */
export function parseProbe(output: ProbeOutput, path: string): VideoSource {
  const video = output.streams?.find((s) => s.codec_type === 'video');
  if (!video?.width || !video.height) throw new Error('Il file non contiene una traccia video');
  const rotation = Math.abs(
    Number(
      video.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ??
        video.tags?.rotate ??
        0,
    ),
  );
  const rotated = rotation === 90 || rotation === 270;
  const durationSeconds = Number(output.format?.duration ?? 0);
  return {
    path,
    fileName: basename(path),
    sizeBytes: Number(output.format?.size ?? 0),
    durationMs: Math.round(durationSeconds * 1000),
    width: rotated ? video.height : video.width,
    height: rotated ? video.width : video.height,
    fps: frameRate(video.avg_frame_rate) ?? frameRate(video.r_frame_rate) ?? 30,
    videoCodec: video.codec_name ?? null,
    hasAudio: output.streams?.some((s) => s.codec_type === 'audio') ?? false,
  };
}

export async function probeVideo(ffprobePath: string, path: string): Promise<VideoSource> {
  const { stdout } = await run(
    ffprobePath,
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', path],
    { timeout: 60_000, windowsHide: true, maxBuffer: 16 * 1024 * 1024 },
  );
  return parseProbe(JSON.parse(stdout) as ProbeOutput, path);
}
