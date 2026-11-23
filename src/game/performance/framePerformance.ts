export function percentile95(samples: readonly number[]): number | undefined {
  if (!samples.length) return undefined;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * .95) - 1];
}

export interface VideoPerformance {
  source?: 'video-frame' | 'playback-quality';
  presentedFps?: number;
  callbackFps?: number;
  skippedCallbacks?: number;
  droppedFrames?: number;
  decodeP95Ms?: number;
  mediaTimelineFps?: number;
  captureTimelineFps?: number;
}

export class VideoPerformanceProbe {
  private readonly usesVideoCallback: boolean;
  private callbackId?: number;
  private lastPresented?: number;
  private presentationStart?: VideoFrameCallbackMetadata;
  private presentationEnd?: VideoFrameCallbackMetadata;
  private stopped = false;
  private callbacks = 0;
  private presented = 0;
  private skipped = 0;
  private decodeSamples: number[] = [];
  private playback?: VideoPlaybackQuality;

  constructor(readonly video: HTMLVideoElement) {
    this.usesVideoCallback = typeof video.requestVideoFrameCallback === 'function';
    this.playback = video.getVideoPlaybackQuality?.();
    if (this.usesVideoCallback) this.callbackId = video.requestVideoFrameCallback(this.onVideoFrame);
  }

  private readonly onVideoFrame: VideoFrameRequestCallback = (_now, metadata) => {
    if (this.stopped) return;
    if (this.lastPresented !== undefined) {
      const frames = metadata.presentedFrames - this.lastPresented;
      if (frames > 0) {
        this.presented += frames;
        this.skipped += frames - 1;
        this.callbacks++;
      }
    }
    this.lastPresented = metadata.presentedFrames;
    this.presentationStart ??= metadata;
    this.presentationEnd = metadata;
    const decodeSeconds = metadata.processingDuration;
    if (typeof decodeSeconds === 'number' && Number.isFinite(decodeSeconds) && decodeSeconds >= 0) {
      this.decodeSamples.push(decodeSeconds * 1000);
    }
    this.callbackId = this.video.requestVideoFrameCallback(this.onVideoFrame);
  };

  read(elapsedMs: number): VideoPerformance {
    const quality = this.video.getVideoPlaybackQuality?.();
    const prior = this.playback;
    this.playback = quality;
    const totalDelta = quality && prior ? quality.totalVideoFrames - prior.totalVideoFrames : undefined;
    const dropDelta = quality && prior ? quality.droppedVideoFrames - prior.droppedVideoFrames : undefined;
    const measuredQuality = totalDelta !== undefined && totalDelta >= 0 && !!quality?.totalVideoFrames
      && dropDelta !== undefined && dropDelta >= 0;
    const fps = (frames: number) => frames * 1000 / elapsedMs;
    const start = this.presentationStart;
    const end = this.presentationEnd;
    const timelineFrames = end && start ? end.presentedFrames - start.presentedFrames : 0;
    const mediaSeconds = end && start ? end.mediaTime - start.mediaTime : 0;
    const captureMs = end?.captureTime !== undefined && start?.captureTime !== undefined
      ? end.captureTime - start.captureTime : 0;
    const result: VideoPerformance = this.usesVideoCallback ? {
      source: 'video-frame',
      presentedFps: fps(this.presented),
      callbackFps: fps(this.callbacks),
      skippedCallbacks: this.skipped,
      decodeP95Ms: percentile95(this.decodeSamples),
      mediaTimelineFps: timelineFrames > 0 && mediaSeconds > 0 ? timelineFrames / mediaSeconds : undefined,
      captureTimelineFps: timelineFrames > 0 && captureMs > 0 ? timelineFrames * 1000 / captureMs : undefined,
    } : measuredQuality ? {
      source: 'playback-quality',
      presentedFps: fps(Math.max(0, totalDelta - dropDelta)),
    } : {};
    if (measuredQuality) result.droppedFrames = dropDelta;
    this.presented = this.skipped = this.callbacks = 0;
    this.presentationStart = this.presentationEnd = undefined;
    this.decodeSamples.length = 0;
    return result;
  }

  stop(): void {
    this.stopped = true;
    if (this.callbackId !== undefined) this.video.cancelVideoFrameCallback?.(this.callbackId);
    this.callbackId = undefined;
  }
}

export interface MainThreadPerformance {
  longTasks?: number;
  longestTaskMs?: number;
  rafStalls: number;
  maxRafGapMs: number;
}

export class MainThreadPerformanceProbe {
  private observer?: PerformanceObserver;
  private longTasks = 0;
  private longestTaskMs = 0;
  private previousFrame?: number;
  private rafStalls = 0;
  private maxRafGapMs = 0;
  private frameId: number;

  constructor() {
    if (typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      this.observer = new PerformanceObserver(entries => this.countLongTasks(entries.getEntries()));
      this.observer.observe({ type: 'longtask' });
    }
    this.frameId = requestAnimationFrame(this.onFrame);
  }

  private countLongTasks(entries: PerformanceEntry[]) {
    for (const entry of entries) {
      this.longTasks++;
      this.longestTaskMs = Math.max(this.longestTaskMs, entry.duration);
    }
  }

  private readonly onFrame: FrameRequestCallback = timestamp => {
    if (this.previousFrame !== undefined) {
      const gap = timestamp - this.previousFrame;
      if (gap >= 50) this.rafStalls++;
      this.maxRafGapMs = Math.max(this.maxRafGapMs, gap);
    }
    this.previousFrame = timestamp;
    this.frameId = requestAnimationFrame(this.onFrame);
  };

  read(): MainThreadPerformance {
    if (this.observer) this.countLongTasks(this.observer.takeRecords());
    const result = {
      longTasks: this.observer ? this.longTasks : undefined,
      longestTaskMs: this.observer ? this.longestTaskMs : undefined,
      rafStalls: this.rafStalls,
      maxRafGapMs: this.maxRafGapMs,
    };
    this.longTasks = this.longestTaskMs = this.rafStalls = this.maxRafGapMs = 0;
    return result;
  }

  stop(): void {
    this.observer?.disconnect();
    cancelAnimationFrame(this.frameId);
  }
}
