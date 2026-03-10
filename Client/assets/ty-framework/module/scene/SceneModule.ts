import {director, SceneAsset, Asset} from "cc";
import {GameScene, LoginScene, SceneBase, SceneEnum} from "./Scene";
import {Module} from "../Module";

/**
 * 场景切换回调
 * @param fromScene 切换前的场景名称（首次为空字符串）
 * @param toScene   切换后的场景名称
 */
export type SceneTransitionCallback = (fromScene: string, toScene: string) => void;

/**
 * 场景管理模块
 *
 * 负责场景注册、异步加载切换、生命周期管理。
 * 场景的资源释放遵循 Cocos 底层，框架不干预场景 bundle 的释放。
 *
 * @example
 * // 默认注册了 LoginScene 和 GameScene
 * // 也可注册自定义子类覆盖默认行为
 * tyou.scene.registerScene(new MyCustomGameScene(SceneEnum.Game));
 *
 * // 切换场景（传递类型安全的数据）
 * await tyou.scene.loadSceneAsync("login", { from: "splash" });
 *
 * // 过渡回调
 * tyou.scene.onBeforeSwitch = (from, to) => { // 显示 loading };
 * tyou.scene.onAfterSwitch  = (from, to) => { // 隐藏 loading };
 */
export class SceneModule extends Module {
    private _currentScene: SceneBase | null = null;
    private _isSwitching: boolean = false;
    private _sceneCache: Map<string, SceneBase> = new Map();

    /** 场景切换前回调（可用于显示过渡画面） */
    public onBeforeSwitch: SceneTransitionCallback | null = null;
    /** 场景切换后回调（可用于隐藏过渡画面） */
    public onAfterSwitch: SceneTransitionCallback | null = null;

    public onCreate(): void {
        this._isSwitching = false;
        this._sceneCache.set(SceneEnum.Login, new LoginScene(SceneEnum.Login));
        this._sceneCache.set(SceneEnum.Game, new GameScene(SceneEnum.Game));
    }

    public onDestroy(): void {
        this._sceneCache.clear();
        this._currentScene = null;
        this._isSwitching = false;
        this.onBeforeSwitch = null;
        this.onAfterSwitch = null;
    }

    /**
     * 添加自动释放的资源（跟随当前场景生命周期）
     */
    public addAutoReleaseAsset(asset: Asset): void {
        if (this._currentScene) {
            this._currentScene.addAutoReleaseAsset(asset);
        } else {
            this.log("当前没有任何场景 检查资源加载时机");
        }
    }

    /**
     * 异步加载并切换场景
     * @param path 场景名称（需先通过 registerScene 注册）
     * @param data 传递给目标场景的数据
     * @returns 切换是否成功
     */
    public async loadSceneAsync(path: string, data?: any): Promise<boolean> {
        this.log("loadSceneAsync path", path, this._sceneCache.size, this._sceneCache.has(path));

        if (this._isSwitching) {
            this.log("上个场景还在加载中");
            return false;
        }

        if (this._currentScene && this._currentScene.sceneName === path) {
            this.log("加载同样的场景", path);
            return false;
        }

        const newScene = this._sceneCache.get(path);
        if (!newScene) {
            this.error("场景没有注册", path);
            return false;
        }

        this._isSwitching = true;
        const fromName = this._currentScene?.sceneName ?? "";

        try {
            // 过渡前回调
            if (this.onBeforeSwitch) {
                try { this.onBeforeSwitch(fromName, path); } catch (e) {
                    console.error("[SceneModule] onBeforeSwitch error:", e);
                }
            }

            // 离开当前场景
            if (this._currentScene) {
                this._currentScene.onLeave();
            }

            // 加载场景资源
            const asset = await tyou.res.loadAssetAsync(path) as unknown as SceneAsset;
            if (!asset) {
                this.error("场景资源加载失败", path);
                this._isSwitching = false;
                return false;
            }

            // 执行切换
            await new Promise<void>((resolve) => {
                director.runSceneImmediate(asset, null, () => {
                    this.log(`切换场景: ${path}`);
                    newScene.onInit(asset);
                    newScene.onEnter(data);
                    this._currentScene = newScene;
                    resolve();
                });
            });

            this._isSwitching = false;

            // 过渡后回调
            if (this.onAfterSwitch) {
                try { this.onAfterSwitch(fromName, path); } catch (e) {
                    console.error("[SceneModule] onAfterSwitch error:", e);
                }
            }

            return true;
        } catch (e) {
            this.error("场景切换异常", path, e);
            this._isSwitching = false;
            return false;
        }
    }

    /**
     * 获取当前场景
     */
    public getCurrentScene(): SceneBase | null {
        return this._currentScene;
    }

    /**
     * 检查是否正在切换场景
     */
    public isSwitching(): boolean {
        return this._isSwitching;
    }

    /**
     * 注册场景
     */
    public registerScene(scene: SceneBase): void {
        this._sceneCache.set(scene.sceneName, scene);
    }

    /**
     * 取消注册场景
     */
    public unregisterScene(sceneName: string): void {
        this._sceneCache.delete(sceneName);
    }

    /**
     * 获取场景实例
     */
    public getScene(sceneName: string): SceneBase | null {
        return this._sceneCache.get(sceneName) || null;
    }

    /**
     * 获取所有已注册的场景名称
     */
    public getAllSceneNames(): string[] {
        return Array.from(this._sceneCache.keys());
    }
}