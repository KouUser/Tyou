'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 从 .meta 文件中解析 SpriteFrame 的子资源 UUID
 */
function getSpriteFrameUuidFromMeta(metaPath) {
    try {
        if (!fs.existsSync(metaPath)) return null;
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        if (!meta.subMetas) return null;
        for (const key in meta.subMetas) {
            const sub = meta.subMetas[key];
            if (sub.importer === 'sprite-frame' && sub.uuid) {
                return sub.uuid;
            }
        }
    } catch (e) {
        console.warn('[PSD2CCC] 读取 meta 失败:', metaPath, e.message);
    }
    return null;
}

/**
 * 扫描 atlas 目录，建立 { relativePath → spriteFrameUuid } 映射
 */
function resolveSpriteFrameUuids(atlasPath) {
    const spriteMap = {};
    const dirPath = path.join(Editor.Project.path, 'assets', atlasPath);

    if (!fs.existsSync(dirPath)) {
        console.warn('[PSD2CCC] atlas 目录不存在:', dirPath);
        return spriteMap;
    }

    const files = fs.readdirSync(dirPath);
    for (const file of files) {
        if (!file.endsWith('.png')) continue;
        const baseName = file.replace(/\.png$/i, '');
        const metaPath = path.join(dirPath, file + '.meta');
        const uuid = getSpriteFrameUuidFromMeta(metaPath);
        if (uuid) {
            spriteMap[baseName] = uuid;
        }
    }

    console.log('[PSD2CCC] 解析到精灵帧:', Object.keys(spriteMap).length);
    return spriteMap;
}

/**
 * 从 JSON 文件生成 UI 节点树
 */
async function buildUIFromJSON(jsonFilePath) {
    try {
        // 1. 读取 JSON
        const jsonStr = fs.readFileSync(jsonFilePath, 'utf8');
        let data;
        try {
            data = JSON.parse(jsonStr);
        } catch (parseErr) {
            await Editor.Dialog.info('错误', {
                title: 'JSON 解析失败',
                detail: parseErr.message,
                buttons: ['确定'],
            });
            return;
        }

        if (!data.children || data.children.length === 0) {
            await Editor.Dialog.info('提示', {
                title: '空结构',
                detail: 'JSON 中没有可生成的节点',
                buttons: ['确定'],
            });
            return;
        }

        // 2. 解析精灵帧 UUID
        const atlasPath = data.atlasPath || '';
        const spriteMap = atlasPath ? resolveSpriteFrameUuids(atlasPath) : {};

        // 检查资源是否已导入完成
        const dirPath = path.join(Editor.Project.path, 'assets', atlasPath);
        if (atlasPath && fs.existsSync(dirPath)) {
            const pngFiles = fs.readdirSync(dirPath).filter(f => f.endsWith('.png'));
            if (Object.keys(spriteMap).length === 0 && pngFiles.length > 0) {
                await Editor.Dialog.warn('警告', {
                    detail: '发现 ' + pngFiles.length + ' 个 PNG 但无法解析精灵帧，请等待 Cocos 资源导入完成后重试',
                    buttons: ['确定'],
                });
                return;
            }
        }

        // 3. 构建 UI 名称
        const psdName = data.psdName || path.basename(jsonFilePath, '.json').replace(/-structure$/, '');
        const uiNodeName = psdName + 'UI';

        // 4. 调用场景脚本：自动查找 Canvas 并创建节点
        const buildResult = await Editor.Message.request('scene', 'execute-scene-script', {
            name: 'psd2ccc',
            method: 'buildNodes',
            args: [uiNodeName, JSON.stringify(data), JSON.stringify(spriteMap)],
        });

        console.log('[PSD2CCC] 构建结果:', buildResult);

        await Editor.Dialog.info('成功', {
            title: 'PSD → UI 生成完成',
            detail: `已在 Canvas 下创建 "${uiNodeName}" 节点\n共 ${buildResult && buildResult.count || '?'} 个子节点`,
            buttons: ['确定'],
        });
    } catch (e) {
        console.error('[PSD2CCC] 生成UI失败:', e);
        await Editor.Dialog.info('错误', {
            title: '生成失败',
            detail: e.message || String(e),
            buttons: ['确定'],
        });
    }
}

module.exports = {
    /**
     * Assets 面板右键菜单回调
     * 仅对 JSON 文件显示"PSD生成UI"选项
     */
    onAssetMenu(assetInfo) {
        // 过滤：只对 .json 文件显示菜单，且文件名含 -structure
        const isJsonFile = !assetInfo.isDirectory && assetInfo.name && assetInfo.name.endsWith('.json');
        const isStructure = isJsonFile && assetInfo.name.indexOf('-structure') >= 0;

        return [
            {
                label: '📐 PSD生成UI',
                enabled: isStructure,
                visible: isJsonFile,
                async click() {
                    await buildUIFromJSON(assetInfo.file);
                },
            },
        ];
    },
};
