import { setIcon } from "obsidian";

import {
  calendarDate,
  eventsForDay,
  getCurrentAndNextEvents,
  getDayProgress
} from "../calendar/logic";
import { disconnectedCalendarPresentation } from "./calendar-presentation";
import type {
  AlexOsActions,
  AlexOsSettings,
  CalendarEvent,
  DailyInspirationSummary,
  DashboardState,
  ProjectSummary,
  QuickLink
} from "../types";

type ElementOptions = {
  className?: string;
  text?: string;
  ariaLabel?: string;
};

function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {}
): HTMLElementTagNameMap[K] {
  return createEl(tag, {
    ...(options.className ? { cls: options.className } : {}),
    ...(options.text !== undefined ? { text: options.text } : {}),
    ...(options.ariaLabel ? { attr: { "aria-label": options.ariaLabel } } : {})
  });
}

function icon(name: string, className = "alex-os-icon"): HTMLElement {
  const node = element("span", { className });
  setIcon(node, name);
  return node;
}

function button(
  label: string,
  iconName?: string,
  className = "alex-os-button"
): HTMLButtonElement {
  const node = element("button", { className, ariaLabel: label });
  node.type = "button";
  if (iconName) node.append(icon(iconName));
  node.append(element("span", { text: label }));
  return node;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function parseEventDate(value: string, _allDay = false): Date {
  return calendarDate(value);
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function eventsOnDate(events: CalendarEvent[], date: Date): CalendarEvent[] {
  return eventsForDay(events, date);
}

function currentAndNext(events: CalendarEvent[], now = new Date()): {
  current?: CalendarEvent;
  next?: CalendarEvent;
} {
  const { current, next } = getCurrentAndNextEvents(events, now);
  return {
    ...(current ? { current } : {}),
    ...(next ? { next } : {})
  };
}

function durationLabel(milliseconds: number): string {
  const safe = Math.max(0, milliseconds);
  const totalMinutes = Math.ceil(safe / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours && minutes) return `${hours}h ${minutes}m`;
  if (hours) return `${hours}h`;
  return `${minutes}m`;
}

function relativeAge(isoOrMilliseconds?: string | number): string {
  if (!isoOrMilliseconds) return "not yet";
  const milliseconds =
    typeof isoOrMilliseconds === "number"
      ? Date.now() - isoOrMilliseconds
      : Date.now() - new Date(isoOrMilliseconds).getTime();
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "just now";
  const seconds = Math.floor(milliseconds / 1_000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function safeColor(value: string): string {
  return /^(#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([^)]*\))$/i.test(value)
    ? value
    : "var(--alex-blue)";
}

function displayTitle(path: string): string {
  const basename = path.split("/").at(-1) ?? path;
  return basename.replace(/\.md$/i, "");
}

export class DashboardRenderer {
  private state: DashboardState;
  private settings: AlexOsSettings;
  private ticker: number | null = null;
  private captureDraft = "";
  private captureStatus = "";
  private captureBusy = false;
  private weekExpanded = false;
  private hasRendered = false;
  private selectedEventId: string | null = null;
  private lastTemporalSignature = "";
  private refreshBusy = false;
  private previewView: HTMLElement | null = null;

  constructor(
    private readonly container: HTMLElement,
    state: DashboardState,
    settings: AlexOsSettings,
    private readonly actions: AlexOsActions
  ) {
    this.state = state;
    this.settings = settings;
  }

  mount(): void {
    this.container.classList.add("alex-os-host");
    this.previewView = this.container.closest<HTMLElement>(".markdown-preview-view");
    this.previewView?.classList.add("alex-os-dashboard-view");
    this.render();
    this.ticker = window.setInterval(() => this.tick(), 15_000);
  }

  update(state: DashboardState, settings = this.settings): void {
    const active = document.activeElement;
    const focusLabel =
      active instanceof HTMLElement && this.container.contains(active)
        ? active.getAttribute("aria-label")
        : null;
    this.state = state;
    this.settings = settings;
    this.render();
    if (focusLabel) {
      const target = [...this.container.querySelectorAll<HTMLElement>("[aria-label]")].find(
        (candidate) => candidate.getAttribute("aria-label") === focusLabel
      );
      target?.focus();
      if (target instanceof HTMLInputElement) {
        target.setSelectionRange(target.value.length, target.value.length);
      }
    }
  }

  destroy(): void {
    if (this.ticker !== null) window.clearInterval(this.ticker);
    this.ticker = null;
    this.container.replaceChildren();
    this.container.classList.remove("alex-os-host");
    const previewView = this.previewView;
    this.previewView = null;
    if (previewView && !previewView.querySelector(".alex-os-host")) {
      previewView.classList.remove("alex-os-dashboard-view");
    }
  }

  private render(): void {
    const root = element("div", {
      className: `alex-os alex-os--${this.settings.density} ${this.hasRendered ? "alex-os--settled" : ""}`
    });
    root.append(this.renderHero());
    const inspiration = this.state.local?.inspiration;
    if (this.settings.visibleModules.inspiration && inspiration) {
      root.append(this.renderInspiration(inspiration));
    }

    const grid = element("div", { className: "alex-os-grid" });
    if (this.settings.visibleModules.calendar) grid.append(this.renderCalendar());

    const rail = element("div", { className: "alex-os-rail" });
    rail.append(this.renderNowNext());
    if (this.settings.visibleModules.focus) rail.append(this.renderFocus());
    rail.append(this.renderCapture());
    grid.append(rail);

    grid.append(this.renderPulse());
    if (this.settings.visibleModules.projects) grid.append(this.renderProjects());
    grid.append(this.renderJournal());
    grid.append(this.renderNavigation());
    if (this.settings.visibleModules.recent) grid.append(this.renderRecent());
    grid.append(this.renderSystemStatus());
    root.append(grid, this.renderFooter());

    this.container.replaceChildren(root);
    this.lastTemporalSignature = this.temporalSignature();
    this.updateTemporalNodes();
    if (this.selectedEventId) {
      const selected = this.state.calendar.cache?.events.find(
        (event) => event.id === this.selectedEventId
      );
      if (selected) this.mountEventDetails(selected);
      else this.selectedEventId = null;
    }
    this.hasRendered = true;
  }

  private renderHero(): HTMLElement {
    const hero = element("header", { className: "alex-os-hero" });
    hero.append(
      element("div", { className: "alex-os-orb alex-os-orb--one" }),
      element("div", { className: "alex-os-orb alex-os-orb--two" })
    );

    const top = element("div", { className: "alex-os-hero-top" });
    const brand = element("div", { className: "alex-os-brand" });
    brand.append(icon("sparkles"), element("span", { text: "ALEX OS" }));
    brand.append(element("span", { className: "alex-os-brand-sub", text: "PERSONAL COMMAND" }));

    const controls = element("div", { className: "alex-os-hero-controls" });
    const refresh = button("Refresh", "refresh-cw", "alex-os-icon-button alex-os-refresh-button");
    this.reflectRefreshState(refresh);
    refresh.addEventListener("click", () => {
      if (this.refreshBusy) return;
      this.refreshBusy = true;
      this.reflectRefreshState(refresh);
      void this.actions.refreshAll(true).finally(() => {
        this.refreshBusy = false;
        const current = this.container.querySelector<HTMLButtonElement>(".alex-os-refresh-button");
        if (current) this.reflectRefreshState(current);
      });
    });
    const settings = button("Settings", "settings-2", "alex-os-icon-button");
    settings.addEventListener("click", () => this.actions.openSettings());
    controls.append(refresh, settings);
    top.append(brand, controls);

    const now = new Date();
    const copy = element("div", { className: "alex-os-hero-copy" });
    copy.append(
      element("p", { className: "alex-os-eyebrow", text: this.greeting(now) }),
      element("h2", { text: `${this.settings.greetingName}’s command center` }),
      element("p", {
        className: "alex-os-date-line",
        text: now.toLocaleDateString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
          year: "numeric"
        })
      })
    );

    const timePanel = element("div", { className: "alex-os-time-panel" });
    timePanel.append(
      element("span", { className: "alex-os-clock", text: "--:--" }),
      element("span", { className: "alex-os-time-caption", text: "LOCAL TIME" })
    );

    const main = element("div", { className: "alex-os-hero-main" });
    main.append(copy, timePanel);

    const progress = element("div", { className: "alex-os-day-progress" });
    const progressLabels = element("div", { className: "alex-os-progress-labels" });
    progressLabels.append(
      element("span", { text: "Today in motion" }),
      element("span", { className: "alex-os-day-percent", text: "0% elapsed" })
    );
    const track = element("div", { className: "alex-os-progress-track" });
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-label", "Day progress");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    track.append(element("div", { className: "alex-os-progress-fill" }));
    progress.append(progressLabels, track);

    const chips = element("div", { className: "alex-os-hero-chips" });
    const hasSchedule = this.calendarCoversDay(now) && this.calendarSelectionEnabled();
    const calendarDisconnected = !this.state.calendar.cache && !this.state.calendar.connected;
    const disconnected = disconnectedCalendarPresentation(this.actions.canConnectGoogle);
    const { current, next } = hasSchedule
      ? currentAndNext(this.state.calendar.cache?.events ?? [], now)
      : { current: undefined, next: undefined };
    const calendarChip = this.heroChip(
      this.state.calendar.connected ? "cloud-check" : "cloud-off",
      "Calendar",
      this.calendarFreshness(),
      this.state.calendar.error ? "red" : "cyan"
    );
    calendarChip.classList.add("alex-os-calendar-chip");
    chips.append(
      this.heroChip(
        "calendar-clock",
        "Now",
        hasSchedule
          ? current?.title ?? "Open block"
          : this.calendarSelectionEnabled()
            ? calendarDisconnected
              ? disconnected.nowLabel
              : "Schedule unavailable"
            : "Calendars hidden",
        current
          ? "blue"
          : hasSchedule
            ? "green"
            : this.calendarSelectionEnabled()
              ? calendarDisconnected
                ? "purple"
                : "red"
              : "purple"
      ),
      this.heroChip(
        "arrow-right",
        "Next",
        hasSchedule
          ? next?.title ?? "No event queued"
          : this.calendarSelectionEnabled()
            ? calendarDisconnected
              ? disconnected.nextLabel
              : "Refresh calendar"
            : "Select calendars",
        hasSchedule || !this.calendarSelectionEnabled() || calendarDisconnected ? "purple" : "red"
      ),
      calendarChip
    );

    hero.append(top, main, progress, chips);
    return hero;
  }

  private heroChip(iconName: string, label: string, value: string, tone: string): HTMLElement {
    const chip = element("div", { className: `alex-os-hero-chip alex-os-tone-${tone}` });
    chip.append(icon(iconName), element("span", { className: "alex-os-chip-label", text: label }));
    chip.append(element("strong", { text: value }));
    return chip;
  }

  private renderInspiration(inspiration: DailyInspirationSummary): HTMLElement {
    const section = element("section", {
      className: "alex-os-inspiration",
      ariaLabel: "Daily inspiration"
    });

    const quotePanel = element("div", {
      className: "alex-os-inspiration-panel alex-os-inspiration-quote"
    });
    const quoteLabel = element("div", { className: "alex-os-inspiration-label" });
    quoteLabel.append(icon("quote"), element("span", { text: "A small reminder" }));
    const quote = element("blockquote");
    quote.append(
      element("p", { text: `“${inspiration.quote.text}”` }),
      element("cite", { text: `— ${inspiration.quote.author}` })
    );
    quotePanel.append(quoteLabel, quote);

    const highlight = element(inspiration.highlight.path ? "button" : "div", {
      className: "alex-os-inspiration-panel alex-os-book-highlight",
      ariaLabel: inspiration.highlight.path
        ? `Open ${inspiration.highlight.bookTitle} by ${inspiration.highlight.author}. Highlight: ${inspiration.highlight.text} Source: ${inspiration.highlight.sourceLabel}.`
        : undefined
    });
    if (highlight instanceof HTMLButtonElement) {
      highlight.type = "button";
      highlight.addEventListener("click", () => {
        if (inspiration.highlight.path) void this.actions.openPath(inspiration.highlight.path);
      });
    }
    const highlightLabel = element("span", { className: "alex-os-inspiration-label" });
    highlightLabel.append(icon("book-open"), element("span", { text: "From your books" }));
    const source = element("span", { className: "alex-os-book-source" });
    source.append(
      element("strong", {
        text: `${inspiration.highlight.bookTitle} · ${inspiration.highlight.author}`
      }),
      element("span", { text: inspiration.highlight.sourceLabel })
    );
    highlight.append(
      highlightLabel,
      element("span", {
        className: "alex-os-book-highlight-text",
        text: `“${inspiration.highlight.text}”`
      }),
      source,
      ...(inspiration.highlight.path ? [icon("arrow-up-right", "alex-os-book-open-icon")] : [])
    );

    section.append(quotePanel, highlight);
    return section;
  }

  private renderCalendar(): HTMLElement {
    const card = this.card("calendar", "Today", "calendar-days", "blue");
    const heading = card.querySelector<HTMLElement>(".alex-os-card-heading");
    const syncTone = this.state.calendar.error
      ? "is-error"
      : this.state.calendar.connected
        ? ""
        : this.state.calendar.cache
          ? "is-cached"
          : "is-disconnected";
    const status = element("span", {
      className: `alex-os-sync-status ${syncTone}`,
      text: this.state.calendar.phase === "refreshing" ? "Refreshing…" : this.calendarFreshness()
    });
    heading?.append(status);

    const now = new Date();
    const cacheCoversToday = this.calendarCoversDay(now);
    const selectionEnabled = this.calendarSelectionEnabled();
    const hasSchedule = cacheCoversToday && selectionEnabled;
    const events = hasSchedule
      ? eventsOnDate(this.state.calendar.cache?.events ?? [], now)
      : [];
    const body = element("div", { className: "alex-os-timeline" });

    if (!this.state.calendar.cache && !this.state.calendar.connected) {
      const disconnected = disconnectedCalendarPresentation(this.actions.canConnectGoogle);
      body.append(
        this.emptyState(
          "calendar-plus",
          disconnected.emptyTitle,
          disconnected.emptyDescription
        )
      );
      if (disconnected.actionLabel) {
        const connect = button(disconnected.actionLabel, "link-2", "alex-os-button alex-os-button--primary");
        connect.addEventListener("click", () => {
          void this.actions.connectGoogle().catch(() => undefined);
        });
        body.append(connect);
      }
    } else if (!selectionEnabled) {
      body.append(
        this.emptyState(
          "eye-off",
          "All calendars are hidden",
          "Choose at least one visible calendar in Alex OS settings."
        )
      );
      const settings = button("Choose calendars", "settings-2", "alex-os-button");
      settings.addEventListener("click", () => this.actions.openSettings());
      body.append(settings);
    } else if (!cacheCoversToday) {
      body.append(
        this.emptyState(
          "calendar-x-2",
          "Schedule unavailable",
          this.state.calendar.connected
            ? "The cached date window has expired. Refreshing will restore today’s schedule."
            : "The cached date window has expired. Open Alex OS on the connected desktop to refresh it."
        )
      );
    } else if (events.length === 0) {
      body.append(
        this.emptyState(
          "calendar-check-2",
          "A clear runway",
          this.state.calendar.error
            ? "Cached data is still available; the latest refresh failed."
            : "No events are scheduled for today."
        )
      );
    } else {
      const context = currentAndNext(events);
      let occupiedUntil: number | undefined;
      for (const event of events) {
        if (!event.allDay) {
          const eventStart = parseEventDate(event.start).getTime();
          const eventEnd = parseEventDate(event.end).getTime();
          if (occupiedUntil !== undefined && eventStart - occupiedUntil >= 45 * 60_000) {
            body.append(this.renderGap(occupiedUntil, eventStart));
          }
          occupiedUntil = Math.max(occupiedUntil ?? eventEnd, eventEnd);
        }
        body.append(this.renderEvent(event, event.id === context.current?.id, event.id === context.next?.id));
      }
    }

    card.append(body);
    if (hasSchedule) card.append(this.renderWeek());
    return card;
  }

  private renderEvent(event: CalendarEvent, isCurrent: boolean, isNext: boolean): HTMLElement {
    const row = element("button", {
      className: `alex-os-event ${isCurrent ? "is-current" : ""} ${isNext ? "is-next" : ""} ${event.allDay ? "is-all-day" : ""}`,
      ariaLabel: `Show details for ${event.title}`
    });
    row.type = "button";
    row.style.setProperty("--alex-event-color", safeColor(event.color));

    const time = element("div", { className: "alex-os-event-time" });
    if (event.allDay) {
      time.append(element("strong", { text: "ALL" }), element("span", { text: "DAY" }));
    } else {
      time.append(
        element("strong", {
          text: parseEventDate(event.start).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit"
          })
        }),
        element("span", {
          text: parseEventDate(event.end).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit"
          })
        })
      );
    }

    const marker = element("span", { className: "alex-os-event-marker" });
    const content = element("div", { className: "alex-os-event-content" });
    const titleLine = element("div", { className: "alex-os-event-title-line" });
    titleLine.append(element("strong", { text: event.title }));
    if (isCurrent) titleLine.append(element("span", { className: "alex-os-live-pill", text: "NOW" }));
    else if (isNext) titleLine.append(element("span", { className: "alex-os-next-pill", text: "NEXT" }));
    const meta = element("span", { className: "alex-os-event-meta", text: event.calendarName });
    if (event.location) meta.append(document.createTextNode(` · ${event.location}`));
    content.append(titleLine, meta);
    row.append(time, marker, content, icon("chevron-right", "alex-os-event-chevron"));
    row.addEventListener("click", () => this.showEventDetails(event));
    return row;
  }

  private renderGap(start: number, end: number): HTMLElement {
    const gap = element("div", { className: "alex-os-gap" });
    gap.append(
      icon("coffee"),
      element("span", { text: `${durationLabel(end - start)} open` }),
      element("span", {
        text: `${new Date(start).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}–${new Date(end).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`
      })
    );
    return gap;
  }

  private renderWeek(): HTMLElement {
    const details = element("details", { className: "alex-os-week" });
    details.open = this.weekExpanded;
    details.addEventListener("toggle", () => {
      this.weekExpanded = details.open;
    });
    const summary = element("summary");
    summary.append(icon("calendar-range"), element("strong", { text: "Next seven days" }));
    const action = element("span", { text: this.weekExpanded ? "Collapse week" : "Expand week" });
    summary.append(action, icon("chevron-down"));
    details.addEventListener("toggle", () => {
      action.textContent = details.open ? "Collapse week" : "Expand week";
    });
    details.append(summary);

    const days = element("div", { className: "alex-os-week-days" });
    const events = this.state.calendar.cache?.events ?? [];
    const today = startOfDay(new Date());
    for (let offset = 0; offset < 7; offset += 1) {
      const date = new Date(today);
      date.setDate(date.getDate() + offset);
      const covered = this.calendarCoversDay(date);
      const dayEvents = covered ? eventsOnDate(events, date) : [];
      const day = element("div", {
        className: `alex-os-week-day ${offset === 0 ? "is-today" : ""} ${covered ? "" : "is-unavailable"}`
      });
      const dayHead = element("div", { className: "alex-os-week-day-head" });
      dayHead.append(
        element("span", { text: date.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase() }),
        element("strong", { text: String(date.getDate()) }),
        element("span", {
          text: covered
            ? `${dayEvents.length} ${dayEvents.length === 1 ? "event" : "events"}`
            : "not cached"
        })
      );
      day.append(dayHead);
      const preview = element("div", { className: "alex-os-week-preview" });
      if (!covered) preview.append(element("span", { text: "Schedule unavailable" }));
      else if (dayEvents.length === 0) preview.append(element("span", { text: "Open" }));
      for (const event of dayEvents.slice(0, 3)) {
        const item = element("button", { ariaLabel: `Show ${event.title}` });
        item.type = "button";
        item.style.setProperty("--alex-event-color", safeColor(event.color));
        item.append(
          element("span", { className: "alex-os-week-dot" }),
          element("span", { text: event.title }),
          element("small", {
            text: event.allDay
              ? "All day"
              : parseEventDate(event.start).toLocaleTimeString(undefined, {
                  hour: "2-digit",
                  minute: "2-digit"
                })
          })
        );
        item.addEventListener("click", () => this.showEventDetails(event));
        preview.append(item);
      }
      if (dayEvents.length > 3) preview.append(element("small", { text: `+${dayEvents.length - 3} more` }));
      day.append(preview);
      days.append(day);
    }
    details.append(days);
    return details;
  }

  private renderNowNext(): HTMLElement {
    const card = this.card("now-next", "Now / Next", "clock-3", "purple");
    const events = this.state.calendar.cache?.events ?? [];
    const selectionEnabled = this.calendarSelectionEnabled();
    const hasSchedule = this.calendarCoversDay(new Date()) && selectionEnabled;
    const calendarDisconnected = !this.state.calendar.cache && !this.state.calendar.connected;
    const disconnected = disconnectedCalendarPresentation(this.actions.canConnectGoogle);
    const { current, next } = hasSchedule
      ? currentAndNext(events)
      : { current: undefined, next: undefined };

    const now = element("div", { className: "alex-os-now-block" });
    now.append(element("span", { className: "alex-os-section-label", text: "NOW" }));
    now.append(
      element("strong", {
        text: hasSchedule
          ? current?.title ?? "Open block"
          : selectionEnabled
            ? calendarDisconnected
              ? disconnected.nowLabel
              : "Schedule unavailable"
            : "Calendars hidden"
      })
    );
    if (current) {
      now.append(
        element("span", {
          text: `until ${parseEventDate(current.end).toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit"
          })}`
        })
      );
    } else if (hasSchedule && next) {
      const gap = parseEventDate(next.start).getTime() - Date.now();
      if (gap >= 15 * 60_000) {
        const free = element("span", { className: "alex-os-free-pill" });
        free.append(icon("leaf"), document.createTextNode(`${durationLabel(gap)} free`));
        now.append(free);
      }
    }

    const divider = element("div", { className: "alex-os-card-divider" });
    const upcoming = element("div", { className: "alex-os-next-block" });
    upcoming.append(element("span", { className: "alex-os-section-label", text: "NEXT" }));
    if (!selectionEnabled) {
      upcoming.append(
        element("strong", { text: "Select calendars" }),
        element("span", { text: "All calendars are currently hidden." })
      );
    } else if (!hasSchedule) {
      upcoming.append(
        element("strong", { text: calendarDisconnected ? disconnected.nextLabel : "Refresh calendar" }),
        element("span", {
          text: calendarDisconnected
            ? disconnected.nextDescription
            : "Cached dates no longer cover today."
        })
      );
    } else if (next) {
      const title = element("button", { className: "alex-os-text-button", text: next.title });
      title.type = "button";
      title.addEventListener("click", () => this.showEventDetails(next));
      const countdown = element("span", { className: "alex-os-countdown", text: "" });
      countdown.dataset.start = next.start;
      upcoming.append(title, countdown);
      upcoming.append(
        element("span", {
          text: parseEventDate(next.start).toLocaleTimeString(undefined, {
            weekday: localDateKey(parseEventDate(next.start)) === localDateKey(new Date()) ? undefined : "short",
            hour: "2-digit",
            minute: "2-digit"
          })
        })
      );
    } else {
      upcoming.append(element("strong", { text: "Nothing queued" }), element("span", { text: "Your time is yours." }));
    }
    card.append(now, divider, upcoming);
    return card;
  }

  private renderFocus(): HTMLElement {
    const focus = this.state.local?.focus;
    const card = this.card("focus", "Main Focus", "target", "orange");
    card.classList.add("alex-os-focus-card");
    if (!focus || focus.source === "empty" || !focus.mainPriority) {
      card.append(
        this.emptyState(
          "crosshair",
          "Choose the outcome that makes today count",
          "Alex OS reads it from today’s Markdown daily-focus note."
        )
      );
      const create = button("Set today’s focus", "plus", "alex-os-button alex-os-button--warm");
      create.addEventListener("click", () => void this.actions.createOrOpenDailyFocus());
      card.append(create);
      return card;
    }

    card.append(element("span", { className: "alex-os-focus-kicker", text: "TODAY’S MAIN PRIORITY" }));
    const priority = element("div", { className: "alex-os-priority" });
    this.appendRichText(priority, focus.mainPriority);
    card.append(priority);
    if (focus.nextAction) {
      const next = element("div", { className: "alex-os-next-action" });
      next.append(icon("corner-down-right"), element("span", { text: focus.nextAction }));
      card.append(next);
    }
    if (focus.focusNotes.length) {
      const links = element("div", { className: "alex-os-focus-links" });
      for (const link of focus.focusNotes) {
        const node = button(link.label, "file-text", "alex-os-focus-link");
        node.addEventListener("click", () => void this.actions.openPath(link.path));
        links.append(node);
      }
      card.append(links);
    }
    const source = element("button", { className: "alex-os-source-link" });
    source.type = "button";
    source.append(icon("file-pen-line"), document.createTextNode(focus.source === "daily-focus" ? "Edit today’s focus" : "From yesterday’s journal"));
    source.addEventListener("click", () => {
      if (focus.path) void this.actions.openPath(focus.path);
      else void this.actions.createOrOpenDailyFocus();
    });
    card.append(source);
    return card;
  }

  private renderCapture(): HTMLElement {
    const card = this.card("capture", "Quick Capture", "zap", "yellow");
    const form = element("form", { className: "alex-os-capture-form" });
    const field = element("div", { className: "alex-os-capture-field" });
    field.append(icon("plus"));
    const input = element("input", {
      className: "alex-os-capture-input",
      ariaLabel: "Capture a thought to Input"
    });
    input.type = "text";
    input.placeholder = "Capture a thought, task, or question…";
    input.autocomplete = "off";
    input.value = this.captureDraft;
    input.disabled = this.captureBusy;
    input.addEventListener("input", () => {
      this.captureDraft = input.value;
    });
    const submit = button("Capture", "arrow-up", "alex-os-capture-submit");
    submit.type = "submit";
    submit.disabled = this.captureBusy;
    field.append(input, submit);
    form.append(field);
    const hint = element("div", { className: "alex-os-capture-hint" });
    const status = element("span", { className: "alex-os-capture-status", text: this.captureStatus });
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.setAttribute("aria-atomic", "true");
    hint.append(
      element("span", { text: "Enter to save directly to 01 Input" }),
      status
    );
    form.append(hint);
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const value = this.captureDraft.trim();
      if (!value || this.captureBusy) return;
      this.captureBusy = true;
      this.captureStatus = "Saving…";
      input.disabled = true;
      submit.disabled = true;
      status.textContent = this.captureStatus;
      void this.actions
        .capture(value)
        .then(() => {
          this.captureDraft = "";
          this.captureStatus = "✓ Captured to Input";
        })
        .catch((error: unknown) => {
          this.captureStatus = `Couldn’t capture: ${error instanceof Error ? error.message : "Unknown error"}`;
        })
        .finally(() => {
          this.captureBusy = false;
          const liveInput = this.container.querySelector<HTMLInputElement>(".alex-os-capture-input");
          const liveSubmit = this.container.querySelector<HTMLButtonElement>(".alex-os-capture-submit");
          const liveStatus = this.container.querySelector<HTMLElement>(".alex-os-capture-status");
          if (liveInput) {
            liveInput.disabled = false;
            liveInput.value = this.captureDraft;
          }
          if (liveSubmit) liveSubmit.disabled = false;
          if (liveStatus) liveStatus.textContent = this.captureStatus;
          liveInput?.focus();
        });
    });
    card.append(form);
    return card;
  }

  private renderPulse(): HTMLElement {
    const pulse = element("section", { className: "alex-os-pulse", ariaLabel: "Today at a glance" });
    const dayPercent = this.dayPercent();
    pulse.append(
      this.metric("inbox", String(this.state.local?.inboxCount ?? "—"), "in Input", "purple", () => {
        void this.actions.openPath(this.settings.inputFolder);
      }),
      this.metric("folder-kanban", String(this.state.local?.projects.length ?? "—"), "active projects", "orange", () => {
        void this.actions.openPath(this.settings.projectFolders[0] ?? "04 Projects");
      }),
      this.metric("sun-medium", `${dayPercent}%`, "of today elapsed", "yellow"),
      this.metric(
        "calendar-check",
        this.calendarCoversDay(new Date())
          ? String(eventsOnDate(this.state.calendar.cache?.events ?? [], new Date()).length)
          : "—",
        "events today",
        "blue"
      )
    );
    return pulse;
  }

  private metric(
    iconName: string,
    value: string,
    label: string,
    tone: string,
    onClick?: () => void
  ): HTMLElement {
    const wrapper = onClick
      ? element("button", { className: `alex-os-metric alex-os-tone-${tone}`, ariaLabel: `${value} ${label}` })
      : element("div", { className: `alex-os-metric alex-os-tone-${tone}` });
    if (wrapper instanceof HTMLButtonElement) {
      wrapper.type = "button";
      wrapper.addEventListener("click", onClick ?? (() => undefined));
    }
    wrapper.append(icon(iconName), element("strong", { text: value }), element("span", { text: label }));
    return wrapper;
  }

  private renderProjects(): HTMLElement {
    const projects = this.state.local?.projects ?? [];
    const card = this.card("projects", "Active Projects", "folder-kanban", "orange");
    const heading = card.querySelector<HTMLElement>(".alex-os-card-heading");
    heading?.append(element("span", { className: "alex-os-count-pill", text: String(projects.length) }));
    if (this.state.localLoading && !this.state.local) {
      card.append(this.skeleton(3));
      return card;
    }
    if (projects.length === 0) {
      card.append(
        this.emptyState(
          "folder-open",
          "No strict active projects",
          "Alex OS only shows Markdown notes with type: project and status: active."
        )
      );
      return card;
    }
    const list = element("div", { className: "alex-os-project-list" });
    for (const project of projects) list.append(this.renderProject(project));
    card.append(list);
    return card;
  }

  private renderProject(project: ProjectSummary): HTMLElement {
    const node = element("button", {
      className: "alex-os-project",
      ariaLabel: `Open project ${project.title}`
    });
    node.type = "button";
    const top = element("div", { className: "alex-os-project-top" });
    top.append(
      element("span", { className: "alex-os-project-glyph", text: project.title.slice(0, 1).toUpperCase() }),
      element("strong", { text: project.title }),
      element("span", { className: "alex-os-status-pill", text: project.status })
    );
    const action = element("div", { className: "alex-os-project-action" });
    action.append(
      element("span", { text: "NEXT" }),
      element("span", { text: project.nextAction ?? "Add next_action or a Next actions list" })
    );
    node.append(top, action, icon("arrow-up-right", "alex-os-project-arrow"));
    node.addEventListener("click", () => void this.actions.openPath(project.path));
    return node;
  }

  private renderJournal(): HTMLElement {
    const journal = this.state.local?.journal;
    const card = this.card("journal", "Today’s Journal", "notebook-pen", "cyan");
    if (!journal || journal.entries.length === 0) {
      card.append(
        this.emptyState(
          "book-dashed",
          "Today is still unwritten",
          "Create a dated entry inside the existing year/month journal structure."
        )
      );
      const create = button("Create today’s journal", "plus", "alex-os-button alex-os-button--cyan");
      create.addEventListener("click", () => void this.actions.createOrOpenJournal());
      card.append(create);
    } else {
      const entries = element("div", { className: "alex-os-journal-entries" });
      for (const entry of journal.entries) {
        const item = element("button", { ariaLabel: `Open ${entry.title}` });
        item.type = "button";
        item.append(
          icon(entry.isAddendum ? "file-plus-2" : "book-open-text"),
          element("span", { text: entry.title }),
          icon("arrow-up-right")
        );
        item.addEventListener("click", () => void this.actions.openPath(entry.path));
        entries.append(item);
      }
      card.append(entries);
    }
    return card;
  }

  private renderNavigation(): HTMLElement {
    const card = this.card("navigation", "Quick Navigation", "compass", "purple");
    const links = element("nav", { className: "alex-os-nav-grid", ariaLabel: "Alex OS quick navigation" });
    for (const quickLink of this.state.local?.quickLinks ?? this.settings.quickLinks) {
      links.append(this.renderQuickLink(quickLink));
    }
    card.append(links);
    return card;
  }

  private renderQuickLink(quickLink: QuickLink): HTMLElement {
    const node = element("button", {
      className: `alex-os-nav-link alex-os-tone-${quickLink.color}`,
      ariaLabel: `Open ${quickLink.label}`
    });
    node.type = "button";
    node.append(
      icon(quickLink.icon, "alex-os-nav-icon"),
      element("span", { text: quickLink.label }),
      icon("arrow-up-right", "alex-os-nav-arrow")
    );
    node.addEventListener("click", () => void this.actions.openPath(quickLink.path));
    return node;
  }

  private renderRecent(): HTMLElement {
    const card = this.card("recent", "Recent Activity", "history", "blue");
    const recent = this.state.local?.recent ?? [];
    if (recent.length === 0) {
      card.append(this.emptyState("clock", "Nothing recent yet", "Useful Markdown changes will appear here."));
      return card;
    }
    const list = element("div", { className: "alex-os-recent-list" });
    for (const note of recent) {
      const row = element("button", { ariaLabel: `Open ${note.title}` });
      row.type = "button";
      const glyph = element("span", { className: "alex-os-recent-glyph", text: note.title.slice(0, 1).toUpperCase() });
      const copy = element("span", { className: "alex-os-recent-copy" });
      copy.append(element("strong", { text: note.title }), element("span", { text: note.area }));
      row.append(glyph, copy, element("time", { text: relativeAge(note.modifiedAt) }), icon("chevron-right"));
      row.addEventListener("click", () => void this.actions.openPath(note.path));
      list.append(row);
    }
    card.append(list);
    return card;
  }

  private renderSystemStatus(): HTMLElement {
    const card = this.card("system", "System Status", "radio-tower", "green");
    const list = element("div", { className: "alex-os-system-list" });
    list.append(
      this.statusRow("Vault index", this.state.localError ? "Needs attention" : "Live", !this.state.localError),
      this.statusRow(
        this.actions.canConnectGoogle ? "Google Calendar" : "Calendar cache",
        this.state.calendar.connected
          ? this.state.calendar.error
            ? "Using cache"
            : "Connected"
          : this.state.calendar.cache
            ? this.actions.canConnectGoogle ? "Cached only" : "From desktop"
            : this.actions.canConnectGoogle ? "Not connected" : "Waiting for cache",
        !this.state.calendar.error
          && (this.state.calendar.connected || (!this.actions.canConnectGoogle && Boolean(this.state.calendar.cache)))
      )
    );
    if (this.state.calendar.error) {
      const error = element("div", { className: "alex-os-inline-error" });
      error.append(icon("triangle-alert"), element("span", { text: this.state.calendar.error }));
      card.append(list, error);
    } else {
      card.append(list);
    }
    const open = button("Open Alex OS settings", "settings", "alex-os-text-link");
    open.addEventListener("click", () => this.actions.openSettings());
    card.append(open);
    return card;
  }

  private statusRow(label: string, value: string, healthy: boolean): HTMLElement {
    const row = element("div", { className: "alex-os-status-row" });
    row.append(
      element("span", { className: `alex-os-status-dot ${healthy ? "is-healthy" : ""}` }),
      element("span", { text: label }),
      element("strong", { text: value })
    );
    return row;
  }

  private renderFooter(): HTMLElement {
    const footer = element("footer", { className: "alex-os-footer" });
    const source = element("span");
    source.append(icon("database"), document.createTextNode("Markdown is the source of truth"));
    const updated = element("span");
    updated.append(
      icon("rotate-ccw"),
      element("span", {
        className: "alex-os-vault-age",
        text: `Vault refreshed ${relativeAge(this.state.local?.refreshedAt)}`
      })
    );
    footer.append(source, updated);
    return footer;
  }

  private card(id: string, title: string, iconName: string, tone: string): HTMLElement {
    const card = element("section", {
      className: `alex-os-card alex-os-card--${id} alex-os-tone-${tone}`
    });
    const heading = element("header", { className: "alex-os-card-heading" });
    const titleWrap = element("div");
    titleWrap.append(icon(iconName), element("h3", { text: title }));
    heading.append(titleWrap);
    card.append(heading);
    return card;
  }

  private emptyState(iconName: string, title: string, copy: string): HTMLElement {
    const state = element("div", { className: "alex-os-empty" });
    state.append(icon(iconName, "alex-os-empty-icon"));
    const text = element("div");
    text.append(element("strong", { text: title }), element("span", { text: copy }));
    state.append(text);
    return state;
  }

  private skeleton(rows: number): HTMLElement {
    const wrapper = element("div", { className: "alex-os-skeleton" });
    for (let index = 0; index < rows; index += 1) wrapper.append(element("span"));
    return wrapper;
  }

  private appendRichText(container: HTMLElement, value: string): void {
    const pattern = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
    let cursor = 0;
    for (const match of value.matchAll(pattern)) {
      const index = match.index ?? 0;
      if (index > cursor) container.append(document.createTextNode(value.slice(cursor, index)));
      const path = match[1]?.trim();
      const label = match[2]?.trim() || (path ? displayTitle(path) : "Note");
      if (path) {
        const link = element("button", { className: "alex-os-inline-link", text: label });
        link.type = "button";
        link.addEventListener("click", () => void this.actions.openPath(path));
        container.append(link);
      }
      cursor = index + match[0].length;
    }
    if (cursor < value.length) container.append(document.createTextNode(value.slice(cursor)));
  }

  private showEventDetails(event: CalendarEvent): void {
    this.selectedEventId = event.id;
    this.mountEventDetails(event);
  }

  private mountEventDetails(event: CalendarEvent): void {
    this.container.querySelector(".alex-os-event-dialog")?.remove();
    const dialog = element("dialog", { className: "alex-os-event-dialog" });
    dialog.setAttribute("aria-label", `Calendar event: ${event.title}`);
    dialog.style.setProperty("--alex-event-color", safeColor(event.color));
    const close = button("Close", "x", "alex-os-dialog-close");
    close.addEventListener("click", () => dialog.close());
    const badge = element("div", { className: "alex-os-event-dialog-badge" });
    badge.append(element("span"), element("span", { text: event.calendarName }));
    const title = element("h3", { text: event.title });
    const rows = element("div", { className: "alex-os-event-dialog-rows" });
    const timeText = event.allDay
      ? "All day"
      : `${parseEventDate(event.start).toLocaleString(undefined, {
          weekday: "long",
          month: "long",
          day: "numeric",
          hour: "2-digit",
          minute: "2-digit"
        })} – ${parseEventDate(event.end).toLocaleTimeString(undefined, {
          hour: "2-digit",
          minute: "2-digit"
        })}`;
    rows.append(this.detailRow("clock-3", timeText));
    if (event.location) rows.append(this.detailRow("map-pin", event.location));
    dialog.append(close, badge, title, rows);
    dialog.addEventListener("click", (domEvent) => {
      if (domEvent.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      if (this.selectedEventId === event.id) this.selectedEventId = null;
      dialog.remove();
    });
    const root = this.container.querySelector<HTMLElement>(".alex-os");
    (root ?? this.container).append(dialog);
    dialog.showModal();
  }

  private detailRow(iconName: string, text: string): HTMLElement {
    const row = element("div", { className: "alex-os-detail-row" });
    row.append(icon(iconName), element("span", { text }));
    return row;
  }

  private greeting(date: Date): string {
    const hour = date.getHours();
    const period = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
    return `GOOD ${period.toUpperCase()} 👋`;
  }

  private calendarFreshness(): string {
    if (this.state.calendar.phase === "refreshing") return "syncing now";
    if (this.state.calendar.error) {
      return this.state.calendar.cache
        ? `cached ${relativeAge(this.state.calendar.cache.syncedAt)} · check failed`
        : "sync needs attention";
    }
    if (this.state.calendar.lastCheckedAt) return `checked ${relativeAge(this.state.calendar.lastCheckedAt)}`;
    if (this.state.calendar.cache?.syncedAt) return `cached ${relativeAge(this.state.calendar.cache.syncedAt)}`;
    return this.actions.canConnectGoogle ? "not connected" : "waiting for cache";
  }

  private dayPercent(date = new Date()): number {
    return Math.floor(getDayProgress(date));
  }

  private calendarCoversDay(date: Date): boolean {
    const cache = this.state.calendar.cache;
    if (!cache) return false;
    const start = startOfDay(date);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    return (
      new Date(cache.rangeStart).getTime() <= start.getTime() &&
      new Date(cache.rangeEnd).getTime() >= end.getTime()
    );
  }

  private calendarSelectionEnabled(): boolean {
    return this.settings.calendarSelectionMode === "all" || this.settings.selectedCalendarIds.length > 0;
  }

  private temporalSignature(now = new Date()): string {
    const hasSchedule = this.calendarCoversDay(now) && this.calendarSelectionEnabled();
    const { current, next } = hasSchedule
      ? currentAndNext(this.state.calendar.cache?.events ?? [], now)
      : { current: undefined, next: undefined };
    return `${localDateKey(now)}:${hasSchedule ? "covered" : "unavailable"}:${current?.id ?? ""}:${next?.id ?? ""}`;
  }

  private tick(): void {
    const now = new Date();
    if (this.temporalSignature(now) !== this.lastTemporalSignature) {
      this.render();
      return;
    }
    this.updateTemporalNodes(now);
  }

  private reflectRefreshState(refresh: HTMLButtonElement): void {
    refresh.disabled = this.refreshBusy;
    refresh.classList.toggle("is-spinning", this.refreshBusy);
    refresh.setAttribute("aria-busy", String(this.refreshBusy));
  }

  private updateTemporalNodes(now = new Date()): void {
    const percent = this.dayPercent(now);
    const clock = this.container.querySelector<HTMLElement>(".alex-os-clock");
    if (clock) {
      clock.textContent = now.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit"
      });
    }
    const percentage = this.container.querySelector<HTMLElement>(".alex-os-day-percent");
    if (percentage) percentage.textContent = `${percent}% elapsed`;
    const fill = this.container.querySelector<HTMLElement>(".alex-os-progress-fill");
    if (fill) fill.style.width = `${percent}%`;
    const track = this.container.querySelector<HTMLElement>(".alex-os-progress-track");
    if (track) track.setAttribute("aria-valuenow", String(percent));
    const freshness = this.calendarFreshness();
    const syncStatus = this.container.querySelector<HTMLElement>(".alex-os-sync-status");
    if (syncStatus && this.state.calendar.phase !== "refreshing") syncStatus.textContent = freshness;
    const calendarChip = this.container.querySelector<HTMLElement>(".alex-os-calendar-chip strong");
    if (calendarChip) calendarChip.textContent = freshness;
    const vaultAge = this.container.querySelector<HTMLElement>(".alex-os-vault-age");
    if (vaultAge) vaultAge.textContent = `Vault refreshed ${relativeAge(this.state.local?.refreshedAt)}`;
    for (const countdown of this.container.querySelectorAll<HTMLElement>(".alex-os-countdown")) {
      const start = countdown.dataset.start;
      if (!start) continue;
      const difference = parseEventDate(start).getTime() - now.getTime();
      countdown.textContent = difference > 0 ? `in ${durationLabel(difference)}` : "starting now";
    }
  }
}
