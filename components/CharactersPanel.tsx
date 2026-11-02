"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { exportCharacter } from "@/lib/characterExport";
import { MAX_FLAWS, MAX_TRAITS, canEdit, draftFromCharacter, emptyDraft, requiredFlaws } from "@/lib/characters";
import type { Character, CharacterDraft, Player } from "@/lib/types";
import type { SheetMode } from "./CharacterSheet";

/**
 * Сам лист — самый тяжёлый кусок панели: каталоги снаряжения и знаний,
 * натальная карта, портрет. Он грузится отдельным чанком при первом открытии
 * листа, поэтому карточка со списком открывается без ожидания каталогов.
 */
const CharacterSheet = dynamic(
  () => import("./CharacterSheet").then((mod) => mod.CharacterSheet),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full items-center justify-center p-6">
        <p className="animate-pulse text-sm text-zinc-500">Открываем лист…</p>
      </div>
    ),
  },
);

interface CharactersPanelProps {
  me: string;
  gm: string;
  characters: Character[];
  players: Player[];
  /** Лист, который надо открыть: клик по списку персонажей в правой колонке комнаты. */
  openId?: string | null;
  /** Счётчик кликов по списку: повторный клик по тому же листу тоже открывает его. */
  openRequest?: number;
  /** Счётчик «Новый персонаж»: каждое значение открывает пустой лист. */
  createRequest?: number;
  onCreate: (draft: CharacterDraft) => Promise<Character>;
  onUpdate: (id: string, draft: CharacterDraft) => Promise<Character>;
  onDelete: (id: string) => Promise<void>;
  /** Назначить лист игрокам: привязка синхронна с профилями. */
  onAssignPlayers: (id: string, names: string[]) => Promise<void>;
}

type Mode =
  | { kind: "empty" }
  | { kind: "view"; id: string }
  | { kind: "edit"; id: string }
  | { kind: "create" };

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Время последнего автосохранения для шапки листа. */
function clockNow(): string {
  return new Date().toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
}

/** Проверки листа, которые не дают сохранить черновик. */
function draftProblem(draft: CharacterDraft): string | null {
  if (draft.flaws.length < requiredFlaws(draft.traits.length)) {
    return "Вторая особенность требует изъяна: первая — бесплатно. Добавьте изъян или уберите вторую особенность.";
  }
  if (draft.traits.length > MAX_TRAITS || draft.flaws.length > MAX_FLAWS) {
    return "Можно выбрать не больше двух особенностей и двух изъянов.";
  }
  return null;
}

export function CharactersPanel({
  me,
  gm,
  characters,
  players,
  openId,
  openRequest,
  createRequest,
  onCreate,
  onUpdate,
  onDelete,
  onAssignPlayers,
}: CharactersPanelProps) {
  const [mode, setMode] = useState<Mode>({ kind: "empty" });
  const [draft, setDraft] = useState<CharacterDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [assignFor, setAssignFor] = useState<Character | null>(null);
  const [assignNames, setAssignNames] = useState<string[]>([]);
  const [assignBusy, setAssignBusy] = useState(false);
  /** «ЧЧ:ММ» последнего автосохранения — показывается в шапке листа. */
  const [savedAt, setSavedAt] = useState<string>("");
  /** Снимок последнего сохранённого черновика: по нему видно, есть ли что сохранять. */
  const lastSaved = useRef<string>("");
  /** Очередь сохранений: автосохранение и «Готово» не обгоняют друг друга. */
  const saving = useRef<Promise<void>>(Promise.resolve());
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const draftRef = useRef<CharacterDraft | null>(draft);
  draftRef.current = draft;

  const canEditCharacter = useCallback(
    (character: Character) => canEdit(character, me, gm),
    [gm, me],
  );
  const selected =
    mode.kind === "view" || mode.kind === "edit"
      ? characters.find((entry) => entry.id === mode.id)
      : undefined;

  const open = useCallback(
    (character: Character) => {
      // Лист открывается как обычный лист. Кнопка «Править» включает правку,
      // дальше всё сохраняется само: кнопки «Сохранить» нет.
      const next = draftFromCharacter(character);
      lastSaved.current = JSON.stringify(next);
      setSavedAt("");
      setMode({ kind: "view", id: character.id });
      setDraft(next);
      setError(null);
    },
    [],
  );

  useEffect(() => {
    if (mode.kind === "empty" && characters.length > 0) open(characters[0]);
  }, [characters, mode.kind, open]);

  useEffect(() => {
    if (mode.kind === "view" && selected) setDraft(draftFromCharacter(selected));
  }, [mode.kind, selected]);

  useEffect(() => {
    if ((mode.kind === "view" || mode.kind === "edit") && !selected) {
      setMode({ kind: "empty" });
      setDraft(null);
    }
  }, [mode.kind, selected]);

  /**
   * Список персонажей живёт в правой колонке комнаты: клик по карточке присылает
   * сюда id, кнопка «Новый» — счётчик. Панель только открывает нужный лист.
   */
  useEffect(() => {
    if (!openId || !openRequest) return;
    if ((mode.kind === "view" || mode.kind === "edit") && mode.id === openId) return;
    const character = characters.find((entry) => entry.id === openId);
    if (!character) return;
    if (
      mode.kind === "create" &&
      !window.confirm("Новый лист ещё не создан — заполненное пропадёт. Продолжить?")
    ) {
      return;
    }
    if (mode.kind === "edit") void enqueueSave();
    open(character);
    // open() и enqueueSave() читают актуальные mode и draft сами.
  }, [openRequest, characters]);

  useEffect(() => {
    if (!createRequest) return;
    startCreate();
  }, [createRequest]);

  function startCreate() {
    if (mode.kind === "create") {
      if (!window.confirm("Несохранённые изменения будут потеряны. Продолжить?")) return;
    }
    // Правленый лист сохраняем перед уходом к новому.
    if (mode.kind === "edit") void enqueueSave();
    const next = emptyDraft();
    lastSaved.current = JSON.stringify(next);
    setSavedAt("");
    setMode({ kind: "create" });
    setDraft(next);
    setError(null);
  }

  function startEdit() {
    if (!selected) return;
    const next = draftFromCharacter(selected);
    lastSaved.current = JSON.stringify(next);
    setSavedAt("");
    setDraft(next);
    setMode({ kind: "edit", id: selected.id });
    setError(null);
  }

  /** «Готово»: досохраняем хвост правки (если он есть) и возвращаемся к чтению. */
  function finishEdit() {
    if (mode.kind === "edit") {
      void enqueueSave({ close: true });
      return;
    }
    if (mode.kind === "create") {
      setMode({ kind: "empty" });
      setDraft(null);
      setSavedAt("");
      setError(null);
    }
  }

  /**
   * Сохранение через очередь. Вызывается автосохранением после ввода, кнопкой
   * «Готово» и переходом к другому листу; повторный вызов не плодит запросы.
   */
  function enqueueSave(options: { close?: boolean } = {}): Promise<void> {
    const current = draft;
    const currentMode = mode;
    if (!current || currentMode.kind !== "edit") return saving.current;
    const id = currentMode.id;
    const snapshot = JSON.stringify(current);
    if (snapshot === lastSaved.current) {
      if (options.close) setMode({ kind: "view", id });
      return saving.current;
    }
    const problem = draftProblem(current);
    if (problem) {
      setError(problem);
      return saving.current;
    }
    if (!current.name.trim()) return saving.current;
    const task = saving.current.then(async () => {
      setBusy(true);
      setError(null);
      try {
        const saved = await onUpdate(id, current);
        const next = draftFromCharacter(saved);
        lastSaved.current = JSON.stringify(next);
        setSavedAt(clockNow());
        if (options.close) {
          setMode({ kind: "view", id: saved.id });
        } else {
          // Если за время запроса игрок успел напечатать ещё, его ввод не затираем.
          const active = modeRef.current;
          const latest = draftRef.current ? JSON.stringify(draftRef.current) : "";
          if (active.kind === "edit" && active.id === saved.id && latest === snapshot) {
            setDraft(next);
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Не удалось сохранить персонажа");
      } finally {
        setBusy(false);
      }
    });
    saving.current = task.catch(() => undefined);
    return saving.current;
  }

  // Автосохранение: как только поля изменены и пауза в вводе — пишем на сервер.
  useEffect(() => {
    if (mode.kind !== "edit" || !draft) return;
    if (JSON.stringify(draft) === lastSaved.current) return;
    const timer = window.setTimeout(() => {
      void enqueueSave();
    }, 900);
    return () => window.clearTimeout(timer);
    // enqueueSave завязан на актуальные draft и mode, поэтому список зависимостей короткий.
  }, [draft, mode]);

  async function createSheet() {
    if (!draft || busy) return;
    const problem = draftProblem(draft);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const saved = await onCreate(draft);
      const next = draftFromCharacter(saved);
      lastSaved.current = JSON.stringify(next);
      setSavedAt(clockNow());
      setMode({ kind: "edit", id: saved.id });
      setDraft(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось сохранить персонажа");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!selected) return;
    try {
      await onDelete(selected.id);
      setMode({ kind: "empty" });
      setDraft(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось удалить персонажа");
    }
  }

  const sheetMode: SheetMode =
    mode.kind === "create" ? "create" : mode.kind === "edit" ? "edit" : "view";
  const canEditSheet = mode.kind === "create" || (selected ? canEditCharacter(selected) : false);

  function openAssign(character: Character) {
    setAssignFor(character);
    setAssignNames(character.players ?? []);
  }

  async function saveAssign() {
    if (!assignFor || assignBusy) return;
    setAssignBusy(true);
    try {
      await onAssignPlayers(assignFor.id, assignNames);
      setAssignFor(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Не удалось назначить игроков");
    } finally {
      setAssignBusy(false);
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <section className="min-h-0 flex-1 overflow-hidden">
        {draft ? (
          <CharacterSheet
            key={mode.kind === "create" ? "new" : mode.kind === "view" || mode.kind === "edit" ? mode.id : "none"}
            draft={draft}
            mode={sheetMode}
            canEdit={canEditSheet}
            busy={busy}
            error={error}
            owner={
              selected && (selected.players?.length ?? 0) > 0
                ? (selected.players ?? []).join(", ")
                : (selected?.owner ?? me)
            }
            savedAt={savedAt}
            canAssign={mode.kind !== "create" && selected ? canEditCharacter(selected) : false}
            onAssign={selected ? () => openAssign(selected) : undefined}
            onChange={setDraft}
            onSave={() => void createSheet()}
            onCancel={finishEdit}
            onEdit={startEdit}
            onDelete={() => void remove()}
            onExport={(format) => {
              if (selected) exportCharacter(selected, format);
              else setError("Сначала сохраните персонажа");
            }}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-6">
            <div className="max-w-sm text-center">
              <p className="text-sm text-zinc-400">Выберите персонажа в панели справа от карты.</p>
              <p className="mt-1 text-xs text-zinc-600">
                Кнопка «Новый» в том же списке открывает пустой лист: в нём сверху имя,
                происхождение, возраст и дата рождения, ниже характеристики, испытания, ОЗ и
                класс брони, груз и деньги, навыки и знания, заметки, а снаряжение — справа.
              </p>
            </div>
          </div>
        )}
      </section>


      {assignFor ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/70 p-4 backdrop-blur-sm"
          onPointerDown={(event) => {
            if (event.target === event.currentTarget) setAssignFor(null);
          }}
        >
          <div className="w-full max-w-sm rounded-2xl border border-zinc-700 bg-zinc-900 p-4 shadow-2xl">
            <h3 className="text-sm font-semibold text-zinc-100">Игроки листа</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
              «{assignFor.name}» — один лист можно назначить нескольким игрокам. Привязка сразу
              появится в их профилях.
            </p>
            <div className="scroll-thin mt-2 max-h-56 space-y-1 overflow-y-auto pr-1">
              {players.map((player) => {
                const checked = assignNames.some((name) => sameName(name, player.name));
                return (
                  <label
                    key={player.name}
                    className={`flex items-center gap-2 rounded-lg border px-2 py-1 ${
                      checked
                        ? "border-emerald-500/40 bg-emerald-500/5"
                        : "border-zinc-800 bg-zinc-950/40"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setAssignNames((prev) =>
                          checked
                            ? prev.filter((name) => !sameName(name, player.name))
                            : [...prev, player.name],
                        )
                      }
                      className="accent-emerald-500"
                    />
                    <span
                      className="h-3 w-3 rounded-full"
                      style={{ backgroundColor: player.color || "#8a6a2f" }}
                    />
                    <span className="min-w-0 flex-1 truncate text-xs text-zinc-200">
                      {player.name}
                    </span>
                    {sameName(player.name, assignFor.owner) ? (
                      <span className="text-[9px] uppercase text-zinc-500">владелец</span>
                    ) : null}
                  </label>
                );
              })}
              {players.length === 0 ? (
                <p className="text-[11px] text-zinc-600">За столом пока никого.</p>
              ) : null}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={() => void saveAssign()}
                disabled={assignBusy}
                className="rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-semibold text-emerald-950 transition hover:bg-emerald-400 disabled:opacity-40"
              >
                {assignBusy ? "Сохраняю…" : "Сохранить"}
              </button>
              <button
                type="button"
                onClick={() => setAssignFor(null)}
                className="rounded-lg border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-600"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

