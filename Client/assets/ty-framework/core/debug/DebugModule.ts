import {director, Node, Label, UITransform, Widget, Color, Layers, game, Size, Font} from "cc";

/**
 * 调试/性能监控模块
 *
 * 提供运行时性能数据采集与可视化面板。默认关闭，零开销。
 * 通过 tyou.debug.enable() / disable() / toggle() 统一控制开关。
 *
 * 采集指标：FPS、计时器数、事件数、UI 窗口数、ECS 实体数、
 * 对象池状态、待释放资源数、内存使用（如平台支持）。
 *
 * 面板纯代码构建，不依赖预制体，挂载在最高层级。
 *
 * @example
 * tyou.debug.enable();   // 开启
 * tyou.debug.disable();  // 关闭
 * tyou.debug.toggle();   // 切换
 */
export class DebugModule {
    private _enabled: boolean = false;
    private _panelNode: Node | null = null;
    private _label: Label | null = null;

    // FPS 统计
    private _frameCount: number = 0;
    private _fpsAccumulator: number = 0;
    private _currentFps: number = 0;

    // 刷新间隔
    private _refreshInterval: number = 0.5;
    private _refreshTimer: number = 0;

    public get isEnabled(): boolean {
        return this._enabled;
    }

    /**
     * 开启调试面板
     */
    public enable(): void {
        if (this._enabled) return;
        this._enabled = true;
        this._createPanel();
    }

    /**
     * 关闭调试面板
     */
    public disable(): void {
        if (!this._enabled) return;
        this._enabled = false;
        this._destroyPanel();
    }

    /**
     * 切换开关
     */
    public toggle(): void {
        if (this._enabled) {
            this.disable();
        } else {
            this.enable();
        }
    }

    /**
     * 每帧更新（由 Tyou.onUpdate 调用）
     */
    public onUpdate(dt: number): void {
        if (!this._enabled) return;

        // FPS 统计
        this._frameCount++;
        this._fpsAccumulator += dt;

        // 定时刷新面板
        this._refreshTimer += dt;
        if (this._refreshTimer >= this._refreshInterval) {
            this._currentFps = Math.round(this._frameCount / this._fpsAccumulator);
            this._frameCount = 0;
            this._fpsAccumulator = 0;
            this._refreshTimer = 0;
            this._refreshPanel();
        }
    }

    public onDestroy(): void {
        this._destroyPanel();
        this._enabled = false;
    }

    // ─── 面板创建/销毁 ─────────────────────────────

    private _createPanel(): void {
        if (this._panelNode) return;

        const canvas = director.getScene()?.getChildByName("Canvas")
            || director.getScene()?.getChildByName("UICanvas");
        if (!canvas) {
            console.warn("[DebugModule] No Canvas found, cannot create debug panel");
            return;
        }

        // 根节点
        const panel = new Node("__DebugPanel__");
        panel.layer = Layers.Enum.UI_2D;
        canvas.addChild(panel);

        // 设置最高层级
        panel.setSiblingIndex(9999);

        // UITransform
        const uiTransform = panel.addComponent(UITransform);
        uiTransform.setContentSize(new Size(320, 230));
        uiTransform.setAnchorPoint(0, 1);

        // Widget 固定在左上角
        const widget = panel.addComponent(Widget);
        widget.isAlignLeft = true;
        widget.isAlignTop = true;
        widget.left = 5;
        widget.top = 5;

        // Label
        const label = panel.addComponent(Label);
        label.fontSize = 16;
        label.lineHeight = 20;
        label.color = new Color(0, 255, 0, 220);
        label.horizontalAlign = Label.HorizontalAlign.LEFT;
        label.verticalAlign = Label.VerticalAlign.TOP;
        label.overflow = Label.Overflow.NONE;
        label.cacheMode = Label.CacheMode.CHAR;
        label.string = "Debug Panel Loading...";
        label.useSystemFont = true;

        this._panelNode = panel;
        this._label = label;
    }

    private _destroyPanel(): void {
        if (this._panelNode) {
            this._panelNode.destroy();
            this._panelNode = null;
            this._label = null;
        }
    }

    // ─── 数据刷新 ─────────────────────────────────

    private _refreshPanel(): void {
        if (!this._label) return;

        const lines: string[] = [];

        // FPS
        lines.push(`FPS: ${this._currentFps}`);

        // 内存（如平台支持）
        const mem = this._getMemoryInfo();
        if (mem) {
            lines.push(`MEM: ${mem.used}MB / ${mem.limit}MB`);
        }

        // Timer
        try {
            lines.push(`Timer: ${tyou.timer.getTimerCount()}`);
        } catch (_) { }

        // Event
        try {
            lines.push(`Event: ${tyou.event.getEventTypeCount()} types, ${tyou.event.getTotalListenerCount()} listeners`);
        } catch (_) { }

        // UI
        try {
            const topWnd = tyou.ui.getTopWindow();
            lines.push(`UI: ${tyou.ui.getWindowCount()} windows (top: ${topWnd || 'none'})`);
        } catch (_) { }

        // ECS
        try {
            const ecs = (globalThis as any).ecs;
            if (ecs?.activeEntityCount) {
                lines.push(`ECS: ${ecs.activeEntityCount()} entities`);
            }
        } catch (_) { }

        // Pool
        try {
            const poolStats = tyou.pool.getAllNodePoolStatus();
            if (poolStats.length > 0) {
                let totalAvail = 0, totalActive = 0;
                for (const ps of poolStats) {
                    totalAvail += ps.status.availableCount || 0;
                    totalActive += ps.status.activeCount || 0;
                }
                lines.push(`Pool: ${poolStats.length} pools (avail: ${totalAvail}, active: ${totalActive})`);
            } else {
                lines.push(`Pool: 0 pools`);
            }
        } catch (_) { }

        // Resource pending release
        try {
            lines.push(`Res Pending: ${tyou.res.getPendingReleaseCount()}`);
        } catch (_) { }

        // DrawCall
        try {
            const root = (director as any).root;
            if (root?.device) {
                const stats = root.pipeline?.stats || root.device?.stats;
                if (stats?.drawCall !== undefined) {
                    lines.push(`DrawCall: ${stats.drawCall}`);
                }
            }
        } catch (_) { }

        this._label.string = lines.join('\n');
    }

    private _getMemoryInfo(): { used: number; limit: number } | null {
        try {
            const perf = (globalThis as any).performance;
            if (perf?.memory) {
                return {
                    used: Math.round(perf.memory.usedJSHeapSize / 1048576),
                    limit: Math.round(perf.memory.jsHeapSizeLimit / 1048576),
                };
            }
        } catch (_) { }
        return null;
    }
}
