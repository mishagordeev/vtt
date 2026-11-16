"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  MAP_FONT_OPTIONS,
  MAP_FONT_STACK,
  MAP_TEXT_MAX_LENGTH,
  MAP_TEXT_REVEAL_MS,
  MAP_TEXT_SIZES,
  mapPointDiameter,
  nearestMapTextSize,
  sanitizeMapText,
} from "@/lib/mapText";
import { ensureMapTabs, entryTabId, MAP_GRID } from "@/lib/mapTabs";
import { HEX_SCALE, MAP_RASTER } from "@/lib/mapScale";
import {
  MAP_VIEW_DEFAULT,
  MAP_ZOOM_BUTTON_STEP,
  clampMapView,
  isMapPanButton,
  isMapPanKey,
  mapCursor,
  mapViewTransform,
  mapWheelScale,
  mapZoomLabel,
  zoomMapView,
  type MapView,
} from "@/lib/mapView";
import type { Character, MapFont, MapPoint, MapState, MapStroke, MapText } from "@/lib/types";

interface MapBoardProps {
  me: string;
  gm: string;
  map: MapState;
  /** Листы комнаты: из них мастер выбирает, кому видна запись. */
  characters: Character[];
  /** Личный цвет игрока: им рисуется метка-круг. */
  pingColor?: string;
  onAction: (payload: Record<string, unknown>) => Promise<MapState | null>;
}

const PING_TTL = 3_000;
const MAX_POINTS = 600;
const POINT_STEP = 0.0025;
const CLICK_DISTANCE = 0.006;
const COLORS = ["#fb7185", "#38bdf8", "#a3e635", "#facc15", "#e879f9", "#f8fafc"];
const WIDTHS = [
  { label: "тонко", value: 0.002 },
  { label: "средне", value: 0.004 },
  { label: "жирно", value: 0.008 },
];

function colorFor(name: string): string {
  let hash = 0;
  for (let index = 0; index < name.length; index += 1) {
    hash = (hash * 31 + name.charCodeAt(index)) >>> 0;
  }
  return COLORS[hash % COLORS.length];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function drawStroke(
  context: CanvasRenderingContext2D,
  stroke: Pick<MapStroke, "points" | "color" | "width">,
  width: number,
  height: number,
) {
  if (stroke.points.length === 0) return;
  const lineWidth = Math.max(1, stroke.width * width);
  context.strokeStyle = stroke.color;
  context.fillStyle = stroke.color;
  context.lineWidth = lineWidth;
  context.lineCap = "round";
  context.lineJoin = "round";
  if (stroke.points.length === 1) {
    const point = stroke.points[0];
    context.beginPath();
    context.arc(point.x * width, point.y * height, lineWidth / 2, 0, Math.PI * 2);
    context.fill();
    return;
  }
  context.beginPath();
  stroke.points.forEach((point, index) => {
    const x = point.x * width;
    const y = point.y * height;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
}
export function MapBoard({ me, gm, map, characters, pingColor, onAction }: MapBoardProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  /**
   * Начало перетаскивания карты: точка нажатия, сдвиг вида в этот момент и
   * признак «короткое нажатие ставит метку» (пробел и средняя кнопка — нет).
   */
  const panRef = useRef<{
    x: number;
    y: number;
    viewX: number;
    viewY: number;
    ping: boolean;
  } | null>(null);
  /** Зажат пробел: карта тянется поверх выбранного инструмента. */
  const spaceRef = useRef(false);
  /** Курсор над рамкой: только там пробел тянет карту, а не прокручивает стол. */
  const hoverRef = useRef(false);
  const currentRef = useRef<MapPoint[]>([]);
  const startRef = useRef<MapPoint | null>(null);
  const movedRef = useRef(false);
  const imageRef = useRef<HTMLImageElement>(null);

  const [size, setSize] = useState({ width: 0, height: 0 });
  // «Рука» выбрана сразу: зажать ЛКМ над картой и потянуть — обычный способ
  // осмотреться; рисование начинается только с выбранного инструмента.
  const [tool, setTool] = useState<"hand" | "pen" | "erase" | "text" | "point">("hand");
  // Временная «Рука»: зажали пробел или среднюю кнопку — карта едет, а кисть
  // остаётся кистью. Состояние нужно только для курсора, нажатие смотрит в ref.
  const [tempHand, setTempHand] = useState(false);
  // Вид карты: масштаб и сдвиг сцены внутри рамки. Колесо над картой считает
  // масштаб от курсора, «Рука» тянет сцену, «⟲» возвращает карту целиком.
  const [view, setView] = useState<MapView>(MAP_VIEW_DEFAULT);
  const [color, setColor] = useState(COLORS[0]);
  const [width, setWidth] = useState(WIDTHS[1].value);
  const [current, setCurrent] = useState<MapPoint[]>([]);
  const [erasePoint, setErasePoint] = useState<MapPoint | null>(null);
  const [error, setError] = useState("");
  const [pixels, setPixels] = useState<{ width: number; height: number } | null>(null);
  // Редактор надписи: текст, цвет, шрифт и размер. Пока editingTextId пуст —
  // готовится новая надпись, иначе правится выбранная с карты.
  const [text, setText] = useState("");
  const [textColor, setTextColor] = useState(COLORS[5]);
  const [textFont, setTextFont] = useState<MapFont>("serif");
  const [textSize, setTextSize] = useState(MAP_TEXT_SIZES[1].value);
  // Кому видна запись: undefined — всем (так её ставят по умолчанию), пустой
  // список — только мастеру, иначе — игрокам выбранных листов.
  const [textAudience, setTextAudience] = useState<string[] | undefined>(undefined);
  const [editingTextId, setEditingTextId] = useState<string | null>(null);
  // Открытый текст точки: id и время нажатия (по нему перезапускается таймер).
  const [revealed, setRevealed] = useState<{ id: string; at: number } | null>(null);
  const [, setTick] = useState(0);

  // Вкладки карты: сами вкладки общие (их список приходит с сервера), а какую
  // смотрит игрок — решает он сам. Записи фильтруются по выбранной вкладке.
  const tabs = useMemo(() => ensureMapTabs(map.tabs), [map.tabs]);
  const [activeTab, setActiveTab] = useState(tabs[0].id);
  useEffect(() => {
    if (!tabs.some((entry) => entry.id === activeTab)) setActiveTab(tabs[0].id);
  }, [tabs, activeTab]);
  const tab = tabs.find((entry) => entry.id === activeTab) ?? tabs[0];
  const strokes = useMemo(
    () => map.strokes.filter((stroke) => entryTabId(stroke, tabs) === tab.id),
    [map.strokes, tabs, tab.id],
  );

  // Переключили вкладку — незаконченный штрих, редактор и вид остаются от старой карты.
  useEffect(() => {
    currentRef.current = [];
    panRef.current = null;
    setCurrent([]);
    setEditingTextId(null);
    setRevealed(null);
    setErasePoint(null);
    setView(MAP_VIEW_DEFAULT);
  }, [activeTab]);

  // Картинка могла прийти из кэша до подписки на onLoad — тогда размер берём сразу.
  useEffect(() => {
    const image = imageRef.current;
    if (image?.complete && image.naturalWidth > 0) {
      setPixels({ width: image.naturalWidth, height: image.naturalHeight });
    }
  }, []);

  useEffect(() => {
    const id = setInterval(() => setTick((value) => value + 1), 1_000);
    return () => clearInterval(id);
  }, []);

  const isGM = me.trim().toLowerCase() === gm.trim().toLowerCase();

  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    const update = () => {
      const rect = node.getBoundingClientRect();
      setSize({ width: rect.width, height: rect.height });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  // Стол изменил ширину — сдвиг поджимается, чтобы карта не оторвалась от рамки.
  useEffect(() => {
    setView((previous) => clampMapView(previous, size));
  }, [size]);

  // Временная «Рука» с клавиатуры: пока зажат пробел, карта едет поверх любого
  // инструмента — на большом плане не нужно бросать кисть, чтобы подвинуть вид.
  // В поле ввода и селекте пробел остаётся пробелом: надпись «Лагерь бандитов»
  // набирается как обычно.
  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      if (!(target instanceof HTMLElement)) return false;
      return (
        target.isContentEditable ||
        target.tagName === "INPUT" ||
        target.tagName === "TEXTAREA" ||
        target.tagName === "SELECT"
      );
    };
    const release = () => {
      spaceRef.current = false;
      setTempHand(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!isMapPanKey(event.code) || isTyping(event.target)) return;
      // Над картой пробел тянет её, а не прокручивает стол под рамкой.
      if (hoverRef.current) event.preventDefault();
      spaceRef.current = true;
      setTempHand(true);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (isMapPanKey(event.code)) release();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    // Ушли из окна с зажатым пробелом — рука отпускается, иначе карта «залипнет».
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", release);
    };
  }, []);

  // Колесо над картой — масштаб, а не прокрутка стола. Слушатель нативный:
  // React вешает `onWheel` пассивным, и `preventDefault` в нём не сработал бы.
  useEffect(() => {
    const node = wrapRef.current;
    if (!node) return;
    // Средняя кнопка тянет карту: без этого Chrome открывает автоскролл страницы.
    const onMouseDown = (event: MouseEvent) => {
      if (isMapPanButton(event.button)) event.preventDefault();
    };
    const onWheel = (event: WheelEvent) => {
      // Над панелью инструментов колесо не перехватываем: там списки и поля.
      if (event.target instanceof Element && event.target.closest("[data-map-controls]")) return;
      event.preventDefault();
      const rect = node.getBoundingClientRect();
      const box = { width: rect.width, height: rect.height };
      const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
      setView((previous) =>
        zoomMapView(
          previous,
          mapWheelScale(previous.scale, event.deltaY, event.deltaMode),
          point,
          box,
        ),
      );
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    node.addEventListener("mousedown", onMouseDown);
    return () => {
      node.removeEventListener("wheel", onWheel);
      node.removeEventListener("mousedown", onMouseDown);
    };
  }, []);

  useEffect(() => {
    if (tool === "pen" || tool === "hand") setErasePoint(null);
    // Ушли с инструмента надписей и точек — выбор снимается, введённый текст не теряется.
    if (tool !== "text" && tool !== "point") setEditingTextId(null);
  }, [tool]);

  // Подпись точки видна 5 секунд; повторное нажатие по ней перезапускает отсчёт.
  useEffect(() => {
    if (!revealed) return;
    const timer = setTimeout(() => setRevealed(null), MAP_TEXT_REVEAL_MS);
    return () => clearTimeout(timer);
  }, [revealed]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width === 0 || size.height === 0) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(size.width * dpr));
    canvas.height = Math.max(1, Math.floor(size.height * dpr));
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.clearRect(0, 0, size.width, size.height);
    for (const stroke of strokes) {
      drawStroke(context, stroke, size.width, size.height);
    }
    if (current.length > 0 && tool === "pen") {
      drawStroke(context, { points: current, color, width }, size.width, size.height);
    }
  }, [strokes, current, size, tool, color, width]);

  /**
   * Точка рамки → доля карты. Считается через масштаб и сдвиг вида: при
   * увеличении клик попадает туда, где виден рисунок, а не в угол карты.
   */
  function pointFrom(event: React.PointerEvent<HTMLDivElement>): MapPoint {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return { x: 0, y: 0 };
    return {
      x: clamp01((event.clientX - rect.left - view.x) / view.scale / rect.width),
      y: clamp01((event.clientY - rect.top - view.y) / view.scale / rect.height),
    };
  }

  /** Метка цветом профиля: короткое нажатие по карте без движения. */
  function ping(point: MapPoint) {
    void onAction({
      action: "ping",
      x: point.x,
      y: point.y,
      color: pingColor || colorFor(me),
      tab: tab.id,
    }).then((result) => {
      setError(result ? "" : "Не удалось показать метку");
    });
  }

  /** Кнопки «−» и «+»: масштаб меняется вокруг середины рамки. */
  function zoomBy(factor: number) {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    const box = { width: rect.width, height: rect.height };
    const centre = { x: rect.width / 2, y: rect.height / 2 };
    setView((previous) => zoomMapView(previous, previous.scale * factor, centre, box));
  }

  async function commit() {
    const points = currentRef.current.slice(0, MAX_POINTS);
    currentRef.current = [];
    setCurrent([]);
    if (tool === "erase") setErasePoint(null);
    if (points.length === 0) return;
    // Вкладка едет вместе со штрихом и ластиком: без неё сервер относит запись
    // к первой карте, и линия со второй вкладки пропадала с глаз на первую.
    const payload =
      tool === "pen"
        ? { action: "stroke", points, color, width, tab: tab.id }
        : { action: "erase", points, radius: Math.max(0.02, width * 5), tab: tab.id };
    const result = await onAction(payload);
    setError(result ? "" : "Не удалось сохранить рисунок");
  }

  /** Начать сдвиг карты: точка нажатия, сдвиг вида и право на метку по клику. */
  function startPan(event: React.PointerEvent<HTMLDivElement>, ping: boolean) {
    event.currentTarget.setPointerCapture(event.pointerId);
    panRef.current = {
      x: event.clientX,
      y: event.clientY,
      viewX: view.x,
      viewY: view.y,
      ping,
    };
    startRef.current = pointFrom(event);
    movedRef.current = false;
    setErasePoint(null);
  }

  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    // Средняя кнопка мыши — временная «Рука»: карта едет, а инструмент не меняется.
    const middle = isMapPanButton(event.button);
    if (event.button !== 0 && !middle) return;
    // Пробел, зажатый над картой, тоже делает руку временной — даже если выбрана
    // кисть или ластик. Короткое нажатие здесь метку не ставит: это осмотр, не бросок.
    if (middle || (event.button === 0 && spaceRef.current)) {
      startPan(event, false);
      return;
    }
    // Открытый текст точки закрывается кликом по карте — и не ставит заодно метку.
    if (revealed) {
      setRevealed(null);
      return;
    }
    // «Рука»: зажатая ЛКМ тянет карту, короткое нажатие остаётся меткой.
    if (tool === "hand") {
      startPan(event, true);
      return;
    }
    if (tool === "text" || tool === "point") {
      // Надпись ставит только мастер; игроку — подсказка вместо клика.
      if (!isGM) {
        setError("Надписи на карте ставит только мастер");
        return;
      }
      event.currentTarget.setPointerCapture(event.pointerId);
      startRef.current = pointFrom(event);
      movedRef.current = false;
      drawingRef.current = true;
      setErasePoint(null);
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    const point = pointFrom(event);
    startRef.current = point;
    movedRef.current = false;
    drawingRef.current = true;
    currentRef.current = [];
    setCurrent([]);
    setErasePoint(null);
  }

  function handlePointerMove(event: React.PointerEvent<HTMLDivElement>) {
    // Сдвиг карты считается в пикселях рамки: масштаб здесь не мешает.
    const pan = panRef.current;
    if (pan) {
      const dx = event.clientX - pan.x;
      const dy = event.clientY - pan.y;
      if (!movedRef.current && Math.hypot(dx, dy) > 2) movedRef.current = true;
      setView(
        clampMapView({ scale: view.scale, x: pan.viewX + dx, y: pan.viewY + dy }, size),
      );
      return;
    }
    const point = pointFrom(event);
    if (tool === "text" || tool === "point") {
      if (!drawingRef.current) return;
      const start = startRef.current ?? point;
      if (Math.hypot(point.x - start.x, point.y - start.y) > CLICK_DISTANCE) movedRef.current = true;
      return;
    }
    if (drawingRef.current) {
      const start = startRef.current ?? point;
      if (!movedRef.current) {
        if (Math.hypot(point.x - start.x, point.y - start.y) < CLICK_DISTANCE) return;
        movedRef.current = true;
        currentRef.current = tool === "pen" ? [start, point] : [start];
        if (tool === "pen") setCurrent([start, point]);
      }
      const points = currentRef.current;
      const last = points[points.length - 1];
      if (!last || Math.hypot(point.x - last.x, point.y - last.y) > POINT_STEP) {
        points.push(point);
        if (points.length >= MAX_POINTS) {
          drawingRef.current = false;
          void commit();
          return;
        }
        if (tool === "pen") setCurrent([...points]);
        else setErasePoint(point);
      }
      return;
    }
    if (tool === "erase") setErasePoint(point);
  }

  function handlePointerUp() {
    // Отпустили «руку»: перетаскивание закончилось, короткое нажатие — метка.
    // Временная «Рука» (пробел и средняя кнопка) метку не ставит: ею только смотрят.
    const pan = panRef.current;
    if (pan) {
      panRef.current = null;
      const start = startRef.current;
      startRef.current = null;
      if (pan.ping && !movedRef.current && start) ping(start);
      return;
    }
    if (!drawingRef.current) return;
    drawingRef.current = false;
    const start = startRef.current;
    startRef.current = null;
    if (tool === "text" || tool === "point") {
      setErasePoint(null);
      if (!movedRef.current && start) void addText(start);
      return;
    }
    if (!movedRef.current && start) {
      currentRef.current = [];
      setCurrent([]);
      setErasePoint(null);
      ping(start);
      return;
    }
    void commit();
  }

  async function clearBoard() {
    if (!isGM) return;
    if (!window.confirm("Очистить линии и надписи на этой вкладке?")) return;
    const result = await onAction({ action: "clear", tab: tab.id });
    setError(result ? "" : "Очистить карту может только мастер");
  }

  /** Новая вкладка — белый лист с серой сеткой того же размера, что карта. */
  async function addTab() {
    const result = await onAction({ action: "tabAdd" });
    if (!result) {
      setError("Вкладку карты добавляет только мастер");
      return;
    }
    const next = ensureMapTabs(result.tabs);
    setError("");
    setActiveTab(next[next.length - 1].id);
  }

  async function removeTab() {
    if (!isGM || tab.kind === "kas-khatar") return;
    if (!window.confirm(`Удалить вкладку «${tab.name}» вместе с рисунками и надписями?`)) return;
    const result = await onAction({ action: "tabRemove", id: tab.id });
    if (!result) {
      setError("Удалить вкладку карты может только мастер");
      return;
    }
    setError("");
    setActiveTab(ensureMapTabs(result.tabs)[0].id);
  }

  /** Новая надпись или точка — по клику на карту, пока ничего не выбрано для правки. */
  async function addText(point: MapPoint) {
    if (editingTextId) {
      // Иначе клик по карте в режиме правки молча ставил бы дубль выбранной надписи.
      setError("Сначала сохраните или отмените правку надписи");
      return;
    }
    const label = sanitizeMapText(text);
    if (!label) {
      setError(tool === "point" ? "Сначала введите текст точки" : "Сначала введите текст надписи");
      return;
    }
    const result = await onAction({
      action: "text",
      kind: tool === "point" ? "point" : "label",
      text: label,
      x: point.x,
      y: point.y,
      color: textColor,
      font: textFont,
      size: textSize,
      tab: tab.id,
      // null — запись общая; пустой список значил бы «только мастер».
      audience: textAudience ?? null,
    });
    if (!result) {
      setError("Надпись не сохранилась: её ставит только мастер");
      return;
    }
    setError("");
    setText("");
  }

  /** Кто видит запись — подпись для редактора и подсказки у мастера. */
  function audienceLabel(audience: string[] | undefined): string {
    if (!Array.isArray(audience)) return "видят все";
    if (audience.length === 0) return "видит только мастер";
    const names = audience.map(
      (id) => characters.find((character) => character.id === id)?.name ?? "удалённый лист",
    );
    return `видят: ${names.join(", ")}`;
  }

  /** Отметить или снять лист в аудитории записи: пустой список — только мастер. */
  function toggleAudience(id: string) {
    setTextAudience((previous) => {
      const list = Array.isArray(previous) ? previous : [];
      return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
    });
  }

  /** Выбрать надпись или точку с карты: её текст, цвет, шрифт и размер едут в редактор. */
  function pickText(entry: MapText) {
    setEditingTextId(entry.id);
    setTool(entry.kind === "point" ? "point" : "text");
    setText(entry.text);
    setTextColor(entry.color);
    setTextFont(entry.font);
    setTextSize(nearestMapTextSize(entry.size));
    setTextAudience(Array.isArray(entry.audience) ? entry.audience : undefined);
    setError("");
  }

  /** Нажатие на точку: текст открывается на 5 секунд, мастеру ещё и редактор. */
  function revealText(entry: MapText) {
    setRevealed({ id: entry.id, at: Date.now() });
    setError("");
    if (isGM && (tool === "text" || tool === "point")) pickText(entry);
  }

  async function saveText() {
    if (!editingTextId) return;
    const label = sanitizeMapText(text);
    if (!label) {
      setError("Сначала введите текст надписи");
      return;
    }
    const result = await onAction({
      action: "textUpdate",
      id: editingTextId,
      text: label,
      color: textColor,
      font: textFont,
      size: textSize,
      // null снимает ограничение: запись снова видят все.
      audience: textAudience ?? null,
    });
    if (!result) {
      setError("Сохранить надпись может только мастер");
      return;
    }
    setError("");
    setEditingTextId(null);
    setText("");
  }

  async function removeText() {
    if (!editingTextId) return;
    if (!window.confirm("Удалить надпись с карты?")) return;
    const result = await onAction({ action: "textRemove", id: editingTextId });
    if (!result) {
      setError("Удалить надпись может только мастер");
      return;
    }
    setError("");
    setEditingTextId(null);
    setText("");
  }

  function cancelText() {
    setEditingTextId(null);
    setText("");
    setError("");
  }

  const pings = (map.pings ?? []).filter(
    (ping) => Date.now() - ping.createdAt < PING_TTL && entryTabId(ping, tabs) === tab.id,
  );
  const texts = (map.texts ?? []).filter((entry) => entryTabId(entry, tabs) === tab.id);
  // Курсор рамки: зажатый пробел (временная «Рука») показывает захват даже над кистью.
  const cursor = mapCursor(tool, tempHand);
  return (
    <section>
      {/* Заголовок вкладки и счётчик меток — и больше ничего: абзац-пояснение
          под заголовком убран, он отнимал высоту у самой карты, а те же правила
          есть в подсказках кнопок («Рука», «Точка», «Видят»). */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.22em] text-zinc-500">
          {tab.kind === "kas-khatar" ? "Карта Кас-Хатара" : tab.name}
        </h2>
        <span className="rounded border border-zinc-800 bg-zinc-900/60 px-2 py-0.5 text-[10px] text-zinc-500">
          метки: {pings.length}
        </span>
      </div>

      {/* Шапка карты — вкладки и инструменты — липнет под часами: смещение
          считает `pp-sticky-map-head` в `app/globals.css` по высоте закреплённой
          панели с погодой (`--pp-clock-h`). Вкладки стоят под плашкой с погодой,
          инструменты — над самой картой, и при прокрутке стола ни те, ни другие
          не уезжают под верхнюю плашку. */}
      <div
        className="pp-sticky-map-head space-y-1 rounded-lg border border-zinc-800 bg-zinc-900/95 p-1 shadow-lg backdrop-blur"
        data-map-head
      >
        {/* Вкладки карт: «Кас-Хатар» и полотна, которые мастер добавляет сам.
            Новая вкладка — белый лист с серой сеткой по размеру карты. */}
        <div className="flex flex-wrap items-center gap-1" data-map-tabs>
          {tabs.map((entry) => (
            <button
              key={entry.id}
              type="button"
              onClick={() => setActiveTab(entry.id)}
              title={
                entry.kind === "kas-khatar"
                  ? "Карта Кас-Хатара"
                  : `Вкладка «${entry.name}»: пустой лист с сеткой`
              }
              className={`rounded-md border px-2 py-0.5 text-[10px] transition ${
                entry.id === tab.id
                  ? "border-emerald-400/70 bg-emerald-500/15 text-emerald-100"
                  : "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
              }`}
            >
              {entry.kind === "kas-khatar" ? "Кас-Хатар" : entry.name}
            </button>
          ))}
          {isGM ? (
            <button
              type="button"
              onClick={() => void addTab()}
              title="Новая вкладка: белый лист с серой сеткой по размеру карты"
              className="rounded-md border border-dashed border-zinc-700 px-2 py-0.5 text-[10px] text-zinc-300 transition hover:border-emerald-400/70 hover:text-emerald-200"
            >
              + вкладка
            </button>
          ) : null}
          {isGM && tab.kind !== "kas-khatar" ? (
            <button
              type="button"
              onClick={() => void removeTab()}
              title={`Удалить вкладку «${tab.name}»`}
              className="rounded-md border border-zinc-800 px-2 py-0.5 text-[10px] text-zinc-500 transition hover:border-rose-400/60 hover:text-rose-300"
            >
              × удалить
            </button>
          ) : null}
        </div>

        {/* Панель инструментов — своя полоса над картой, а не плашка поверх её
            верхнего угла: карту она больше не закрывает, а закрепление живёт на
            шапке карты. Колесо над ней масштаб не меняет (`data-map-controls`
            проверяет обработчик рамки), хотя слушатель висит на самой карте. */}
        <div className="flex flex-col gap-1" data-map-controls data-map-toolbar>
          <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setTool("hand")}
            className={`rounded px-1.5 py-0.5 text-[10px] ${tool === "hand" ? "bg-zinc-200 text-zinc-900" : "text-zinc-300 hover:text-zinc-100"}`}
            title="Рука: потяните карту мышью или пальцем, колесо над ней меняет масштаб · пробел или средняя кнопка мыши — та же рука поверх кисти"
          >
            Рука
          </button>
          <button
            type="button"
            onClick={() => setTool("pen")}
            className={`rounded px-1.5 py-0.5 text-[10px] ${tool === "pen" ? "bg-emerald-500 text-emerald-950" : "text-zinc-300 hover:text-emerald-200"}`}
          >
            Кисть
          </button>
          <button
            type="button"
            onClick={() => setTool("erase")}
            className={`rounded px-1.5 py-0.5 text-[10px] ${tool === "erase" ? "bg-rose-400 text-rose-950" : "text-zinc-300 hover:text-rose-200"}`}
          >
            Ластик
          </button>
          {COLORS.map((entry) => (
            <button
              key={entry}
              type="button"
              onClick={() => {
                setColor(entry);
                setTool("pen");
              }}
              title={`Цвет ${entry}`}
              className={`h-4 w-4 rounded-full border ${color === entry && tool === "pen" ? "border-zinc-100" : "border-zinc-800"}`}
              style={{ backgroundColor: entry }}
            />
          ))}
          <select
            value={width}
            onChange={(event) => setWidth(Number(event.target.value))}
            className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-300"
            title="Толщина"
          >
            {WIDTHS.map((entry) => (
              <option key={entry.value} value={entry.value}>{entry.label}</option>
            ))}
          </select>
          {isGM ? (
            <button
              type="button"
              onClick={clearBoard}
              className="rounded px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-rose-300"
            >
              Очистить
            </button>
          ) : null}
          </div>

          {/* Вторая строка — под кистью и ластиком: надписи и точки поверх карты.
              Ставит и правит их только мастер. */}
          {isGM ? (
            <div className="flex flex-wrap items-center gap-1 border-t border-zinc-700/60 pt-1">
              <button
                type="button"
                onClick={() => {
                  setTool("text");
                  setEditingTextId(null);
                }}
                className={`rounded px-1.5 py-0.5 text-[10px] ${tool === "text" ? "bg-amber-300 text-amber-950" : "text-zinc-300 hover:text-amber-200"}`}
                title="Надпись поверх карты"
              >
                Текст
              </button>
              <button
                type="button"
                onClick={() => {
                  setTool("point");
                  setEditingTextId(null);
                }}
                className={`rounded px-1.5 py-0.5 text-[10px] ${tool === "point" ? "bg-sky-300 text-sky-950" : "text-zinc-300 hover:text-sky-200"}`}
                title="Точка: текст открывается нажатием на 5 секунд"
              >
                Точка
              </button>
              {tool === "text" || tool === "point" ? (
                <>
                  <input
                    value={text}
                    onChange={(event) => setText(event.target.value)}
                    maxLength={MAP_TEXT_MAX_LENGTH}
                    placeholder="Надпись"
                    className="w-28 rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-100"
                  />
                  <select
                    value={textFont}
                    onChange={(event) => setTextFont(event.target.value as MapFont)}
                    className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-300"
                    title="Шрифт"
                  >
                    {MAP_FONT_OPTIONS.map((entry) => (
                      <option key={entry.value} value={entry.value}>{entry.label}</option>
                    ))}
                  </select>
                  <select
                    value={textSize}
                    onChange={(event) => setTextSize(Number(event.target.value))}
                    className="rounded border border-zinc-700 bg-zinc-900 px-1 py-0.5 text-[10px] text-zinc-300"
                    title="Размер"
                  >
                    {MAP_TEXT_SIZES.map((entry) => (
                      <option key={entry.value} value={entry.value}>{entry.label}</option>
                    ))}
                  </select>
                  {COLORS.map((entry) => (
                    <button
                      key={`text-${entry}`}
                      type="button"
                      onClick={() => setTextColor(entry)}
                      title={`Цвет надписи ${entry}`}
                      className={`h-4 w-4 rounded-full border ${textColor === entry ? "border-zinc-100" : "border-zinc-800"}`}
                      style={{ backgroundColor: entry }}
                    />
                  ))}
                  {/* Кому видна запись: точка или надпись может быть тайной
                      мастера или подсказкой только для выбранных персонажей. */}
                  <details className="relative" data-map-audience>
                    <summary
                      title={audienceLabel(textAudience)}
                      className={`max-w-[9rem] cursor-pointer list-none truncate rounded border px-1 py-0.5 text-[10px] ${
                        textAudience === undefined
                          ? "border-zinc-700 bg-zinc-900 text-zinc-300"
                          : "border-amber-400/70 bg-amber-500/10 text-amber-200"
                      }`}
                    >
                      {textAudience === undefined
                        ? "Видят: все"
                        : textAudience.length === 0
                          ? "Видят: мастер"
                          : textAudience.length === 1
                            ? `Видят: ${
                                characters.find((character) => character.id === textAudience[0])
                                  ?.name ?? "лист"
                              }`
                            : `Видят: ${textAudience.length}`}
                    </summary>
                    <div
                      className="absolute right-0 top-full z-30 mt-1 w-44 rounded-lg border border-zinc-700 bg-zinc-950/95 p-1 shadow-xl"
                      title={audienceLabel(textAudience)}
                    >
                      <label className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[10px] text-zinc-200">
                        <input
                          type="checkbox"
                          checked={textAudience === undefined}
                          onChange={() => setTextAudience(undefined)}
                          className="accent-emerald-500"
                        />
                        Все за столом
                      </label>
                      <div className="scroll-thin max-h-40 overflow-y-auto">
                        {characters.map((character) => (
                          <label
                            key={character.id}
                            className="flex items-center gap-1.5 rounded px-1 py-0.5 text-[10px] text-zinc-200"
                            title={
                              (character.players ?? []).length > 0
                                ? `Играют: ${(character.players ?? []).join(", ")}`
                                : "Лист пока ни за кем не закреплён"
                            }
                          >
                            <input
                              type="checkbox"
                              checked={
                                Array.isArray(textAudience) && textAudience.includes(character.id)
                              }
                              onChange={() => toggleAudience(character.id)}
                              className="accent-amber-400"
                            />
                            <span className="min-w-0 flex-1 truncate">{character.name}</span>
                          </label>
                        ))}
                      </div>
                      <p className="px-1 py-0.5 text-[10px] text-zinc-500">
                        {characters.length === 0
                          ? "Листов в комнате нет — запись видна всем."
                          : textAudience === undefined
                            ? "Запись видна всем за столом."
                            : textAudience.length === 0
                              ? "Ничего не выбрано — видит только мастер."
                              : audienceLabel(textAudience)}
                      </p>
                    </div>
                  </details>
                  {editingTextId ? (
                    <>
                      <button
                        type="button"
                        onClick={saveText}
                        className="rounded px-1.5 py-0.5 text-[10px] text-emerald-300 hover:text-emerald-200"
                      >
                        Сохранить
                      </button>
                      <button
                        type="button"
                        onClick={removeText}
                        className="rounded px-1.5 py-0.5 text-[10px] text-rose-300 hover:text-rose-200"
                      >
                        Удалить
                      </button>
                      <button
                        type="button"
                        onClick={cancelText}
                        className="rounded px-1.5 py-0.5 text-[10px] text-zinc-400 hover:text-zinc-200"
                      >
                        Отмена
                      </button>
                    </>
                  ) : (
                    <span className="text-[10px] text-zinc-400">
                      {tool === "point" ? "клик по карте — место точки" : "клик по карте — место"}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-[10px] text-zinc-500">надписи и точки поверх карты</span>
              )}
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-2 overflow-hidden rounded-xl border border-zinc-800 bg-zinc-900/40">
        {/* Пробел тянет карту, только пока курсор над ней: за пределами рамки он
            остаётся обычным пробелом и не прокручивает стол. */}
        <div
          ref={wrapRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          onPointerEnter={() => {
            hoverRef.current = true;
          }}
          onPointerLeave={() => {
            hoverRef.current = false;
          }}
          style={{ aspectRatio: `${MAP_RASTER.width} / ${MAP_RASTER.height}` }}
          data-map-temp-hand={tempHand ? "on" : "off"}
          className={`map-frame relative touch-none select-none overflow-hidden ${
            cursor === "grab" ? "cursor-grab active:cursor-grabbing" : `cursor-${cursor}`
          }`}
        >
          {/* Сцена: растр, рисунки, надписи и метки. Она ездит и растёт внутри
              рамки, поэтому всё внутри считается в долях карты. */}
          <div
            className="absolute inset-0 origin-top-left"
            style={{ transform: mapViewTransform(view) }}
            data-map-stage
          >
          {tab.kind === "kas-khatar" ? (
            /* Формат выбирает браузер: берётся первый поддержанный <source>, JPEG
                остаётся запасным. Статика собирается без оптимизатора картинок
                (images.unoptimized), поэтому здесь <picture>, а не next/image.
                Файлы собирает `py -3.13 tools/make-map-formats.py`. */
            <picture className="block">
              <source type="image/avif" srcSet="/map/kas-khatar.avif" />
              <source type="image/webp" srcSet="/map/kas-khatar.webp" />
              <img
                ref={imageRef}
                src="/map/kas-khatar.jpg"
                alt="Карта Кас-Хатара"
                width={MAP_RASTER.width}
                height={MAP_RASTER.height}
                decoding="async"
                draggable={false}
                onLoad={(event) => {
                  const { naturalWidth, naturalHeight } = event.currentTarget;
                  setPixels({ width: naturalWidth, height: naturalHeight });
                }}
                className="block h-auto w-full"
              />
            </picture>
          ) : (
            /* Пустой лист: белое полотно с серой сеткой того же размера, что карта
                (4333×3064). Пропорции задаёт рамка, сетка — SVG-узор, поэтому
                лист тянется вместе с полем. */
            <div className="block h-full w-full bg-white" data-map-blank>
              <svg
                className="block h-full w-full"
                viewBox={`0 0 ${MAP_RASTER.width} ${MAP_RASTER.height}`}
                preserveAspectRatio="none"
                role="img"
                aria-label="Пустая карта с сеткой"
              >
                <defs>
                  <pattern
                    id="map-blank-grid"
                    width={MAP_GRID.step}
                    height={MAP_GRID.step}
                    patternUnits="userSpaceOnUse"
                  >
                    <path
                      d={`M ${MAP_GRID.step} 0 L 0 0 0 ${MAP_GRID.step}`}
                      fill="none"
                      stroke={MAP_GRID.color}
                      strokeWidth={MAP_GRID.stroke}
                    />
                  </pattern>
                </defs>
                <rect width={MAP_RASTER.width} height={MAP_RASTER.height} fill="#ffffff" />
                <rect
                  width={MAP_RASTER.width}
                  height={MAP_RASTER.height}
                  fill="url(#map-blank-grid)"
                />
              </svg>
            </div>
          )}
          <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />

          {/* Записи мастера поверх карты: надпись видна всегда, точка — только кружком.
              Нажатие на точку открывает её текст на 5 секунд; правит записи мастер.
              Закрытые записи мастер отличает по пунктиру: он видит и то, что
              спрятано от стола. */}
          {texts.map((entry) => {
            const restricted = isGM && Array.isArray(entry.audience);
            if (entry.kind === "point") {
              // Кружок точки: в полтора раза меньше прежнего на всех размерах.
              const diameter = mapPointDiameter(entry.size, size.width);
              const open = revealed?.id === entry.id;
              return (
                <div
                  key={entry.id}
                  className="absolute z-10 -translate-x-1/2 -translate-y-1/2"
                  style={{ left: `${entry.x * 100}%`, top: `${entry.y * 100}%` }}
                >
                  <button
                    type="button"
                    onPointerDown={(event) => event.stopPropagation()}
                    onClick={() => revealText(entry)}
                    className={`-m-2 block cursor-pointer rounded-full p-2 ${
                      editingTextId === entry.id ? "ring-2 ring-amber-300/90" : ""
                    }`}
                    title={
                      restricted
                        ? `Точка на карте. ${audienceLabel(entry.audience)}`
                        : "Точка на карте: нажмите, чтобы прочитать"
                    }
                    aria-label="Точка на карте: нажмите, чтобы прочитать"
                  >
                    <span
                      className="block rounded-full border-2 border-zinc-950/70"
                      style={{
                        width: `${diameter}px`,
                        height: `${diameter}px`,
                        backgroundColor: entry.color,
                        boxShadow: "0 1px 6px rgba(0,0,0,0.85)",
                        ...(restricted
                          ? { outline: "2px dashed rgba(252,211,77,0.85)", outlineOffset: "2px" }
                          : {}),
                      }}
                    />
                  </button>
                  {open ? (
                    <span
                      className="pointer-events-none absolute left-1/2 top-full mt-1 w-max max-w-[14rem] -translate-x-1/2 whitespace-pre-wrap break-words rounded bg-zinc-950/90 px-1.5 py-1 text-center leading-tight shadow-lg"
                      style={{
                        color: entry.color,
                        fontFamily: MAP_FONT_STACK[entry.font] ?? MAP_FONT_STACK.sans,
                        fontSize: `${Math.max(10, entry.size * Math.max(size.width, 320))}px`,
                        textShadow: "0 1px 3px rgba(0,0,0,0.9)",
                      }}
                    >
                      {entry.text}
                    </span>
                  ) : null}
                </div>
              );
            }
            return (
              <div
                key={entry.id}
                className={`absolute z-10 max-w-[45%] -translate-x-1/2 -translate-y-1/2 break-words px-1 leading-tight ${
                  isGM && tool === "text"
                    ? "pointer-events-auto cursor-pointer hover:bg-zinc-950/40"
                    : "pointer-events-none"
                } ${editingTextId === entry.id ? "rounded ring-2 ring-amber-300/90" : ""}`}
                style={{
                  left: `${entry.x * 100}%`,
                  top: `${entry.y * 100}%`,
                  color: entry.color,
                  fontFamily: MAP_FONT_STACK[entry.font] ?? MAP_FONT_STACK.sans,
                  fontSize: `${Math.max(9, entry.size * Math.max(size.width, 320))}px`,
                  textShadow: "0 1px 3px rgba(0,0,0,0.9)",
                  ...(restricted ? { outline: "1px dashed rgba(252,211,77,0.7)" } : {}),
                }}
                onPointerDown={(event) => event.stopPropagation()}
                onClick={() => pickText(entry)}
                title={
                  isGM
                    ? restricted
                      ? `Править надпись. ${audienceLabel(entry.audience)}`
                      : "Править надпись"
                    : entry.text
                }
              >
                {entry.text}
              </div>
            );
          })}

          {pings.map((ping) => (
            <div
              key={ping.id}
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${ping.x * 100}%`, top: `${ping.y * 100}%` }}
            >
              <span className="map-ping" style={{ borderColor: ping.color }} />
              <span
                className="map-ping map-ping--late"
                style={{ borderColor: ping.color }}
              />
              <span
                className="absolute left-4 top-2 whitespace-nowrap rounded bg-zinc-950/90 px-1 py-0.5 text-[9px] font-medium shadow"
                style={{ color: ping.color }}
              >
                {ping.name}
              </span>
            </div>
          ))}

          {erasePoint ? (
            <div
              className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-rose-300/80 bg-rose-300/10"
              style={{
                left: `${erasePoint.x * 100}%`,
                top: `${erasePoint.y * 100}%`,
                width: `${Math.max(18, width * 5 * (size.width || 1000) * 2)}px`,
                height: `${Math.max(18, width * 5 * (size.width || 1000) * 2)}px`,
              }}
            />
          ) : null}
          </div>

          {/* Масштаб: «−» и «+» — то же, что колесо, но под палец; «⟲» возвращает
              карту целиком. Подпись показывает, во сколько раз карта увеличена. */}
          <div
            className="absolute bottom-1 left-2 z-20 flex items-center gap-0.5 rounded border border-zinc-700/80 bg-zinc-950/85 px-1 py-0.5 text-[10px] text-zinc-300 shadow backdrop-blur"
            data-map-controls
            data-map-zoom
            onPointerDown={(event) => event.stopPropagation()}
            onPointerMove={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => zoomBy(1 / MAP_ZOOM_BUTTON_STEP)}
              title="Дальше: то же, что колесо вниз"
              className="rounded px-1 text-zinc-300 hover:text-emerald-200"
            >
              −
            </button>
            <span
              className="min-w-[2.6rem] text-center tabular-nums"
              title="Масштаб карты: колесо над картой приближает и отдаляет"
            >
              {mapZoomLabel(view.scale)}
            </span>
            <button
              type="button"
              onClick={() => zoomBy(MAP_ZOOM_BUTTON_STEP)}
              title="Ближе: то же, что колесо вверх"
              className="rounded px-1 text-zinc-300 hover:text-emerald-200"
            >
              +
            </button>
            <button
              type="button"
              onClick={() => setView(MAP_VIEW_DEFAULT)}
              title="Сбросить масштаб и сдвиг: карта целиком"
              className="rounded px-1 text-zinc-400 hover:text-emerald-200"
              data-map-zoom-reset
            >
              ⟲
            </button>
          </div>

          <span className="pointer-events-none absolute bottom-1 right-2 rounded bg-zinc-950/70 px-1.5 py-0.5 text-[9px] text-zinc-400">
            {tab.kind === "kas-khatar"
              ? `1 гекс ≈ ${HEX_SCALE.miles} миль (≈${HEX_SCALE.km} км)${
                  pixels ? ` · ${pixels.width}×${pixels.height}` : ""
                }`
              : `пустой лист ${MAP_RASTER.width}×${MAP_RASTER.height}`}
          </span>
        </div>
      </div>
      {error ? <p className="mt-2 text-[10px] text-rose-300">{error}</p> : null}
    </section>
  );
}
