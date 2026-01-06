"use client";
import React, { useMemo } from "react";
import { cn, formatDateKey } from "@/lib/utils";
import {
  Calendar as CalendarIcon,
  X,
  MoreHorizontal,
  Plus,
} from "lucide-react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { AllDayEvent, CalendarListItem } from "@/types/calendar";

export type { AllDayEvent, CalendarListItem };
function expandEventsToDateMap(events: AllDayEvent[]) {
  const map = new Map<string, AllDayEvent[]>();
  for (const ev of events) {
    const start = new Date(ev.startDate + "T00:00:00Z");
    const end = new Date(ev.endDate + "T00:00:00Z"); // exclusive
    for (let d = new Date(start); d < end; d.setUTCDate(d.getUTCDate() + 1)) {
      const local = new Date(
        Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())
      );
      const key = formatDateKey(
        new Date(
          local.getUTCFullYear(),
          local.getUTCMonth(),
          local.getUTCDate()
        )
      );
      const list = map.get(key) ?? [];
      list.push(ev);
      map.set(key, list);
    }
  }
  return map;
}

function generateYearDays(year: number) {
  const start = new Date(year, 0, 1);
  const end = new Date(year + 1, 0, 1);
  const days: Array<{ key: string; date: Date }> = [];
  for (let d = new Date(start); d < end; d.setDate(d.getDate() + 1)) {
    const date = new Date(d);
    days.push({ key: formatDateKey(date), date });
  }
  return days;
}

function groupDaysByMonth(
  days: Array<{ key: string; date: Date }>
): Array<{ month: number; days: Array<{ key: string; date: Date }> }> {
  const groups: Array<{ month: number; days: Array<{ key: string; date: Date }> }> = [];
  let currentMonth = -1;
  let currentGroup: Array<{ key: string; date: Date }> = [];

  for (const day of days) {
    const month = day.date.getMonth();
    if (month !== currentMonth) {
      if (currentGroup.length > 0) {
        groups.push({ month: currentMonth, days: currentGroup });
      }
      currentMonth = month;
      currentGroup = [day];
    } else {
      currentGroup.push(day);
    }
  }
  if (currentGroup.length > 0) {
    groups.push({ month: currentMonth, days: currentGroup });
  }
  return groups;
}

function groupDaysByWeek(
  days: Array<{ key: string; date: Date }>
): Array<{ weekNum: number; days: Array<{ key: string; date: Date }> }> {
  const groups: Array<{ weekNum: number; days: Array<{ key: string; date: Date }> }> = [];
  let weekNum = 1;
  let currentWeek: Array<{ key: string; date: Date }> = [];
  let foundFirstWeek = false;

  for (const day of days) {
    const dayOfWeek = day.date.getDay(); // 0 = Sunday, 6 = Saturday
    const isSunday = dayOfWeek === 0;

    if (isSunday) {
      // Start a new week on Sunday
      if (currentWeek.length > 0) {
        groups.push({ weekNum, days: currentWeek });
        weekNum++;
      }
      currentWeek = [day];
      foundFirstWeek = true;
    } else {
      // If we haven't found the first Sunday yet, check if this is Jan 1st
      if (!foundFirstWeek && day.date.getMonth() === 0 && day.date.getDate() === 1) {
        // Jan 1st is not a Sunday, so this is the first week
        currentWeek = [day];
        foundFirstWeek = true;
      } else {
        currentWeek.push(day);
      }
    }
  }

  if (currentWeek.length > 0) {
    groups.push({ weekNum, days: currentWeek });
  }

  return groups;
}

function computeSquareGridColumns(
  totalDays: number,
  width: number,
  height: number,
  gapPx = 1
) {
  if (width <= 0 || height <= 0) return { cols: 1, cell: 10 };
  let bestCols = 1;
  let bestCell = 0;
  const maxCols = Math.min(totalDays, Math.max(1, Math.floor(width))); // safe upper bound
  for (let cols = 1; cols <= maxCols; cols++) {
    const usableWidth = width - (cols - 1) * gapPx;
    const cellSize = Math.floor(usableWidth / cols);
    if (cellSize <= 0) break;
    const rows = Math.ceil(totalDays / cols);
    const totalHeight = rows * cellSize + (rows - 1) * gapPx;
    if (totalHeight <= height) {
      if (cellSize > bestCell) {
        bestCell = cellSize;
        bestCols = cols;
      }
    }
  }
  if (bestCell === 0) {
    // Fallback if nothing fit: pick minimal cell that fits width and let height scroll slightly
    const usableWidth = width - (bestCols - 1) * gapPx;
    bestCell = Math.max(10, Math.floor(usableWidth / bestCols));
  }
  return { cols: bestCols, cell: bestCell };
}

const monthShort = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const dayOfWeekShort = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

function hexToRgba(hex: string, alpha = 0.35) {
  try {
    let h = hex.replace("#", "").trim();
    if (h.length === 3) {
      h = h
        .split("")
        .map((c) => c + c)
        .join("");
    }
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if ([r, g, b].some((n) => Number.isNaN(n))) return hex;
    const a = Math.min(1, Math.max(0, alpha));
    return `rgba(${r}, ${g}, ${b}, ${a})`;
  } catch {
    return hex;
  }
}

export function YearCalendar({
  year,
  events,
  signedIn,
  calendarColors = {},
  calendarNames = {},
  calendarAccounts = {},
  onHideEvent,
  onDeleteEvent,
  onDayClick,
  onUpdateEvent,
  writableCalendars = [],
  writableAccountsWithCalendars = [],
  showDaysOfWeek = false,
  view = "default",
}: {
  year: number;
  events: AllDayEvent[];
  signedIn: boolean;
  calendarColors?: Record<string, string>;
  calendarNames?: Record<string, string>;
  calendarAccounts?: Record<string, string>;
  onHideEvent?: (id: string) => void;
  onDeleteEvent?: (id: string) => Promise<void> | void;
  onDayClick?: (dateKey: string) => void;
  onUpdateEvent?: (event: {
    id: string;
    title: string;
    calendarId: string;
    startDate: string;
    endDate?: string;
  }) => Promise<void> | void;
  writableCalendars?: CalendarListItem[];
  writableAccountsWithCalendars?: Array<{
    accountId: string;
    email: string;
    list: CalendarListItem[];
  }>;
  showDaysOfWeek?: boolean;
  view?: "default" | "months" | "weeks";
}) {
  const todayKey = formatDateKey(new Date());
  const dateMap = useMemo(() => expandEventsToDateMap(events), [events]);
  const days = useMemo(() => generateYearDays(year), [year]);
  const dayIndexByKey = useMemo(() => {
    const map = new Map<string, number>();
    days.forEach((d, i) => map.set(d.key, i));
    return map;
  }, [days]);

  // Group days by view type
  const monthsGroups = useMemo(() => groupDaysByMonth(days), [days]);
  const weeksGroups = useMemo(() => groupDaysByWeek(days), [days]);
  const gridRef = React.useRef<HTMLDivElement | null>(null);
  const [cellSizePx, setCellSizePx] = React.useState<{ w: number; h: number }>({
    w: 0,
    h: 0,
  });
  const [popover, setPopover] = React.useState<{
    event: AllDayEvent | null;
    x: number;
    y: number;
  }>({ event: null, x: 0, y: 0 });
  const popoverRef = React.useRef<HTMLDivElement | null>(null);
  const [isEditing, setIsEditing] = React.useState<boolean>(false);
  const [editTitle, setEditTitle] = React.useState<string>("");
  const [editCalendarId, setEditCalendarId] = React.useState<string>("");
  const [editStartDate, setEditStartDate] = React.useState<string>("");
  const [editHasEndDate, setEditHasEndDate] = React.useState<boolean>(false);
  const [editEndDate, setEditEndDate] = React.useState<string>("");
  const [isSubmitting, setIsSubmitting] = React.useState<boolean>(false);
  const [menuOpen, setMenuOpen] = React.useState<boolean>(false);
  const menuRef = React.useRef<HTMLDivElement | null>(null);
  const editStartDateInputRef = React.useRef<HTMLInputElement | null>(null);
  const editEndDateInputRef = React.useRef<HTMLInputElement | null>(null);

  // Important for hydration: start with a deterministic server/client match,
  // then compute real columns after mount to avoid style mismatches.
  const [gridDims, setGridDims] = React.useState<{
    cols: number;
    cell: number;
  }>(() => ({
    cols: 12,
    cell: 12,
  }));
  
  // Calculate dynamic row heights based on events
  const rowHeightsMap = useMemo(() => {
    if (!cellSizePx.h || events.length === 0) return new Map<number, number>();
    
    const labelOffset = 16;
    const laneHeight = 16;
    const baseCellHeight = gridDims.cell;
    
    // Create day to position map
    const dayToPosition = new Map<string, { row: number; col: number }>();
    if (view === "default") {
      const cols = gridDims.cols || 12;
      days.forEach((day, idx) => {
        const row = Math.floor(idx / cols);
        const col = idx % cols;
        dayToPosition.set(day.key, { row, col });
      });
    } else if (view === "months") {
      let row = 0;
      monthsGroups.forEach((group) => {
        group.days.forEach((day, idx) => {
          dayToPosition.set(day.key, { row, col: idx });
        });
        row++;
      });
    } else if (view === "weeks") {
      let row = 0;
      weeksGroups.forEach((group) => {
        group.days.forEach((day, idx) => {
          dayToPosition.set(day.key, { row, col: idx });
        });
        row++;
      });
    }
    
    // Calculate events per row
    const rowToSegs = new Map<number, Array<{ startCol: number; endCol: number }>>();
    for (const ev of events) {
      const startPos = dayToPosition.get(ev.startDate);
      if (!startPos) continue;
      const endDate = new Date(ev.endDate + "T00:00:00Z");
      endDate.setUTCDate(endDate.getUTCDate() - 1);
      const endDateKey = formatDateKey(endDate);
      const endPosInclusive = dayToPosition.get(endDateKey);
      if (!endPosInclusive) continue;
      
      let currentRow = startPos.row;
      const endRow = endPosInclusive.row;
      const endCol = endPosInclusive.col;
      
      while (currentRow <= endRow) {
        let rowEndCol: number;
        if (view === "weeks") {
          rowEndCol = currentRow === endRow ? endCol : 6;
        } else if (view === "months") {
          const monthGroup = monthsGroups[currentRow];
          rowEndCol = currentRow === endRow ? endCol : (monthGroup ? monthGroup.days.length - 1 : 30);
        } else {
          rowEndCol = currentRow === endRow ? endCol : gridDims.cols - 1;
        }
        const startCol = currentRow === startPos.row ? startPos.col : 0;
        const list = rowToSegs.get(currentRow) ?? [];
        list.push({ startCol, endCol: rowEndCol + 1 });
        rowToSegs.set(currentRow, list);
        currentRow++;
      }
    }
    
    // Calculate max lanes per row
    const maxLanesPerRow = new Map<number, number>();
    for (const [row, segs] of rowToSegs) {
      segs.sort((a, b) => a.startCol - b.startCol);
      const laneEnds: number[] = [];
      let maxLanesInRow = 0;
      for (const seg of segs) {
        let lane = 0;
        while (lane < laneEnds.length && seg.startCol < laneEnds[lane]) {
          lane++;
        }
        maxLanesInRow = Math.max(maxLanesInRow, lane + 1);
        if (lane === laneEnds.length) laneEnds.push(seg.endCol);
        else laneEnds[lane] = seg.endCol;
      }
      maxLanesPerRow.set(row, Math.max(1, maxLanesInRow));
    }
    
    // Calculate row heights
    const heights = new Map<number, number>();
    for (const [row, maxLanes] of maxLanesPerRow) {
      const requiredHeight = labelOffset + maxLanes * laneHeight + 2;
      heights.set(row, Math.max(baseCellHeight, requiredHeight));
    }
    
    return heights;
  }, [events, days, monthsGroups, weeksGroups, gridDims, cellSizePx.h, view]);
  
  // Update grid template rows
  React.useLayoutEffect(() => {
    if (!gridRef.current) return;
    const totalRows = view === "default" 
      ? Math.ceil(days.length / (gridDims.cols || 12))
      : view === "months" 
        ? monthsGroups.length 
        : weeksGroups.length;
    
    const baseCellHeight = gridDims.cell;
    const rowHeights = Array.from({ length: totalRows }, (_, i) => {
      const height = rowHeightsMap.get(i) || baseCellHeight;
      return `${height}px`;
    }).join(' ');
    
    gridRef.current.style.gridTemplateRows = rowHeights;
  }, [rowHeightsMap, gridDims.cell, days.length, monthsGroups.length, weeksGroups.length, gridDims.cols, view]);

  React.useEffect(() => {
    function onResize() {
      if (view === "default") {
        setGridDims(
          computeSquareGridColumns(
            days.length,
            window.innerWidth,
            window.innerHeight
          )
        );
      } else if (view === "months") {
        // For months view, always use 31 columns (max days in a month)
        const availableWidth = window.innerWidth - 50; // Reserve space for index column
        // Calculate width but use a fixed reasonable height
        const cellWidth = Math.floor((availableWidth - 30) / 31); // 30 gaps between 31 cells
        // Use a fixed reasonable height for months (not square)
        const cellHeight = 50; // Fixed height that works well for month rows
        setGridDims({ cols: 31, cell: cellHeight });
      } else if (view === "weeks") {
        // For weeks view, always 7 columns (one per day)
        const availableWidth = window.innerWidth - 50; // Reserve space for index column
        // Calculate width but use a fixed reasonable height
        const cellWidth = Math.floor((availableWidth - 6) / 7); // 6 gaps between 7 cells
        // Use a fixed reasonable height for weeks (not square, can be smaller)
        const cellHeight = 40; // Fixed height that works well for week rows
        setGridDims({ cols: 7, cell: cellHeight });
      }
    }
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [days.length, view, monthsGroups, weeksGroups]);
  const updateCellSize = React.useCallback(() => {
    const grid = gridRef.current;
    if (!grid) return;
    const firstCell = grid.querySelector<HTMLElement>('[data-day-cell="1"]');
    if (firstCell) {
      const rect = firstCell.getBoundingClientRect();
      if (rect.width && rect.height) {
        setCellSizePx({ w: rect.width, h: rect.height });
      }
    }
  }, []);

  React.useLayoutEffect(() => {
    updateCellSize();
  }, [gridDims.cols, gridDims.cell, year, updateCellSize]);

  // Update cell size on window resize (with RAF to ensure DOM has updated)
  React.useEffect(() => {
    function onResize() {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          updateCellSize();
        });
      });
    }
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, [updateCellSize]);
  React.useEffect(() => {
    function onDocMouseDown(e: MouseEvent) {
      if (!popover.event) return;
      if (popoverRef.current && e.target instanceof Node) {
        if (!popoverRef.current.contains(e.target)) {
          setPopover({ event: null, x: 0, y: 0 });
          setIsEditing(false);
          setMenuOpen(false);
        }
      } else {
        setPopover({ event: null, x: 0, y: 0 });
        setIsEditing(false);
        setMenuOpen(false);
      }
      if (menuRef.current && e.target instanceof Node) {
        if (!menuRef.current.contains(e.target)) {
          setMenuOpen(false);
        }
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setPopover({ event: null, x: 0, y: 0 });
        setIsEditing(false);
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDocMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [popover.event, menuOpen]);

  React.useEffect(() => {
    if (popover.event && !isEditing) {
      // Initialize edit state when popover opens
      setEditTitle(popover.event.summary);
      setEditCalendarId(popover.event.calendarId || "");
      setEditStartDate(popover.event.startDate);
      // Check if event has an end date (endDate is exclusive, so if it's different from startDate + 1 day, it's a multi-day event)
      const start = new Date(popover.event.startDate + "T00:00:00Z");
      const end = new Date(popover.event.endDate + "T00:00:00Z");
      const daysDiff = Math.round(
        (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysDiff > 1) {
        setEditHasEndDate(true);
        // Convert exclusive endDate to inclusive for editing
        const endInclusive = new Date(end.getTime() - 86400000);
        const y = endInclusive.getUTCFullYear();
        const m = `${endInclusive.getUTCMonth() + 1}`.padStart(2, "0");
        const d = `${endInclusive.getUTCDate()}`.padStart(2, "0");
        setEditEndDate(`${y}-${m}-${d}`);
      } else {
        setEditHasEndDate(false);
        setEditEndDate("");
      }
    }
  }, [popover.event, isEditing]);

  function formatDisplayRange(startIsoDate: string, endIsoDate: string) {
    const start = new Date(startIsoDate + "T00:00:00");
    const end = new Date(endIsoDate + "T00:00:00"); // exclusive
    const endInclusive = new Date(end.getTime() - 86400000);
    const sameMonth =
      start.getFullYear() === endInclusive.getFullYear() &&
      start.getMonth() === endInclusive.getMonth();
    const optsDay: Intl.DateTimeFormatOptions = { day: "numeric" };
    const optsMon: Intl.DateTimeFormatOptions = { month: "short" };
    const optsYear: Intl.DateTimeFormatOptions = { year: "numeric" };
    if (start.toDateString() === endInclusive.toDateString()) {
      return `${start.toLocaleString(undefined, {
        ...optsMon,
        ...optsDay,
      })}, ${start.toLocaleString(undefined, optsYear)}`;
    }
    if (sameMonth) {
      return `${start.toLocaleString(undefined, {
        ...optsMon,
        ...optsDay,
      })}–${endInclusive.toLocaleString(
        undefined,
        optsDay
      )}, ${start.toLocaleString(undefined, optsYear)}`;
    }
    const left = `${start.toLocaleString(undefined, {
      ...optsMon,
      ...optsDay,
    })}, ${start.toLocaleString(undefined, optsYear)}`;
    const right = `${endInclusive.toLocaleString(undefined, {
      ...optsMon,
      ...optsDay,
    })}, ${endInclusive.toLocaleString(undefined, optsYear)}`;
    return `${left} – ${right}`;
  }

  const renderDayCell = (day: { key: string; date: Date }, indexInGroup?: number) => {
    const isToday = day.key === todayKey;
    const isFirstOfMonth = day.date.getDate() === 1;
    const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;
    const dayOfWeek = day.date.getDay();
    const showWeekdayLabel = (view === "default" && showDaysOfWeek) || view === "months" || view === "weeks";
    
    return (
      <div
        key={day.key}
        data-day-cell="1"
        className={cn(
          "relative bg-background p-1 min-w-0 min-h-0 overflow-hidden",
          isWeekend &&
            'bg-white before:content-[""] before:absolute before:inset-0 before:bg-[rgba(0,0,0,0.02)] before:pointer-events-none',
          isToday && "ring-1 ring-primary"
        )}
        title={day.date.toDateString()}
        onClick={(e) => {
          onDayClick?.(day.key);
        }}
      >
        {isFirstOfMonth && view === "default" && (
          <div className="absolute top-1 left-1 text-[10px] leading-none uppercase tracking-wide text-primary">
            {monthShort[day.date.getMonth()]}
            {showDaysOfWeek && (
              <span className="text-[10px] opacity-60">
                {dayOfWeekShort[dayOfWeek]}
              </span>
            )}
          </div>
        )}
        <div
          className={cn(
            "mb-0.5 text-[10px] leading-none text-muted-foreground",
            isToday && "text-primary font-semibold",
            isFirstOfMonth && showDaysOfWeek && view === "default" && "ml-11",
            isFirstOfMonth && !showDaysOfWeek && view === "default" && "ml-6",
            (view === "months" || view === "weeks") && "flex items-center gap-1"
          )}
        >
          {showWeekdayLabel && (
            <span className="text-[10px] opacity-60">
              {dayOfWeekShort[dayOfWeek]}
            </span>
          )}
          {day.date.getDate()}
        </div>
      </div>
    );
  };

  const renderIndexCell = (index: number | string) => {
    return (
      <div
        key={`index-${index}`}
        className="bg-muted/30 flex items-center justify-center text-xs font-medium text-muted-foreground border-r border-border sticky left-0 z-10"
      >
        {index}
      </div>
    );
  };

  const getGridTemplateColumns = () => {
    if (view === "default") {
      return `repeat(${gridDims.cols}, 1fr)`;
    } else {
      return `50px repeat(${gridDims.cols}, 1fr)`;
    }
  };

  const renderWeekdayHeader = () => {
    if (view === "default") return null;
    if (view === "weeks") {
      return (
        <>
          <div className="bg-muted/30 border-r border-border sticky left-0 z-10" />
          {dayOfWeekShort.map((day, idx) => (
            <div
              key={`header-${idx}`}
              className="bg-muted/30 flex items-center justify-center text-[10px] font-medium text-muted-foreground border-b border-border py-1 sticky top-0 z-10"
            >
              {day}
            </div>
          ))}
        </>
      );
    }
    // For months view, show day numbers 1-31
    if (view === "months") {
      return (
        <>
          <div className="bg-muted/30 border-r border-border sticky left-0 z-10" />
          {Array.from({ length: 31 }, (_, i) => i + 1).map((dayNum) => (
            <div
              key={`header-day-${dayNum}`}
              className="bg-muted/30 flex items-center justify-center text-[10px] font-medium text-muted-foreground border-b border-border py-1 sticky top-0 z-10"
            >
              {dayNum}
            </div>
          ))}
        </>
      );
    }
    return null;
  };

  const headerRowHeight = view !== "default" ? 30 : 0;

  return (
    <div className="h-full w-full overflow-hidden">
      <div className="relative h-full w-full flex flex-col">
        {(view === "weeks" || view === "months") && (
          <div
            className="grid bg-border p-px flex-shrink-0 sticky top-0 z-20"
            style={{
              gridTemplateColumns: getGridTemplateColumns(),
              gridTemplateRows: "auto",
              gap: "1px",
            }}
          >
            {renderWeekdayHeader()}
          </div>
        )}
        <div
          className={cn(
            "relative",
            view === "default" ? "flex-1 min-h-0" : "flex-1 min-h-0 overflow-auto"
          )}
        >
          <div className="relative w-full">
            <div
              ref={gridRef}
              className="grid bg-border p-px w-full"
              suppressHydrationWarning
              style={{
                gridTemplateColumns: getGridTemplateColumns(),
                gridAutoRows: `${gridDims.cell}px`,
                gap: "1px",
              }}
            >
          {view === "default" &&
            days.map((day) => renderDayCell(day))}
          
          {view === "months" &&
            monthsGroups.map((group, groupIdx) => (
              <React.Fragment key={`month-${group.month}`}>
                {renderIndexCell(monthShort[group.month])}
                {group.days.map((day) => renderDayCell(day))}
                {/* Fill remaining cells in the row if month is shorter than 31 days */}
                {Array.from({ length: Math.max(0, 31 - group.days.length) }).map((_, i) => (
                  <div key={`empty-${groupIdx}-${i}`} className="bg-background" />
                ))}
              </React.Fragment>
            ))}
          
          {view === "weeks" &&
            weeksGroups.map((group, groupIdx) => (
              <React.Fragment key={`week-${group.weekNum}`}>
                {renderIndexCell(group.weekNum)}
                {group.days.map((day) => renderDayCell(day))}
                {/* Fill remaining cells if week is shorter than 7 days (can happen at year boundaries) */}
                {Array.from({ length: Math.max(0, 7 - group.days.length) }).map((_, i) => (
                  <div key={`empty-week-${groupIdx}-${i}`} className="bg-background" />
                ))}
              </React.Fragment>
            ))}
            </div>
            {/* Absolute overlay using pixel positioning to perfectly align with day cells */}
            <div
              className="pointer-events-none absolute inset-0 w-full h-full"
              style={{ padding: 1 }}
            >
          {React.useMemo(() => {
            const gap = 1; // matches gap-px
            const pad = 0; // already accounted by wrapper padding style above
            if (!cellSizePx.w || !cellSizePx.h) return null;
            
            // Create a map from day key to its position in the grid
            const dayToPosition = new Map<string, { row: number; col: number }>();
            
            if (view === "default") {
              const cols = gridDims.cols || 12;
              days.forEach((day, idx) => {
                const row = Math.floor(idx / cols);
                const col = idx % cols;
                dayToPosition.set(day.key, { row, col });
              });
            } else if (view === "months") {
              const cols = gridDims.cols || 31;
              let row = 0;
              monthsGroups.forEach((group) => {
                group.days.forEach((day, idx) => {
                  dayToPosition.set(day.key, { row, col: idx }); // col is 0-based, index column is separate
                });
                row++;
              });
            } else if (view === "weeks") {
              let row = 0;
              weeksGroups.forEach((group) => {
                group.days.forEach((day, idx) => {
                  dayToPosition.set(day.key, { row, col: idx }); // col is 0-based, index column is separate
                });
                row++;
              });
            }
            
            type Seg = {
              row: number;
              startCol: number;
              endCol: number;
              ev: AllDayEvent;
            };
            const rowToSegs = new Map<number, Seg[]>();
            
            for (const ev of events) {
              const startPos = dayToPosition.get(ev.startDate);
              const endPos = dayToPosition.get(ev.endDate);
              if (!startPos) continue;
              
              // For end date, we need to find the position of the day before (since endDate is exclusive)
              const endDate = new Date(ev.endDate + "T00:00:00Z");
              endDate.setUTCDate(endDate.getUTCDate() - 1);
              const endDateKey = formatDateKey(endDate);
              const endPosInclusive = dayToPosition.get(endDateKey);
              
              if (!endPosInclusive) continue;
              
              // Handle events that span multiple rows
              let currentRow = startPos.row;
              const endRow = endPosInclusive.row;
              const endCol = endPosInclusive.col;
              
              while (currentRow <= endRow) {
                let rowEndCol: number;
                if (view === "weeks") {
                  rowEndCol = currentRow === endRow ? endCol : 6; // 7 days = 0-6
                } else if (view === "months") {
                  // Find the last day in this month row
                  const monthGroup = monthsGroups[currentRow];
                  const maxColInMonth = monthGroup ? monthGroup.days.length - 1 : 30; // 31 days = 0-30
                  rowEndCol = currentRow === endRow ? endCol : maxColInMonth;
                } else {
                  rowEndCol = currentRow === endRow ? endCol : gridDims.cols - 1;
                }
                const startCol = currentRow === startPos.row ? startPos.col : 0;
                const list = rowToSegs.get(currentRow) ?? [];
                list.push({ row: currentRow, startCol, endCol: rowEndCol + 1, ev });
                rowToSegs.set(currentRow, list);
                currentRow++;
              }
            }
            
            const bars: Array<React.ReactElement> = [];
            const labelOffset = 16;
            const laneHeight = 16;
            const indexColWidth = view !== "default" ? 50 : 0;
            
            // Calculate max lanes needed per row to ensure all events fit
            const maxLanesPerRow = new Map<number, number>();
            for (const [row, segs] of rowToSegs) {
              segs.sort((a, b) => a.startCol - b.startCol);
              const laneEnds: number[] = [];
              let maxLanesInRow = 0;
              for (const seg of segs) {
                let lane = 0;
                while (
                  lane < laneEnds.length &&
                  seg.startCol < laneEnds[lane]
                ) {
                  lane++;
                }
                maxLanesInRow = Math.max(maxLanesInRow, lane + 1);
                if (lane === laneEnds.length) laneEnds.push(seg.endCol);
                else laneEnds[lane] = seg.endCol;
              }
              maxLanesPerRow.set(row, Math.max(1, maxLanesInRow));
            }
            
            // Calculate row heights based on max lanes needed
            const rowHeights = new Map<number, number>();
            const baseCellHeight = gridDims.cell;
            for (const [row, maxLanes] of maxLanesPerRow) {
              const requiredHeight = labelOffset + maxLanes * laneHeight + 2;
              rowHeights.set(row, Math.max(baseCellHeight, requiredHeight));
            }
            
            // Store row heights for grid template
            const totalRows = view === "default" 
              ? Math.ceil(days.length / (gridDims.cols || 12))
              : view === "months" 
                ? monthsGroups.length 
                : weeksGroups.length;
            
            // Generate grid template rows
            const gridTemplateRows = Array.from({ length: totalRows }, (_, i) => {
              const height = rowHeights.get(i) || baseCellHeight;
              return `${height}px`;
            }).join(' ');
            
            // Calculate cumulative row positions for accurate event positioning
            const rowPositions = new Map<number, number>();
            let cumulativeTop = pad;
            for (let r = 0; r < totalRows; r++) {
              rowPositions.set(r, cumulativeTop);
              const height = rowHeights.get(r) || baseCellHeight;
              cumulativeTop += height + gap;
            }
            
            for (const [row, segs] of rowToSegs) {
              segs.sort((a, b) => a.startCol - b.startCol);
              const laneEnds: number[] = [];
              for (const seg of segs) {
                let lane = 0;
                while (
                  lane < laneEnds.length &&
                  seg.startCol < laneEnds[lane]
                ) {
                  lane++;
                }
                // Always render - no skipping, rows will expand to fit
                if (lane === laneEnds.length) laneEnds.push(seg.endCol);
                else laneEnds[lane] = seg.endCol;
                
                const rowTop = rowPositions.get(row) || 0;
                const left = pad + indexColWidth + seg.startCol * (cellSizePx.w + gap);
                const top = rowTop + labelOffset + lane * laneHeight;
                const span = seg.endCol - seg.startCol;
                const width = span * cellSizePx.w + (span - 1) * gap;
                const key = `${seg.ev.id}:${row}:${seg.startCol}-${seg.endCol}:${lane}`;
                const bg = seg.ev.calendarId
                  ? calendarColors[seg.ev.calendarId]
                  : undefined;
                bars.push(
                  <div
                    key={key}
                    style={{
                      position: "absolute",
                      left,
                      top,
                      width,
                      height: laneHeight - 2,
                    }}
                    className="px-1 pointer-events-auto cursor-pointer"
                    onClick={(e) => {
                      e.stopPropagation();
                      const rect = (
                        e.currentTarget as HTMLDivElement
                      ).getBoundingClientRect();
                      setPopover({
                        event: seg.ev,
                        x: rect.left + rect.width / 2,
                        y: rect.bottom + 8,
                      });
                    }}
                  >
                    <div
                      className="truncate rounded-sm px-1 text-[10px] leading-[14px] shadow-sm"
                      style={{
                        backgroundColor: bg || "hsl(var(--secondary))",
                        color: "#ffffff",
                        height: laneHeight - 2,
                        lineHeight: `${laneHeight - 4}px`,
                      }}
                    >
                      {seg.ev.summary}
                    </div>
                  </div>
                );
              }
            }
            return bars;
          }, [
            events,
            dayIndexByKey,
            gridDims.cols,
            cellSizePx,
            calendarColors,
            view,
            days,
            monthsGroups,
            weeksGroups,
            headerRowHeight,
          ])}
            </div>
          </div>
        </div>
      </div>
      {popover.event && isEditing && (
        <>
          <div
            className="fixed inset-0 bg-background/60 z-40"
            onClick={() => {
              if (!isSubmitting) {
                setIsEditing(false);
              }
            }}
            aria-hidden
          />
          <div
            className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none"
            role="dialog"
            aria-label="Edit event"
          >
            <div
              ref={popoverRef}
              className="rounded-md border bg-card shadow-lg pointer-events-auto w-full max-w-md"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="px-4 pt-4 pb-2 flex items-center justify-between">
                <div className="font-semibold">Edit event</div>
                <button
                  className="text-muted-foreground hover:text-foreground flex-shrink-0 ml-2"
                  onClick={() => setIsEditing(false)}
                  disabled={isSubmitting}
                  aria-label="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="px-4 pt-2 pb-4 space-y-3">
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-muted-foreground">
                    <Plus className="h-4 w-4" />
                  </div>
                  <input
                    className="flex-1 border-0 bg-transparent px-0 py-1 text-sm focus:outline-none focus:ring-0 placeholder:text-muted-foreground"
                    placeholder="Event title"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    disabled={isSubmitting}
                    autoFocus
                  />
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center text-muted-foreground">
                    <CalendarIcon className="h-4 w-4" />
                  </div>
                  <div className="flex-1 flex items-center justify-between">
                    <div className="flex items-center">
                      <input
                        ref={editStartDateInputRef}
                        type="date"
                        className="border-0 bg-transparent px-0 py-1 text-sm focus:outline-none focus:ring-0 w-24 [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                        value={editStartDate}
                        onChange={(e) => {
                          const v = e.target.value;
                          setEditStartDate(v);
                          if (
                            editHasEndDate &&
                            editEndDate &&
                            v &&
                            editEndDate < v
                          ) {
                            setEditEndDate(v);
                          }
                        }}
                        onClick={(e) => {
                          e.currentTarget.showPicker?.();
                          e.currentTarget.focus();
                        }}
                        disabled={isSubmitting}
                      />
                      {editHasEndDate && (
                        <>
                          <span className="text-muted-foreground">–</span>
                          <input
                            ref={editEndDateInputRef}
                            type="date"
                            className="border-0 bg-transparent px-0 py-1 text-sm focus:outline-none focus:ring-0 ml-2 [&::-webkit-calendar-picker-indicator]:hidden [&::-webkit-calendar-picker-indicator]:appearance-none"
                            value={editEndDate}
                            min={editStartDate || undefined}
                            onChange={(e) => setEditEndDate(e.target.value)}
                            onClick={(e) => {
                              e.currentTarget.showPicker?.();
                              e.currentTarget.focus();
                            }}
                            disabled={isSubmitting}
                          />
                        </>
                      )}
                    </div>
                    {editHasEndDate ? (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setEditHasEndDate(false);
                          setEditEndDate("");
                        }}
                        disabled={isSubmitting}
                      >
                        Remove
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="text-xs text-muted-foreground hover:text-foreground"
                        onClick={() => {
                          setEditHasEndDate(true);
                          if (!editEndDate) setEditEndDate(editStartDate);
                        }}
                        disabled={isSubmitting}
                      >
                        Add end date
                      </button>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                    {editCalendarId && calendarColors[editCalendarId] ? (
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{
                          backgroundColor: calendarColors[editCalendarId],
                        }}
                      />
                    ) : (
                      <div className="w-3 h-3 rounded-full bg-muted" />
                    )}
                  </div>
                  <div className="flex-1">
                    <Select
                      value={editCalendarId}
                      onValueChange={setEditCalendarId}
                      disabled={isSubmitting}
                    >
                      <SelectTrigger className="w-full border-0 bg-transparent px-0 py-1 h-auto shadow-none focus:ring-0 justify-start gap-1">
                        <SelectValue placeholder="Select a calendar">
                          {editCalendarId && calendarNames[editCalendarId]
                            ? calendarNames[editCalendarId]
                            : "Select a calendar"}
                        </SelectValue>
                      </SelectTrigger>
                      <SelectContent>
                        {writableAccountsWithCalendars.length > 0
                          ? writableAccountsWithCalendars.map(
                              ({ accountId, email, list }) => (
                                <SelectGroup key={accountId || email}>
                                  <SelectLabel>
                                    {email && email.length
                                      ? email
                                      : accountId || "Account"}
                                  </SelectLabel>
                                  {list.map((c) => (
                                    <SelectItem key={c.id} value={c.id}>
                                      {c.summary}
                                    </SelectItem>
                                  ))}
                                </SelectGroup>
                              )
                            )
                          : writableCalendars.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {(c.accountEmail
                                  ? `${c.accountEmail} — `
                                  : "") + c.summary}
                              </SelectItem>
                            ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              </div>
              <div className="p-4 border-t flex items-center justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => setIsEditing(false)}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>
                <Button
                  onClick={async () => {
                    if (!popover.event || !onUpdateEvent) return;
                    if (!editTitle.trim()) {
                      alert("Title is required");
                      return;
                    }
                    if (!editCalendarId) {
                      alert("Calendar is required");
                      return;
                    }
                    if (
                      editHasEndDate &&
                      editEndDate &&
                      editEndDate < editStartDate
                    ) {
                      alert("End date must be on/after start date");
                      return;
                    }
                    try {
                      setIsSubmitting(true);
                      await onUpdateEvent({
                        id: popover.event.id,
                        title: editTitle.trim(),
                        calendarId: editCalendarId,
                        startDate: editStartDate,
                        endDate: editHasEndDate ? editEndDate : undefined,
                      });
                      setIsEditing(false);
                      setPopover({ event: null, x: 0, y: 0 });
                    } catch (err) {
                      alert("Failed to update event");
                    } finally {
                      setIsSubmitting(false);
                    }
                  }}
                  disabled={isSubmitting || !editTitle.trim()}
                >
                  {isSubmitting ? "Saving…" : "Save"}
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
      {popover.event && !isEditing && (
        <div
          ref={popoverRef}
          className="fixed z-50 w-80 max-w-[90vw] rounded-md border bg-card shadow-lg"
          style={{
            top: popover.y,
            left: popover.x,
            transform: "translateX(-50%)",
          }}
          role="dialog"
          aria-label="Event details"
        >
          <div className="px-3 py-2 flex items-center justify-between">
            <div className="font-medium truncate flex-1">
              {popover.event.summary}
            </div>
            <div className="flex items-center gap-1">
              <div className="relative" ref={menuRef}>
                <button
                  className="text-muted-foreground hover:text-foreground flex-shrink-0 p-1"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(!menuOpen);
                  }}
                  aria-label="More options"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-full mt-1 w-48 bg-card border rounded-md shadow-lg z-50 py-1">
                    {onUpdateEvent && writableCalendars.length > 0 && (
                      <button
                        className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition"
                        onClick={(e) => {
                          e.stopPropagation();
                          setIsEditing(true);
                          setMenuOpen(false);
                        }}
                      >
                        Edit
                      </button>
                    )}
                    <button
                      className="w-full text-left px-3 py-1.5 text-sm hover:bg-accent hover:text-accent-foreground transition"
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onHideEvent && popover.event) {
                          onHideEvent(popover.event.id);
                        }
                        setPopover({ event: null, x: 0, y: 0 });
                        setMenuOpen(false);
                      }}
                    >
                      Hide event
                    </button>
                    {onDeleteEvent && popover.event && (
                      <button
                        className="w-full text-left px-3 py-1.5 text-sm text-destructive hover:bg-destructive hover:text-destructive-foreground transition"
                        onClick={async (e) => {
                          e.stopPropagation();
                          const id = popover.event?.id;
                          if (!id) return;
                          const ok =
                            typeof window !== "undefined"
                              ? window.confirm("Delete this event?")
                              : true;
                          if (!ok) return;
                          try {
                            await onDeleteEvent(id);
                          } finally {
                            setPopover({ event: null, x: 0, y: 0 });
                            setMenuOpen(false);
                          }
                        }}
                      >
                        Delete event
                      </button>
                    )}
                  </div>
                )}
              </div>
              <button
                className="text-muted-foreground hover:text-foreground flex-shrink-0 p-1"
                onClick={() => setPopover({ event: null, x: 0, y: 0 })}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="px-3 text-sm text-muted-foreground flex items-center gap-2">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{
                backgroundColor:
                  (popover.event.calendarId &&
                    calendarColors[popover.event.calendarId]) ||
                  "hsl(var(--secondary))",
              }}
            />
            <span className="truncate">
              {(popover.event.calendarId &&
                calendarNames[popover.event.calendarId]) ||
                "Calendar"}
              {popover.event.calendarId &&
                calendarAccounts &&
                calendarAccounts[popover.event.calendarId] && (
                  <span className="ml-1 text-muted-foreground">
                    ({calendarAccounts[popover.event.calendarId]})
                  </span>
                )}
            </span>
          </div>
          <div className="px-3 pb-3 mt-1.5 text-sm text-muted-foreground flex items-center gap-2">
            <CalendarIcon className="h-2.5 w-2.5" />
            <span>
              {formatDisplayRange(
                popover.event.startDate,
                popover.event.endDate
              )}
            </span>
          </div>
        </div>
      )}

      {!signedIn && (
        <div className="fixed inset-0 flex items-center justify-center bg-background/70">
          <div className="rounded-md border bg-card p-12 text-center shadow-sm pointer-events-auto">
            <div className="text-lg font-medium mb-2">Big Year</div>
            <div className="text-sm text-muted-foreground mb-4">
              Only all-day events will appear once you sign in.
            </div>
            <Button
              onClick={() => {
                const callbackUrl =
                  typeof window !== "undefined" ? window.location.href : "/";
                signIn("google", { callbackUrl });
              }}
            >
              Sign in with Google
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
