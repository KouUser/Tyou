import {Module} from "../Module";

/**
 * 状态机状态接口
 */
export interface IFSMState<T> {
    type: T;
    isEntered: boolean;

    /**
     * 状态进入
     * @param previousState 上一个状态
     * @param data 进入数据
     */
    onEnter(previousState: T | null, data?: any): Promise<void>;

    /**
     * 状态退出
     * @param nextState 下一个状态
     */
    onExit(nextState: T): Promise<void>;

    /**
     * 状态更新
     * @param dt 帧时间
     */
    onUpdate(dt: number): void;
}

/**
 * 有限状态机类
 */
export class FSM<T extends string | number> {
    // 状态存储
    private _states: Map<T, IFSMState<T>> = new Map();
    private _currentState: T | null = null;
    private _previousState: T | null = null;
    private _id: string;
    private _owner: any;
    private _isActive: boolean = true;

    constructor(id: string, owner: any) {
        this._id = id;
        this._owner = owner;
    }

    /**
     * 注册状态
     */
    public registerState(key: T, state: IFSMState<T>): void {
        if (this._states.has(key)) {
            console.warn(`[FSM:${this._id}] 状态 ${key} 已注册，将被覆盖`);
        }
        state.type = key;
        this._states.set(key, state);
    }

    /**
     * 批量注册状态
     */
    public registerStates(states: Map<T, IFSMState<T>>): void {
        states.forEach((state, key) => {
            state.type = key;
            this.registerState(key, state);
        });
    }


    public getCurrStateObj(): IFSMState<T> {
        if (this._currentState !== null) {
            return this._states.get(this._currentState);
        }
        return null;
    }

    /** waitUntil 超时时间（秒），默认 10 秒。设为 0 表示不限时 */
    public waitUntilTimeout: number = 10;

    // 超时等待内部状态
    private _waitResolve: ((value: boolean) => void) | null = null;
    private _waitCondition: (() => boolean) | null = null;
    private _waitElapsed: number = 0;
    private _waitTimeout: number = 0;
    private _waitDesc: string = '';

    /**
     * 切换状态
     */
    public async changeState(newState: T, data?: any): Promise<boolean> {
        if (!this._isActive) {
            console.warn(`[FSM:${this._id}] 状态机未激活，无法切换状态`);
            return false;
        }

        if (!this._states.has(newState)) {
            console.error(`[FSM:${this._id}] 未注册的状态: ${newState}`);
            return false;
        }

        // 退出当前状态
        if (this._currentState !== null) {
            const currentStateObj = this._states.get(this._currentState);
            if (currentStateObj) {
                //这里有可能多地方调用导致 异部enter还没执行完
                const entered = await this._waitUntilWithTimeout(
                    () => currentStateObj.isEntered,
                    this.waitUntilTimeout,
                    `等待状态 ${this._currentState} onEnter 完成`
                );
                if (!entered) {
                    console.error(`[FSM:${this._id}] 等待状态 ${this._currentState} onEnter 超时(${this.waitUntilTimeout}s)，强制切换到 ${newState}`);
                }
                await currentStateObj.onExit(newState);
            }
            this._previousState = this._currentState;
        }
        //先赋值 要不然会出现空白期
        this._currentState = newState;
        // 进入新状态
        const newStateObj = this._states.get(newState)!;
        await newStateObj.onEnter(this._previousState, data);
       // console.log(`[FSM:${this._id}] 状态切换: ${this._previousState} -> ${newState}`);
        return true;
    }

    /**
     * 带超时的条件等待，基于帧驱动计时（不依赖 setTimeout/requestAnimationFrame）
     * 超时返回 false 而不是永久阻塞
     */
    private _waitUntilWithTimeout(condition: () => boolean, timeout: number, desc?: string): Promise<boolean> {
        if (condition()) return Promise.resolve(true);
        if (timeout <= 0) {
            return Unitask.waitUntil(condition).then(() => true);
        }
        return new Promise<boolean>((resolve) => {
            this._waitResolve = resolve;
            this._waitCondition = condition;
            this._waitElapsed = 0;
            this._waitTimeout = timeout;
            this._waitDesc = desc || '';
        });
    }

    /**
     * 驱动超时等待检查（由 update 每帧调用）
     */
    private _tickWait(dt: number): void {
        if (!this._waitResolve) return;

        if (this._waitCondition!()) {
            const resolve = this._waitResolve;
            this._clearWait();
            resolve(true);
            return;
        }

        this._waitElapsed += dt;
        if (this._waitElapsed >= this._waitTimeout) {
            console.warn(`[FSM:${this._id}] waitUntil 超时: ${this._waitDesc}`);
            const resolve = this._waitResolve;
            this._clearWait();
            resolve(false);
        }
    }

    private _clearWait(): void {
        this._waitResolve = null;
        this._waitCondition = null;
        this._waitElapsed = 0;
        this._waitTimeout = 0;
        this._waitDesc = '';
    }

    /**
     * 更新当前状态
     */
    public update(dt: number): void {
        // 驱动超时等待检查
        this._tickWait(dt);

        if (!this._isActive || this._currentState === null) {
            return;
        }

        const currentStateObj = this._states.get(this._currentState);
        if (currentStateObj) {
            currentStateObj.onUpdate(dt);
        }
    }

    /**
     * 获取当前状态
     */
    public getCurrentState(): T | null {
        return this._currentState;
    }

    /**
     * 获取上一个状态
     */
    public getPreviousState(): T | null {
        return this._previousState;
    }

    /**
     * 检查是否在指定状态
     */
    public isInState(state: T): boolean {
        return this._currentState === state;
    }

    /**
     * 重置状态机
     */
    public reset(initialState?: T): void {
        if (this._currentState !== null) {
            const currentStateObj = this._states.get(this._currentState);
            if (currentStateObj) {
                currentStateObj.onExit(this._currentState);
            }
        }

        this._currentState = null;
        this._previousState = null;

        if (initialState !== undefined && this._states.has(initialState)) {
            const stateObj = this._states.get(initialState)!;
            stateObj.onEnter(null);
            this._currentState = initialState;
        }
    }

    /**
     * 销毁状态机
     */
    public destroy(): void {
        // 取消等待中的超时
        if (this._waitResolve) {
            const resolve = this._waitResolve;
            this._clearWait();
            resolve(false);
        }

        if (this._currentState !== null) {
            const currentStateObj = this._states.get(this._currentState);
            if (currentStateObj) {
                currentStateObj.onExit(this._currentState);
            }
        }

        this._states.clear();
        this._currentState = null;
        this._previousState = null;
        this._isActive = false;

        console.log(`[FSM:${this._id}] 状态机已销毁`);
    }

    /**
     * 设置激活状态
     */
    public setActive(active: boolean): void {
        this._isActive = active;
    }

    /**
     * 检查是否激活
     */
    public isActive(): boolean {
        return this._isActive;
    }

    /**
     * 获取状态机ID
     */
    public getId(): string {
        return this._id;
    }

    /**
     * 获取所有者
     */
    public getOwner(): any {
        return this._owner;
    }

    /**
     * 获取所有注册的状态
     */
    public getAllStates(): T[] {
        return Array.from(this._states.keys());
    }

    /**
     * 获取状态机信息
     */
    public getInfo(): {
        id: string;
        ownerType: string;
        currentState: T | null;
        previousState: T | null;
        isActive: boolean;
        stateCount: number;
    } {
        return {
            id: this._id,
            ownerType: this._owner?.constructor?.name || typeof this._owner,
            currentState: this._currentState,
            previousState: this._previousState,
            isActive: this._isActive,
            stateCount: this._states.size
        };
    }
}

/**
 * 有限状态机模块
 */
export class FSMModule extends Module {
    // 状态机存储
    private _fsms: Map<string, FSM<any>> = new Map();
    private _nextFsmId: number = 0;

    /**
     * 创建状态机
     * @param owner 所有者（通常传入this）
     * @returns 状态机实例和ID
     */
    public createFSM<T extends string | number>(owner: any): FSM<T> {
        const fsmId = `fsm_${++this._nextFsmId}`;
        const fsm = new FSM<T>(fsmId, owner);

        this._fsms.set(fsmId, fsm);

        console.log(`[FSMModule] 创建状态机: ${fsmId}, 所有者: ${owner?.constructor?.name || typeof owner}`);
        return fsm;
    }

    /**
     * 通过ID获取状态机
     * @param fsmId 状态机ID
     */
    public getFSM<T extends string | number>(fsmId: string): FSM<T> | null {
        return this._fsms.get(fsmId) as FSM<T> || null;
    }

    /**
     * 通过ID销毁状态机
     */
    public destroyFSM<T extends string | number>(fsm: FSM<T>): boolean {
        const fsmId = fsm.getId();
        if (this._fsms.has(fsmId)) {
            fsm.destroy();
            this._fsms.delete(fsmId);

            console.log(`[FSMModule] 销毁状态机: ${fsmId}`);
            return true;
        }

        console.warn(`[FSMModule] 未找到状态机: ${fsmId}`);
        return false;
    }

    /**
     * 销毁指定所有者的所有状态机
     * @param owner 所有者
     */
    public destroyAllFSMByOwner(owner: any): number {
        let destroyedCount = 0;
        const ownerName = owner?.constructor?.name || typeof owner;

        for (const [fsmId, fsm] of this._fsms) {
            if (fsm.getOwner() === owner) {
                fsm.destroy();
                this._fsms.delete(fsmId);
                destroyedCount++;
            }
        }

        if (destroyedCount > 0) {
            console.log(`[FSMModule] 销毁所有者 ${ownerName} 的所有状态机，共 ${destroyedCount} 个`);
        }

        return destroyedCount;
    }

    /**
     * 重置指定状态机
     * @param fsmId 状态机ID
     * @param initialState 初始状态（可选）
     */
    public resetFSM(fsmId: string, initialState?: any): boolean {
        const fsm = this._fsms.get(fsmId);

        if (fsm) {
            fsm.reset(initialState);
            console.log(`[FSMModule] 重置状态机: ${fsmId}`);
            return true;
        }

        return false;
    }

    /**
     * 切换状态机的激活状态
     * @param fsmId 状态机ID
     * @param active 是否激活
     */
    public setFSMActive(fsmId: string, active: boolean): boolean {
        const fsm = this._fsms.get(fsmId);

        if (fsm) {
            fsm.setActive(active);
            return true;
        }

        return false;
    }

    /**
     * 更新所有状态机
     */
    public onUpdate(dt: number): void {
        this._fsms.forEach(fsm => {
            if (fsm.isActive()) {
                fsm.update(dt);
            }
        });
    }

    /**
     * 初始化模块
     */
    public onCreate(): void {
        console.log("[FSMModule] 状态机模块初始化");
    }

    /**
     * 销毁模块
     */
    public onDestroy(): void {
        // 销毁所有状态机
        let destroyedCount = 0;

        this._fsms.forEach((fsm, fsmId) => {
            fsm.destroy();
            destroyedCount++;
        });

        this._fsms.clear();
        this._nextFsmId = 0;

        console.log(`[FSMModule] 模块销毁，共销毁 ${destroyedCount} 个状态机`);
    }

    /**
     * 获取所有状态机信息
     */
    public getAllFSMInfo(): Array<{
        id: string;
        ownerType: string;
        currentState: any;
        previousState: any;
        isActive: boolean;
        stateCount: number;
    }> {
        const result: Array<{
            id: string;
            ownerType: string;
            currentState: any;
            previousState: any;
            isActive: boolean;
            stateCount: number;
        }> = [];

        this._fsms.forEach(fsm => {
            const info = fsm.getInfo();
            result.push(info);
        });

        return result;
    }

    /**
     * 获取状态机统计信息
     */
    public getStats(): {
        totalFsmCount: number;
        activeFsmCount: number;
        inactiveFsmCount: number;
    } {
        let activeCount = 0;
        this._fsms.forEach(fsm => {
            if (fsm.isActive()) {
                activeCount++;
            }
        });

        const totalCount = this._fsms.size;

        return {
            totalFsmCount: totalCount,
            activeFsmCount: activeCount,
            inactiveFsmCount: totalCount - activeCount
        };
    }
}

/*

export class StateMachineWrapper<T extends string | number> {
    private _fsmId: string;
    private _fsmModule: FSMModule;

    constructor(fsmModule: FSMModule, owner: any) {
        const {id, fsm} = fsmModule.createFSM<T>(owner);
        this._fsmId = id;
        this._fsmModule = fsmModule;
    }

    /!**
     * 注册状态
     *!/
    public registerState(key: T, state: IFSMState<T>): void {
        const fsm = this._fsmModule.getFSM<T>(this._fsmId);
        if (fsm) {
            fsm.registerState(key, state);
        }
    }

    /!**
     * 切换状态
     *!/
    public changeState(newState: T, data?: any): boolean {
        const fsm = this._fsmModule.getFSM<T>(this._fsmId);
        if (fsm) {
            return fsm.changeState(newState, data);
        }
        return false;
    }

    /!**
     * 获取当前状态
     *!/
    public getCurrentState(): T | null {
        const fsm = this._fsmModule.getFSM<T>(this._fsmId);
        return fsm ? fsm.getCurrentState() : null;
    }

    /!**
     * 获取上一个状态
     *!/
    public getPreviousState(): T | null {
        const fsm = this._fsmModule.getFSM<T>(this._fsmId);
        return fsm ? fsm.getPreviousState() : null;
    }

    /!**
     * 检查是否在指定状态
     *!/
    public isInState(state: T): boolean {
        const fsm = this._fsmModule.getFSM<T>(this._fsmId);
        return fsm ? fsm.isInState(state) : false;
    }

    /!**
     * 重置状态机
     *!/
    public reset(initialState?: T): void {
        const fsm = this._fsmModule.getFSM<T>(this._fsmId);
        if (fsm) {
            fsm.reset(initialState);
        }
    }

    /!**
     * 设置激活状态
     *!/
    public setActive(active: boolean): void {
        this._fsmModule.setFSMActive(this._fsmId, active);
    }

    /!**
     * 检查是否激活
     *!/
    public isActive(): boolean {
        const fsm = this._fsmModule.getFSM<T>(this._fsmId);
        return fsm ? fsm.isActive() : false;
    }

    /!**
     * 销毁状态机
     *!/
    public destroy(): void {
        this._fsmModule.destroyFSM(this._fsmId);
    }

    /!**
     * 获取状态机ID
     *!/
    public getId(): string {
        return this._fsmId;
    }

    /!**
     * 获取状态机信息
     *!/
    public getInfo(): any {
        const fsm = this._fsmModule.getFSM<T>(this._fsmId);
        return fsm ? fsm.getInfo() : null;
    }
}*/
