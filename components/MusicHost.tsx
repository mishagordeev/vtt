"use client";

import { useEffect, useRef, useState } from "react";
import { loadYouTubeApi, type YouTubePlayer } from "@/lib/youtube";
import type { MusicTrack } from "@/lib/types";

interface MusicHostProps {
  tracks: MusicTrack[];
  volume: number;
  clockOffset: number;
  onEnded: (id: string) => void;
}

interface TrackAudioProps {
  track: MusicTrack;
  volume: number;
  clockOffset: number;
  onEnded: (id: string) => void;
}

function TrackAudio({ track, volume, clockOffset, onEnded }: TrackAudioProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<YouTubePlayer | null>(null);
  const trackRef = useRef(track);
  const volumeRef = useRef(volume);
  const endedRef = useRef(onEnded);
  const endedVideoRef = useRef(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    trackRef.current = track;
  }, [track]);

  useEffect(() => {
    volumeRef.current = volume;
  }, [volume]);

  useEffect(() => {
    endedRef.current = onEnded;
  }, [onEnded]);

  useEffect(() => {
    let cancelled = false;
    const node = document.createElement("div");
    hostRef.current?.appendChild(node);

    loadYouTubeApi()
      .then((api) => {
        if (cancelled) {
          node.remove();
          return;
        }
        const player = new api.Player(node, {
          videoId: track.videoId,
          width: "200",
          height: "113",
          playerVars: {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
            playsinline: 1,
            origin: window.location.origin,
          },
          events: {
            onReady: (event) => {
              if (cancelled) return;
              playerRef.current = event.target;
              event.target.setVolume(volumeRef.current);
              setReady(true);
            },
            onStateChange: (event) => {
              if (event.data === api.PlayerState.ENDED) {
                endedVideoRef.current = true;
                endedRef.current(trackRef.current.id);
              }
            },
            onError: () => {
              window.dispatchEvent(
                new CustomEvent("pp:music-error", {
                  detail: { message: "YouTube не даёт встроить этот ролик" },
                }),
              );
            },
          },
        });
        playerRef.current = player;
      })
      .catch(() => {
        if (!cancelled) {
          setReady(false);
          window.dispatchEvent(
            new CustomEvent("pp:music-error", {
              detail: { message: "Не удалось загрузить YouTube IFrame API" },
            }),
          );
        }
      });

    return () => {
      cancelled = true;
      try {
        playerRef.current?.destroy();
      } catch {
        // Плеер мог ещё не создаться.
      }
      playerRef.current = null;
      node.remove();
      setReady(false);
    };
  }, [track.videoId]);

  useEffect(() => {
    if (!ready) return;
    const player = playerRef.current;
    if (!player) return;
    try {
      player.setVolume(volume);
      const serverNow = Date.now() + clockOffset;
      const target = track.playing
        ? track.position + Math.max(0, serverNow - track.startedAt) / 1000
        : track.position;
      const current = player.getCurrentTime();
      if (track.playing) {
        if (endedVideoRef.current) return;
        if (Math.abs(current - target) > 2.5) player.seekTo(target, true);
        const state = player.getPlayerState();
        if (state !== 1 && state !== 3) player.playVideo();
      } else {
        endedVideoRef.current = false;
        if (Math.abs(current - track.position) > 1.2) player.seekTo(track.position, true);
        const state = player.getPlayerState();
        if (state === 1 || state === 3) player.pauseVideo();
      }
    } catch {
      // До onReady методы могут быть недоступны.
    }
  }, [
    ready,
    track.playing,
    track.startedAt,
    track.position,
    volume,
    clockOffset,
  ]);

  useEffect(() => {
    const unlock = (event: Event) => {
      const detail = (event as CustomEvent<{ id?: string | null }>).detail;
      if (detail?.id && detail.id !== trackRef.current.id) return;
      if (!detail?.id && !trackRef.current.playing) return;
      const player = playerRef.current;
      if (!player) return;
      try {
        player.setVolume(volumeRef.current);
        player.playVideo();
      } catch {
        // Ждём onReady.
      }
    };
    window.addEventListener("pp:music-unlock", unlock);
    return () => window.removeEventListener("pp:music-unlock", unlock);
  }, []);

  return <div ref={hostRef} className="h-px w-px overflow-hidden" aria-hidden="true" />;
}

/**
 * Невидимые плееры живут вне вкладок, поэтому музыка не останавливается,
 * когда игрок уходит с «Музыки» в чат или на карту.
 *
 * Итоговая громкость = личный уровень игрока × громкость трека, которую задал мастер.
 */
export function MusicHost({ tracks, volume, clockOffset, onEnded }: MusicHostProps) {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed left-[-10000px] top-0 h-px w-px overflow-hidden"
    >
      {tracks.map((track) => (
        <TrackAudio
          key={track.id}
          track={track}
          volume={Math.round((volume * Math.max(0, Math.min(100, track.volume ?? 100))) / 100)}
          clockOffset={clockOffset}
          onEnded={onEnded}
        />
      ))}
    </div>
  );
}
