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
 * Часы и погода липкие (`pp-sticky-clock` в `app/globals.css`): карта
 * прокручивается под ними, а дата, время и погода остаются на виду. Своей
 * прокрутки у стола нет намеренно: липкие блоки внутри области с
 * `overflow-y: auto`, которая сама не прокручивается, к экрану не липнут —
 * на широком экране прокручивается колонка в `RoomScreen`, на телефоне весь
 * документ. Карта по-прежнему единственный блок под часами, а вкладки и
 * инструменты карты липнут следом за часами.
 *
 * Прежний блок «Комната» под картой (код, ссылка, мастер, хранилище) убран:
 * код комнаты, имя и «Выйти» стоят в верхней панели на всю ширину, а пинг и
 * состояние хранилища — там же и в диагностике мастера. Под картой ничего не
 * осталось, поэтому на телефоне до нижней плашки меньше прокрутки.
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
    <div className="px-4 py-4">
      <div className="space-y-5">
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
    </div>
  );
}


