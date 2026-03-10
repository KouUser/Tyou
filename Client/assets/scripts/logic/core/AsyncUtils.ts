// 文件：Core/AsyncUtils.ts
/**
 * 高性能、可取消的异步等待工具类
 */
export class AsyncUtils {
    private static _instance: AsyncUtils | null = null;

    // 私有构造函数，确保单例
    private constructor() {}

    /**
     * 获取单例实例
     */
    public static get Instance(): AsyncUtils {
        if (!this._instance) {
            this._instance = new AsyncUtils();
        }
        return this._instance;
    }

    /**
     * 等待指定秒数（可取消）
     * @param seconds 等待秒数
     * @param token 取消令牌（可选）
     */
    public async waitSeconds(
        seconds: number,
        token?: CancellationToken
    ): Promise<void> {
        return this.waitMs(seconds * 1000, token);
    }

    /**
     * 等待指定毫秒数（可取消）
     * @param ms 等待毫秒数
     * @param token 取消令牌（可选）
     */
    public async waitMs(ms: number, token?: CancellationToken): Promise<void> {
        if (token?.isCancelled) {
            throw new AsyncCancelledError("等待被取消");
        }

        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                cleanup();
                resolve();
            }, ms);

            const cleanup = () => {
                clearTimeout(timeoutId);
                if (token) {
                    token.off("cancelled", onCancelled);
                }
            };

            const onCancelled = () => {
                cleanup();
                reject(new AsyncCancelledError("等待被取消"));
            };

            if (token) {
                if (token.isCancelled) {
                    cleanup();
                    reject(new AsyncCancelledError("等待被取消"));
                    return;
                }
                token.on("cancelled", onCancelled);
            }
        });
    }

    /**
     * 等待下一帧（可取消）
     * @param token 取消令牌（可选）
     */
    public async waitNextFrame(token?: CancellationToken): Promise<void> {
        if (token?.isCancelled) {
            throw new AsyncCancelledError("等待被取消");
        }

        return new Promise((resolve, reject) => {
            const frameId = requestAnimationFrame(() => {
                cleanup();
                resolve();
            });

            const cleanup = () => {
                cancelAnimationFrame(frameId);
                if (token) {
                    token.off("cancelled", onCancelled);
                }
            };

            const onCancelled = () => {
                cleanup();
                reject(new AsyncCancelledError("等待被取消"));
            };

            if (token) {
                if (token.isCancelled) {
                    cleanup();
                    reject(new AsyncCancelledError("等待被取消"));
                    return;
                }
                token.on("cancelled", onCancelled);
            }
        });
    }

    /**
     * 等待多帧（可取消）
     * @param frameCount 帧数
     * @param token 取消令牌（可选）
     */
    public async waitFrames(frameCount: number, token?: CancellationToken): Promise<void> {
        for (let i = 0; i < frameCount; i++) {
            await this.waitNextFrame(token);
        }
    }

    /**
     * 等待条件满足（可取消，高性能事件驱动）
     * @param condition 条件函数
     * @param token 取消令牌（可选）
     * @param checkInterval 检查间隔（毫秒，默认16ms）
     */
    public async waitUntil(
        condition: () => boolean,
        token?: CancellationToken,
        checkInterval: number = 16
    ): Promise<void> {
        if (token?.isCancelled) {
            throw new AsyncCancelledError("等待被取消");
        }

        // 立即检查一次
        if (condition()) {
            return;
        }

        return new Promise((resolve, reject) => {
            let intervalId: ReturnType<typeof setInterval> | null = null;
            let frameId: number | null = null;

            const check = () => {
                if (condition()) {
                    cleanup();
                    resolve();
                }
            };

            const cleanup = () => {
                if (intervalId !== null) {
                    clearInterval(intervalId);
                    intervalId = null;
                }
                if (frameId !== null) {
                    cancelAnimationFrame(frameId);
                    frameId = null;
                }
                if (token) {
                    token.off("cancelled", onCancelled);
                }
            };

            const onCancelled = () => {
                cleanup();
                reject(new AsyncCancelledError("等待被取消"));
            };

            // 使用 requestAnimationFrame 在下一帧检查
            const startChecking = () => {
                // 使用双重检查：raf + interval
                const checkOnFrame = () => {
                    if (condition()) {
                        cleanup();
                        resolve();
                        return;
                    }
                    frameId = requestAnimationFrame(checkOnFrame);
                };

                frameId = requestAnimationFrame(checkOnFrame);

                // 同时使用 interval 作为备份
                intervalId = setInterval(() => {
                    if (condition()) {
                        cleanup();
                        resolve();
                    }
                }, checkInterval);
            };

            if (token) {
                if (token.isCancelled) {
                    cleanup();
                    reject(new AsyncCancelledError("等待被取消"));
                    return;
                }
                token.on("cancelled", onCancelled);
            }

            // 等待下一帧开始检查
            requestAnimationFrame(startChecking);
        });
    }

    /**
     * 等待事件（可取消）
     * @param target 事件目标
     * @param eventName 事件名称
     * @param token 取消令牌（可选）
     */
    public async waitEvent<T = any>(
        target: EventTarget,
        eventName: string,
        token?: CancellationToken
    ): Promise<T> {
        if (token?.isCancelled) {
            throw new AsyncCancelledError("等待被取消");
        }

        return new Promise((resolve, reject) => {
            const onEvent = (event: any) => {
                cleanup();
                resolve(event);
            };

            const cleanup = () => {
                target.removeEventListener(eventName, onEvent);
                if (token) {
                    token.off("cancelled", onCancelled);
                }
            };

            const onCancelled = () => {
                cleanup();
                reject(new AsyncCancelledError("等待被取消"));
            };

            target.addEventListener(eventName, onEvent, { once: true });

            if (token) {
                if (token.isCancelled) {
                    cleanup();
                    reject(new AsyncCancelledError("等待被取消"));
                    return;
                }
                token.on("cancelled", onCancelled);
            }
        });
    }

    /**
     * 创建延迟执行（可取消）
     * @param callback 回调函数
     * @param delayMs 延迟毫秒数
     * @param token 取消令牌（可选）
     */
    public async delay<T>(
        callback: () => T | Promise<T>,
        delayMs: number,
        token?: CancellationToken
    ): Promise<T> {
        await this.waitMs(delayMs, token);
        return callback();
    }

    /**
     * 并行等待多个任务，任一完成即返回
     * @param tasks 任务数组
     * @param token 取消令牌（可选）
     */
    public async race<T>(
        tasks: Array<Promise<T>>,
        token?: CancellationToken
    ): Promise<T> {
        if (token?.isCancelled) {
            throw new AsyncCancelledError("等待被取消");
        }

        return new Promise(async (resolve, reject) => {
            let isFinished = false;

            const cleanup = () => {
                isFinished = true;
                if (token) {
                    token.off("cancelled", onCancelled);
                }
            };

            const onCancelled = () => {
                cleanup();
                reject(new AsyncCancelledError("等待被取消"));
            };

            if (token) {
                if (token.isCancelled) {
                    cleanup();
                    reject(new AsyncCancelledError("等待被取消"));
                    return;
                }
                token.on("cancelled", onCancelled);
            }

            try {
                const result = await Promise.race(tasks);
                if (!isFinished) {
                    cleanup();
                    resolve(result);
                }
            } catch (error) {
                if (!isFinished) {
                    cleanup();
                    reject(error);
                }
            }
        });
    }

    /**
     * 并行等待多个任务，全部完成
     * @param tasks 任务数组
     * @param token 取消令牌（可选）
     */
    public async all<T>(
        tasks: Array<Promise<T>>,
        token?: CancellationToken
    ): Promise<T[]> {
        if (token?.isCancelled) {
            throw new AsyncCancelledError("等待被取消");
        }

        return new Promise(async (resolve, reject) => {
            let isFinished = false;

            const cleanup = () => {
                isFinished = true;
                if (token) {
                    token.off("cancelled", onCancelled);
                }
            };

            const onCancelled = () => {
                cleanup();
                reject(new AsyncCancelledError("等待被取消"));
            };

            if (token) {
                if (token.isCancelled) {
                    cleanup();
                    reject(new AsyncCancelledError("等待被取消"));
                    return;
                }
                token.on("cancelled", onCancelled);
            }

            try {
                const result = await Promise.all(tasks);
                if (!isFinished) {
                    cleanup();
                    resolve(result);
                }
            } catch (error) {
                if (!isFinished) {
                    cleanup();
                    reject(error);
                }
            }
        });
    }
}

/**
 * 取消令牌类
 */
export class CancellationToken {
    private _isCancelled: boolean = false;
    private _listeners: Array<() => void> = [];

    /**
     * 取消
     */
    public cancel(): void {
        if (this._isCancelled) return;

        this._isCancelled = true;
        const listeners = this._listeners.slice();
        this._listeners.length = 0;

        for (const listener of listeners) {
            try {
                listener();
            } catch (error) {
                console.error("CancellationToken listener error:", error);
            }
        }
    }

    /**
     * 注册取消回调
     */
    public on(event: "cancelled", callback: () => void): void {
        if (event !== "cancelled") return;

        if (this._isCancelled) {
            callback();
            return;
        }

        this._listeners.push(callback);
    }

    /**
     * 移除取消回调
     */
    public off(event: "cancelled", callback: () => void): void {
        if (event !== "cancelled") return;

        const index = this._listeners.indexOf(callback);
        if (index !== -1) {
            this._listeners.splice(index, 1);
        }
    }

    /**
     * 是否已取消
     */
    public get isCancelled(): boolean {
        return this._isCancelled;
    }

    /**
     * 创建链接令牌（任一取消即取消）
     */
    public static link(...tokens: CancellationToken[]): CancellationToken {
        const linkedToken = new CancellationToken();

        const checkCancelled = () => {
            for (const token of tokens) {
                if (token.isCancelled) {
                    linkedToken.cancel();
                    return;
                }
            }
        };

        for (const token of tokens) {
            token.on("cancelled", checkCancelled);
        }

        checkCancelled();

        return linkedToken;
    }
}

/**
 * 异步取消错误
 */
export class AsyncCancelledError extends Error {
    constructor(message: string = "操作被取消") {
        super(message);
        this.name = "AsyncCancelledError";
    }
}

/**
 * 快捷方式导出
 */
export const asyncUtils = AsyncUtils.Instance;

// 全局快捷方式（可选）
declare global {
    var Unitask:AsyncUtils;
}


(function () {
    globalThis.Unitask = AsyncUtils.Instance;
})();

