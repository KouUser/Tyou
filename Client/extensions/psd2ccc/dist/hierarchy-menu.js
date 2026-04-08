'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 从 .meta 文件中解析 SpriteFrame 的子资源 UUID
 * Cocos Creator 3.x 的 PNG 导入后会在 subMetas 生成 sprite-frame 子资源
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
 * 从 PSD JSON 生成 UI 节点树
 */
async function buildUIFromPSD(nodeInfo) {
    try {
        // 提取右键目标节点的 UUID
        var targetNodeUuid = null;
        if (nodeInfo && typeof nodeInfo === 'object' && nodeInfo.uuid) {
            targetNodeUuid = nodeInfo.uuid;
        } else if (typeof nodeInfo === 'string') {
            targetNodeUuid = nodeInfo;
        }

        // 1. 打开文件选择对话框
        const defaultDir = path.join(Editor.Project.path, 'assets', 'asset-art', 'psd', 'tool');
        const result = await Editor.Dialog.select({
            title: '选择 PSD 结构 JSON 文件',
            path: fs.existsSync(defaultDir) ? defaultDir : Editor.Project.path,
            type: 'file',
            filters: [{ name: 'JSON 文件', extensions: ['json'] }],
        });

        if (result.canceled || !result.filePaths || result.filePaths.length === 0) return;

        // 2. 读取 JSON
        const jsonPath = result.filePaths[0];
        const jsonStr = fs.readFileSync(jsonPath, 'utf8');
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

        // 3. 解析精灵帧 UUID
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

        // 4. 构建节点名称
        const psdName = data.psdName || 'PSD';
        const uiNodeName = psdName + 'UI';

        // 5. 调用场景脚本创建节点
        const buildResult = await Editor.Message.request('scene', 'execute-scene-script', {
            name: 'psd2ccc',
            method: 'buildNodes',
            args: [uiNodeName, JSON.stringify(data), JSON.stringify(spriteMap)],
        });

        console.log('[PSD2CCC] 构建结果:', buildResult);

        await Editor.Dialog.info('成功', {
            title: 'PSD → UI 生成完成',
            detail: `已从 "${data.psdName || 'PSD'}" 生成 UI 节点树`,
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
    onHierarchyMenu(assetInfo) {
        return [
            {
                label: '📐 从PSD生成UI',
                async click() {
                    await buildUIFromPSD(assetInfo);
                },
            },
        ];
    },
};
