export interface YouTubePlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getCurrentTime: () => number;
  getPlayerState: () => number;
  setVolume: (percent: number) => void;
  destroy: () => void;
}

export interface YouTubePlayerEvent {
  target: YouTubePlayer;
}

export interface YouTubeStateChangeEvent extends YouTubePlayerEvent {
  data: number;
}

export interface YouTubeErrorEvent extends YouTubePlayerEvent {
  data: number;
}

export interface YouTubePlayerOptions {
  videoId: string;
  width?: string | number;
  height?: string | number;
  playerVars?: Record<string, string | number>;
  events?: {
    onReady?: (event: YouTubePlayerEvent) => void;
    onStateChange?: (event: YouTubeStateChangeEvent) => void;
    onError?: (event: YouTubeErrorEvent) => void;
  };
}

export interface YouTubeApi {
  Player: new (element: HTMLElement, options: YouTubePlayerOptions) => YouTubePlayer;
  PlayerState: {
    ENDED: number;
    PLAYING: number;
    PAUSED: number;
    BUFFERING: number;
    CUED: number;
  };
}

declare global {
  interface Window {
    YT?: YouTubeApi;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
let apiPromise: Promise<YouTubeApi> | null = null;

function validId(value: string | null | undefined): string | null {
  const id = String(value ?? "").trim();
  return YOUTUBE_ID.test(id) ? id : null;
}

/** Достаёт 11-символьный id из ссылки YouTube или из самого id. */
export function parseYouTubeId(raw: string): string | null {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (YOUTUBE_ID.test(value)) return value;

  let url: URL;
  try {
    url = new URL(
      value.startsWith("http://") || value.startsWith("https://") ? value : `https://${value}`,
    );
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./i, "").toLowerCase();
  if (host === "youtu.be") {
    return validId(url.pathname.split("/").filter(Boolean)[0]);
  }
  if (
    host === "youtube.com" ||
    host === "m.youtube.com" ||
    host === "music.youtube.com" ||
    host === "youtube-nocookie.com"
  ) {
    const fromQuery = validId(url.searchParams.get("v"));
    if (fromQuery) return fromQuery;
    const parts = url.pathname.split("/").filter(Boolean);
    if (["shorts", "embed", "live", "v"].includes(parts[0])) return validId(parts[1]);
  }
  return null;
}

export function youtubeWatchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function youtubeThumbnail(videoId: string): string {
  return `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
}

/**
 * Название ролика через oEmbed. Вызывается только на сервере при добавлении
 * трека; при любой ошибке возвращает пустую строку.
 */
export async function fetchYouTubeTitle(videoId: string): Promise<string> {
  const id = validId(videoId);
  if (!id) return "";
  try {
    const target = encodeURIComponent(youtubeWatchUrl(id));
    const response = await fetch(
      `https://www.youtube.com/oembed?format=json&url=${target}`,
      { cache: "no-store", signal: AbortSignal.timeout(3000) },
    );
    if (!response.ok) return "";
    const data = (await response.json()) as { title?: unknown };
    return typeof data.title === "string"
      ? data.title.replace(/\s+/g, " ").trim().slice(0, 120)
      : "";
  } catch {
    return "";
  }
}

/** Загружает IFrame API один раз на страницу. */
export function loadYouTubeApi(): Promise<YouTubeApi> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("YouTube API доступен только в браузере"));
  }
  if (window.YT?.Player) return Promise.resolve(window.YT);
  if (apiPromise) return apiPromise;

  apiPromise = new Promise<YouTubeApi>((resolve, reject) => {
    let settled = false;
    const finish = (api: YouTubeApi) => {
      if (settled) return;
      settled = true;
      resolve(api);
    };
    const fail = () => {
      if (settled) return;
      settled = true;
      apiPromise = null;
      reject(new Error("Не удалось загрузить YouTube IFrame API"));
    };

    const previous = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      previous?.();
      if (window.YT?.Player) finish(window.YT);
      else fail();
    };

    const existing = document.querySelector<HTMLScriptElement>(
      'script[src="https://www.youtube.com/iframe_api"]',
    );
    if (!existing) {
      const script = document.createElement("script");
      script.src = "https://www.youtube.com/iframe_api";
      script.async = true;
      script.onerror = fail;
      document.head.appendChild(script);
    }

    window.setTimeout(() => {
      if (window.YT?.Player) finish(window.YT);
      else fail();
    }, 12_000);
  });

  return apiPromise;
}
