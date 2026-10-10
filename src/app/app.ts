import { Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { FormField, form } from '@angular/forms/signals';
import { Image, Pressable, SafeAreaProvider, SafeAreaView, ScrollView, Text, TextInput, View } from '@ng-native/components';
import { StatusBar } from '@ng-native/device';
import { getInstalledApps } from '@zecky-dev/react-native-app-list';
import { getApplicationIconAsync, openApplication } from 'expo-intent-launcher';

type AppInfo = {
  appName: string;     // nombre visible (p. ej. "Instagram")
  packageName: string; // package único (p. ej. "com.instagram.android")
};

interface TimerItem {
  id: string;
  triggerApp: string;
  appIcon: string;
  packageName: string | null;
  triggered: boolean;  // evita abrir la app más de una vez
  endTime: number | null; // momento exacto en que llega al máximo (null = sin límite alcanzable)
  intervalMs: number;
  addValue: number;
  maxValue: number;
  startTime: number;
  originalInterval: string;
  originalUnit: string;
}

const PLACEHOLDER_ICON = 'https://placehold.co/64/e4e4e7/71717a.png?text=?';

@Component({
  imports: [Pressable, SafeAreaProvider, SafeAreaView, Text, TextInput, View, ScrollView, FormField, Image],
  selector: 'app-root',
  template: `
    <safe-area-provider>
      <safe-area-view class="screen">
        <view class="body">
          <text class="title">count+timer</text>
          <text class="hint">set your interval, adjust the frequency.</text>

          <view class="input-group">
            <text class="field-label">Interval:</text>
            <view class="interval-row">
              <text-input
                keyboardType="numeric"
                class="input-field flex-1"
                placeholder="e.g. 1000"
                [formField]="timerForm.interval"
              />
              <view class="toggle-container">
                @for (u of units; track u) {
                  <pressable
                    class="toggle-btn"
                    [class.toggle-active]="model().unit === u"
                    (press)="setUnit(u)"
                  >
                    <text class="toggle-text" [class.toggle-text-active]="model().unit === u">{{ u }}</text>
                  </pressable>
                }
              </view>
            </view>
          </view>

          <view class="input-group">
            <text class="field-label">Add between intervals:</text>
            <text-input keyboardType="numeric" class="input-field" placeholder="e.g. 1" [formField]="timerForm.add" />
          </view>

          <view class="input-group">
            <text class="field-label">Notification limit (Max):</text>
            <text-input keyboardType="numeric" class="input-field" placeholder="e.g. 10" [formField]="timerForm.max" />
          </view>

          <view class="input-group">
            <text class="field-label">App to open when max is reached:</text>

            <!-- Input con icono dentro -->
            <view class="input-with-icon">
              <image class="app-icon" [src]="currentIcon()" />
              <text-input
                class="input-inner"
                placeholder="e.g. WhatsApp"
                [formField]="timerForm.triggerApp"
              />
            </view>

            <!-- Sugerencias -->
            @if (suggestions().length) {
              <view class="chips-row">
                @for (app of suggestions(); track app.packageName) {
                  <pressable class="chip" (press)="pickApp(app)">
                    <image class="chip-icon" [src]="icons()[app.packageName] || placeholder" />
                    <text class="chip-text">{{ app.appName }}</text>
                  </pressable>
                }
              </view>
            }
          </view>

          <pressable accessibilityRole="button" class="button" (press)="addToList()">
            <text class="label">Add to list</text>
          </pressable>

          <text class="list-title">Your Timers:</text>

          <scroll-view class="list-container">
            @for (item of timers(); track item.id) {
              @let stats = getTimerStats(item);
              <view class="swipe-wrap">
                <!-- Fondo rojo que queda al descubierto al deslizar -->
                <view class="delete-bg">
                  <text class="delete-text">Delete</text>
                </view>

                <view
                  class="list-item"
                  [style.transform]="'translateX(' + offsetOf(item.id) + 'px)'"
                  (touchStart)="onSwipeStart(item.id, $event)"
                  (touchMove)="onSwipeMove(item.id, $event)"
                  (touchEnd)="onSwipeEnd(item.id)"
                >
                  <view class="item-header">
                    <image class="item-icon" [src]="item.appIcon" />
                    <view class="flex-1">
                      <text class="item-title">{{ item.triggerApp || 'Unnamed Trigger' }}</text>
                      <text class="item-details">
                        every {{ item.originalInterval || 0 }}{{ item.originalUnit }}
                        · +{{ item.addValue }}{{ item.maxValue > 0 ? ' · max ' + item.maxValue : '' }}
                      </text>
                    </view>
                    @if (stats.finished) {
                      <text class="badge">done ✓</text>
                    }
                  </view>

                  <text class="item-timer" [class.item-timer-done]="stats.finished">{{ stats.timeString }}</text>
                  <text class="item-details">
                    {{ stats.intervalsDone }} intervals · {{ stats.totalAdded }} added
                  </text>
                </view>
              </view>
            } @empty {
              <text class="empty-text">No timers added yet.</text>
            }
          </scroll-view>
        </view>
      </safe-area-view>
    </safe-area-provider>
  `,
  styles: `
    :host { flex: 1; }
    .screen { flex: 1; background-color: #f5f5f7; }
    .body { flex: 1; padding: 24px; }
    .title { color: #101014; font-size: 28px; font-weight: 700; }
    .hint { color: #5f5f6b; font-size: 15px; margin-bottom: 20px; }
    .input-group { width: 100%; margin-bottom: 14px; }
    .field-label { color: #5f5f6b; font-size: 14px; margin-bottom: 6px; margin-left: 4px; font-weight: 600; }
    .input-field { border-radius: 12px; background-color: #ffffff; padding: 12px 16px; font-size: 16px; color: #18181b; }

    .interval-row { flex-direction: row; align-items: center; gap: 8px; }
    .flex-1 { flex: 1; }
    .toggle-container { flex-direction: row; background-color: #e4e4e7; border-radius: 10px; padding: 4px; }
    .toggle-btn { padding: 8px 12px; border-radius: 8px; }
    .toggle-active { background-color: #ffffff; }
    .toggle-text { color: #71717a; font-size: 14px; font-weight: 600; }
    .toggle-text-active { color: #18181b; }

    /* Input con icono */
    .input-with-icon { flex-direction: row; align-items: center; gap: 10px; background-color: #ffffff; border-radius: 12px; padding: 6px 16px 6px 10px; }
    .app-icon { width: 32px; height: 32px; border-radius: 8px; }
    .input-inner { flex: 1; padding: 8px 0; font-size: 16px; color: #18181b; }

    /* Sugerencias */
    .chips-row { flex-direction: row; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
    .chip { flex-direction: row; align-items: center; gap: 6px; background-color: #e4e4e7; border-radius: 999px; padding: 4px 12px 4px 4px; }
    .chip-icon { width: 22px; height: 22px; border-radius: 11px; }
    .chip-text { font-size: 13px; font-weight: 600; color: #18181b; }

    .button { align-items: center; margin-top: 8px; padding: 16px; width: 100%; border-radius: 12px; background-color: #3b6ef5; }
    .label { color: #ffffff; font-size: 16px; font-weight: 600; }
    .list-title { margin-top: 24px; margin-bottom: 12px; font-size: 18px; font-weight: 700; color: #101014; }
    .list-container { flex: 1; }
    .swipe-wrap { margin-bottom: 8px; }
    .delete-bg { position: absolute; top: 0; bottom: 0; left: 0; right: 0; background-color: #ef4444; border-radius: 12px; align-items: flex-end; justify-content: center; padding-right: 24px; }
    .delete-text { color: #ffffff; font-weight: 700; font-size: 14px; }
    .list-item { background-color: #ffffff; padding: 16px; border-radius: 12px; }

    .item-header { flex-direction: row; align-items: center; gap: 12px; margin-bottom: 10px; }
    .item-icon { width: 40px; height: 40px; border-radius: 10px; }
    .item-title { font-size: 16px; font-weight: 600; color: #18181b; }
    .item-timer { font-size: 22px; font-weight: 700; color: #3b6ef5; font-variant-numeric: tabular-nums; margin-bottom: 4px; }
    .item-details { font-size: 12px; color: #71717a; }
    .item-timer-done { color: #16a34a; }
    .badge { font-size: 11px; font-weight: 700; color: #16a34a; }
    .empty-text { color: #a1a1aa; text-align: center; margin-top: 16px; }

    @media (prefers-color-scheme: dark) {
      .screen { background-color: #101014; }
      .title, .list-title, .item-title { color: #ffffff; }
      .hint, .field-label, .empty-text, .item-details { color: #8b8b96; }
      .input-field, .list-item, .input-with-icon { background-color: #27272a; color: #ffffff; }
      .input-inner { color: #ffffff; }
      .chip { background-color: #27272a; }
      .chip-text { color: #ffffff; }
      .toggle-container { background-color: #18181b; }
      .toggle-active { background-color: #3f3f46; }
      .toggle-text { color: #a1a1aa; }
      .toggle-text-active { color: #ffffff; }
      .item-timer { color: #60a5fa; }
      .item-timer-done { color: #4ade80; }
    }
  `,
})
export class App {
  protected readonly units = ['ms', 's', 'm', 'h'];
  protected readonly model = signal({ interval: '', unit: 's', add: '', max: '', triggerApp: '' });
  protected readonly timerForm = form(this.model);
  protected readonly timers = signal<TimerItem[]>([]);
  protected readonly now = signal(Date.now());

  protected readonly placeholder = PLACEHOLDER_ICON;

  // Estado del gesto de deslizar
  private static readonly DELETE_THRESHOLD = 120; // px hacia la izquierda para eliminar
  private swipeStartX = 0;
  protected readonly swipeId = signal<string | null>(null);
  protected readonly swipeX = signal(0);

  /** Todas las apps instaladas (ordenadas por nombre). */
  private readonly installedApps = signal<AppInfo[]>([]);

  /** App elegida desde las sugerencias (desambigua apps con el mismo nombre). */
  private readonly picked = signal<AppInfo | null>(null);

  /** Iconos reales (data URI base64) por packageName, cargados bajo demanda. */
  protected readonly icons = signal<Record<string, string>>({});
  private readonly iconsRequested = new Set<string>();

  /** App instalada que coincide exactamente con lo escrito (si existe). */
  protected readonly selectedApp = computed(() => {
    const q = this.model().triggerApp.trim().toLowerCase();
    if (!q) return null;
    const picked = this.picked();
    if (picked && picked.appName.toLowerCase() === q) return picked;
    return this.installedApps().find(a => a.appName.toLowerCase() === q) ?? null;
  });

  /** Icono mostrado dentro del input. */
  protected readonly currentIcon = computed(() => {
    const app = this.selectedApp();
    return (app && this.icons()[app.packageName]) || PLACEHOLDER_ICON;
  });

  /** Sugerencias mientras el usuario escribe (máx. 8, solo si hay texto). */
  protected readonly suggestions = computed(() => {
    const q = this.model().triggerApp.trim().toLowerCase();
    if (!q || this.selectedApp()) return [];
    return this.installedApps()
      .filter(a => a.appName.toLowerCase().includes(q))
      .slice(0, 8);
  });

  constructor() {
    inject(StatusBar).set({ style: 'auto' });
    void this.loadInstalledApps();

    // Carga el icono solo de lo que se muestra (sugerencias + app elegida), no de todas las apps
    effect(() => {
      const visible = [...this.suggestions(), this.selectedApp()];
      for (const app of visible) if (app) void this.ensureIcon(app.packageName);
    });

    const timerId = setInterval(() => {
      this.now.set(Date.now());
      this.checkTriggers();
    }, 50);
    inject(DestroyRef).onDestroy(() => clearInterval(timerId));
  }

  private async loadInstalledApps() {
    try {
      const apps = await getInstalledApps();
      this.installedApps.set([...apps].sort((x, y) => x.appName.localeCompare(y.appName)));
    } catch (error) {
      console.warn('No se pudo obtener la lista de apps instaladas', error);
    }
  }

  private async ensureIcon(packageName: string) {
    if (this.iconsRequested.has(packageName)) return;
    this.iconsRequested.add(packageName);
    try {
      const icon = await getApplicationIconAsync(packageName);
      if (icon) this.icons.update(r => ({ ...r, [packageName]: icon }));
    } catch { /* sin icono: se queda el placeholder */ }
  }

  setUnit(unit: string) {
    this.model.update(c => ({ ...c, unit }));
  }

  pickApp(app: AppInfo) {
    this.picked.set(app);
    this.model.update(c => ({ ...c, triggerApp: app.appName }));
  }

  addToList() {
    const data = this.model();
    const rawInterval = Number(data.interval) || 0;
    if (rawInterval <= 0) return; // un intervalo de 0 no tiene sentido

    const multiplier = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[data.unit] ?? 1;
    const app = this.selectedApp();
    const intervalMs = rawInterval * multiplier;
    const addValue = Number(data.add) || 0;
    const maxValue = Number(data.max) || 0;
    const startTime = Date.now();

    // Cuántos intervalos hacen falta para llegar al máximo → momento exacto de parada
    const endTime = maxValue > 0 && addValue > 0
      ? startTime + Math.ceil(maxValue / addValue) * intervalMs
      : null;

    const newItem: TimerItem = {
      id: Date.now().toString(),
      triggerApp: app?.appName ?? data.triggerApp.trim(),
      appIcon: (app && this.icons()[app.packageName]) || PLACEHOLDER_ICON,
      packageName: app?.packageName ?? null,
      triggered: false,
      endTime,
      intervalMs,
      addValue,
      maxValue,
      startTime,
      originalInterval: data.interval,
      originalUnit: data.unit,
    };

    this.timers.update(list => [newItem, ...list]);
    this.picked.set(null);
    this.model.update(c => ({ ...c, interval: '', add: '', max: '', triggerApp: '' }));
  }

  /** Cuando un timer llega a su fin, abre la app una sola vez. */
  private checkTriggers() {
    const now = this.now();
    const fired = this.timers().filter(i => !i.triggered && i.endTime !== null && now >= i.endTime);
    if (!fired.length) return;

    for (const item of fired) {
      if (item.packageName) {
        try { openApplication(item.packageName); } catch { console.warn(`No se pudo abrir ${item.triggerApp}`); }
      }
    }

    // Solo escribimos la señal cuando algo cambió (no cada 50ms)
    const ids = new Set(fired.map(i => i.id));
    this.timers.update(list => list.map(i => (ids.has(i.id) ? { ...i, triggered: true } : i)));
  }

  // ---------- Swipe para eliminar ----------

  protected offsetOf(id: string) {
    return this.swipeId() === id ? this.swipeX() : 0;
  }

  private pointerX(e: any): number {
    return e?.nativeEvent?.pageX ?? e?.touches?.[0]?.pageX ?? e?.pageX ?? 0;
  }

  protected onSwipeStart(id: string, e: any) {
    this.swipeStartX = this.pointerX(e);
    this.swipeId.set(id);
    this.swipeX.set(0);
  }

  protected onSwipeMove(id: string, e: any) {
    if (this.swipeId() !== id) return;
    // Solo hacia la izquierda (dx negativo)
    this.swipeX.set(Math.min(0, this.pointerX(e) - this.swipeStartX));
  }

  protected onSwipeEnd(id: string) {
    if (this.swipeId() !== id) return;
    if (this.swipeX() <= -App.DELETE_THRESHOLD) {
      this.timers.update(list => list.filter(i => i.id !== id));
    }
    this.swipeId.set(null);
    this.swipeX.set(0);
  }

  getTimerStats(item: TimerItem) {
    // Si el timer ya terminó, el reloj se congela en endTime
    const clock = item.endTime !== null ? Math.min(this.now(), item.endTime) : this.now();
    const elapsedMs = Math.max(0, clock - item.startTime);
    const finished = item.endTime !== null && this.now() >= item.endTime;

    const ms = Math.floor(elapsedMs % 1000).toString().padStart(3, '0');
    const s = Math.floor((elapsedMs / 1000) % 60).toString().padStart(2, '0');
    const m = Math.floor((elapsedMs / 60_000) % 60).toString().padStart(2, '0');
    const h = Math.floor(elapsedMs / 3_600_000).toString().padStart(2, '0');
    const timeString = `${h}:${m}:${s}.${ms}`;

    const intervalsDone = item.intervalMs > 0 ? Math.floor(elapsedMs / item.intervalMs) : 0;

    let totalAdded = intervalsDone * item.addValue;
    if (item.maxValue > 0) totalAdded = Math.min(totalAdded, item.maxValue);

    return { timeString, intervalsDone, totalAdded, finished };
  }
}
