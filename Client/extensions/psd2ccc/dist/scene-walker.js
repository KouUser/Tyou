'use strict';

/**
 * PSD2CCC 场景脚本 —— 运行在 Cocos Creator 场景面板的渲染进程中
 * 拥有完整的 cc 引擎访问权限，可直接操作场景节点
 */

// ===========================
// 在场景中查找带 Canvas 组件的节点
// ===========================
function findCanvasNode() {
    var scene = cc.director.getScene();
    if (!scene) return null;
    return _findCanvas(scene);
}

function _findCanvas(node) {
    if (node.getComponent && node.getComponent('cc.Canvas')) return node;
    var children = node.children;
    for (var i = 0; i < children.length; i++) {
        var found = _findCanvas(children[i]);
        if (found) return found;
    }
    return null;
}

// ===========================
// 坐标转换: PSD 绝对坐标 → Cocos 相对坐标
// PSD: 原点左上，Y 向下
// Cocos: 原点在父节点锚点(默认中心)，Y 向上
// ===========================
function calcPosition(childOffset, childSize, parentOffset, parentSize) {
    var cx = childOffset.left + childSize.width * 0.5;
    var cy = childOffset.top + childSize.height * 0.5;
    var px = parentOffset.left + parentSize.width * 0.5;
    var py = parentOffset.top + parentSize.height * 0.5;
    return {
        x: cx - px,
        y: -(cy - py),
    };
}

// ===========================
// 创建单个节点
// ===========================
function createNode(parent, data, parentOffset, parentSize, spriteMap) {
    var node = new cc.Node(data.name);
    parent.addChild(node);

    var transform = node.addComponent('cc.UITransform');
    transform.setContentSize(data.size.width, data.size.height);

    var pos = calcPosition(data.offset, data.size, parentOffset, parentSize);
    node.setPosition(pos.x, pos.y, 0);

    if (data.type === 'png') {
        var sprite = node.addComponent('cc.Sprite');
        sprite.sizeMode = 2; // CUSTOM

        var sfUuid = spriteMap[data.relativePath];
        if (sfUuid) {
            try {
                var cached = cc.assetManager.assets.get(sfUuid);
                if (cached) {
                    sprite.spriteFrame = cached;
                } else {
                    cc.assetManager.loadAny(sfUuid, function (err, asset) {
                        if (!err && asset && node.isValid) {
                            sprite.spriteFrame = asset;
                        }
                    });
                }
            } catch (e) {
                console.warn('[PSD2CCC] 加载精灵帧失败:', data.relativePath, e.message);
            }
        }
    } else if (data.type === 'text') {
        var label = node.addComponent('cc.Label');
        var opts = data.options || {};
        label.string = opts.textContents || '';
        label.fontSize = opts.textSize || 14;
        label.lineHeight = opts.textSize || 14;
        label.overflow = 1; // CLAMP
        label.horizontalAlign = 0; // LEFT
        label.verticalAlign = 1; // CENTER
        label.useSystemFont = true;
        label.cacheMode = 0; // NONE
        transform.setContentSize(data.size.width, data.size.height);

        // 设置文字颜色
        var tc = opts.textColor || { red: 0, green: 0, blue: 0 };
        var r = typeof tc.red === 'number' ? tc.red : 0;
        var g = typeof tc.green === 'number' ? tc.green : 0;
        var b = typeof tc.blue === 'number' ? tc.blue : 0;
        label.color = cc.color(r, g, b, 255);
    }

    if (data.children && data.children.length > 0) {
        buildChildren(node, data.children, data.offset, data.size, spriteMap);
    }

    return node;
}

// ===========================
// 批量创建子节点
// ===========================
function buildChildren(parent, children, parentOffset, parentSize, spriteMap) {
    // PSD layers[0] 是最上层（最前面），Cocos 中后添加的子节点渲染在前
    // 所以需要反向遍历，让 PSD 最上层的图层最后添加
    for (var i = children.length - 1; i >= 0; i--) {
        createNode(parent, children[i], parentOffset, parentSize, spriteMap);
    }
}

// ===========================
// 统计节点数量
// ===========================
function countNodes(children) {
    var n = 0;
    for (var i = 0; i < children.length; i++) {
        n++;
        if (children[i].children) {
            n += countNodes(children[i].children);
        }
    }
    return n;
}

// ===========================
// 导出方法
// ===========================
module.exports = {
    methods: {
        /**
         * @param {string} uiNodeName  - 要创建的根 UI 节点名称 (如 "test_uiUI")
         * @param {string} jsonStr     - PSD 结构 JSON 字符串
         * @param {string} spriteMapStr - { relativePath: spriteFrameUuid } 映射 JSON
         */
        buildNodes: function (uiNodeName, jsonStr, spriteMapStr) {
            var data = JSON.parse(jsonStr);
            var spriteMap = JSON.parse(spriteMapStr || '{}');

            // 查找 Canvas 节点
            var canvasNode = findCanvasNode();
            if (!canvasNode) {
                throw new Error('当前场景中找不到 Canvas 组件，请确保场景中存在 Canvas');
            }

            var rootSize = data.size;
            var rootOffset = { left: 0, top: 0 };

            // 创建 UI 根节点
            var uiRoot = new cc.Node(uiNodeName);
            canvasNode.addChild(uiRoot);

            // UITransform
            var uiTransform = uiRoot.addComponent('cc.UITransform');
            uiTransform.setContentSize(rootSize.width, rootSize.height);

            // Widget 全屏
            var widget = uiRoot.addComponent('cc.Widget');
            widget.isAlignTop = true;
            widget.isAlignBottom = true;
            widget.isAlignLeft = true;
            widget.isAlignRight = true;
            widget.top = 0;
            widget.bottom = 0;
            widget.left = 0;
            widget.right = 0;

            // 创建所有子节点
            buildChildren(uiRoot, data.children, rootOffset, rootSize, spriteMap);

            var total = countNodes(data.children);
            console.log('[PSD2CCC] 已在 Canvas/' + uiNodeName + ' 下创建 ' + total + ' 个节点');

            return { success: true, count: total };
        },
    },
};
