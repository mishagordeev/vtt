"use client";

import type { Character, MapState, WorldState } from "@/lib/types";
import { MapBoard } from "./MapBoard";
import { WorldClock } from "./WorldClock";

interface DeskPanelProps {
  me: string;
  gm: string;
  characters: Character[];
  map: MapState;
  /** Часы кампании и погода. */
  world: WorldState;
  /** Разница «сервер − браузер»: по ней часы одинаковы у всех. */
  clockOffset: number;
  /** Цвет профиля игрока — им рисуется метка на карте. */
  myColor?: string;
  onMapAction: (payload: Record<string, unknown>) => Promise<MapState | null>;
  onWorldAction: (payload: Record<string, unknown>) => Promise<WorldState | null>;
}

/**
 * Стол: часы кампании над картой и сама карта Кас-Хатара.
 *
 * Стол — колонка на всю высоту окна: часы сверху, карта забирает остаток.
 * Часы и погода липкие (`pp-sticky-clock` в `app/globals.css`) и на телефоне
 * остаются на виду, пока прокручивается страница. Своей прокрутки у стола нет
 * намеренно: на широком экране страница не прокручивается вовсе — стол
 * статичен, а двигается только карта внутри своей рамки (перетаскивание и
 * колесо). `h-full` вместе с `min-h-0` нужен, чтобы колонка не разрослась по
 * содержимому и не вытолкнула карту из окна.
 *
 * Прежний блок «Комната» под картой (код, ссылка, мастер, хранилище) убран:
 * код комнаты, имя и «Выйти» стоят в верхней панели на всю ширину, а пинг и
 * состояние хранилища — там же и в диагностике мастера. Под картой ничего не
 * осталось, поэтому карте достаётся вся оставшаяся высота.
 */
export function DeskPanel({
  me,
  gm,
  characters,
  map,
  world,
  clockOffset,
  myColor,
  onMapAction,
  onWorldAction,
}: DeskPanelProps) {
  return (
    <div className="flex h-full min-h-0 flex-col gap-5 px-4 py-4">
      <WorldClock world={world} clockOffset={clockOffset} gm={me.trim().toLowerCase() === gm.trim().toLowerCase()} onAction={onWorldAction} />

      <MapBoard
        me={me}
        gm={gm}
        map={map}
        characters={characters}
        pingColor={myColor}
        onAction={onMapAction}
      />
    </div>
  );
}


