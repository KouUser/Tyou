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
// Fix: 使用 sourceBounds 中心而非 offset+size/2，避免 trim 后错位
// ===========================
function calcPosition(childData, parentOffset, parentSize) {
    var cx, cy;
    if (childData.sourceBounds) {
        cx = (childData.sourceBounds.left + childData.sourceBounds.right) * 0.5;
        cy = (childData.sourceBounds.top + childData.sourceBounds.bottom) * 0.5;
    } else {
        cx = childData.offset.left + childData.size.width * 0.5;
        cy = childData.offset.top + childData.size.height * 0.5;
    }
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

    // 使用 trimmedSize（裁切后真实尺寸）设置 contentSize
    var displayW = (data.trimmedSize && data.trimmedSize.width) || data.size.width;
    var displayH = (data.trimmedSize && data.trimmedSize.height) || data.size.height;
    var transform = node.addComponent('cc.UITransform');
    transform.setContentSize(displayW, displayH);

    var pos = calcPosition(data, parentOffset, parentSize);
    node.setPosition(pos.x, pos.y, 0);

    if (data.type === 'png') {
        var sprite = node.addComponent('cc.Sprite');
        sprite.sizeMode = 2; // CUSTOM

        // 九宫格处理：设置 SLICED 模式
        if (data.sliceBorder) {
            sprite.type = 1; // cc.Sprite.Type.SLICED
        }

        // PNG 图层透明度
        var pngOpacity = (data.options && typeof data.options.opacity === 'number') ? data.options.opacity : 100;
        if (pngOpacity < 100) {
            node.getComponent('cc.UIOpacity') || node.addComponent('cc.UIOpacity');
            node.getComponent('cc.UIOpacity').opacity = Math.round(pngOpacity * 2.55);
        }

        var sfUuid = spriteMap[data.relativePath];
        if (sfUuid) {
            try {
                var sliceBorder = data.sliceBorder;
                var s9OrigSize = data.originalSize;
                var cached = cc.assetManager.assets.get(sfUuid);
                if (cached) {
                    if (sliceBorder) {
                        cached.insetTop = sliceBorder.top;
                        cached.insetBottom = sliceBorder.bottom;
                        cached.insetLeft = sliceBorder.left;
                        cached.insetRight = sliceBorder.right;
                    }
                    sprite.spriteFrame = cached;
                    // 九宫格：spriteFrame 赋值后再设 contentSize，防止被引擎覆盖
                    if (sliceBorder && s9OrigSize) {
                        transform.setContentSize(s9OrigSize.width, s9OrigSize.height);
                    }
                } else {
                    cc.assetManager.loadAny(sfUuid, function (err, asset) {
                        if (!err && asset && node.isValid && sprite.isValid) {
                            if (sliceBorder) {
                                asset.insetTop = sliceBorder.top;
                                asset.insetBottom = sliceBorder.bottom;
                                asset.insetLeft = sliceBorder.left;
                                asset.insetRight = sliceBorder.right;
                            }
                            sprite.spriteFrame = asset;
                            // 异步加载路径同样在赋值后恢复原始尺寸
                            if (sliceBorder && s9OrigSize) {
                                transform.setContentSize(s9OrigSize.width, s9OrigSize.height);
                            }
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

        // 行高：优先用 leading，为 0 时回退到 textSize（Fix #6）
        var leading = opts.leading;
        label.lineHeight = (typeof leading === 'number' && leading > 0) ? leading : (opts.textSize || 14);

        // 点文字用 NONE（不裁剪），段落文本用 CLAMP
        if (opts.textBoxBounds && opts.textBoxBounds.width > 0) {
            label.overflow = 1; // CLAMP
        } else {
            label.overflow = 0; // NONE - 点文字不限制尺寸，避免裁剪
        }
        label.useSystemFont = true;
        label.cacheMode = 0; // NONE

        // 对齐方式映射（Fix #6）
        var justMap = { LEFT: 0, CENTER: 1, RIGHT: 2, JUSTIFYLEFT: 0, JUSTIFYCENTER: 1, JUSTIFYRIGHT: 2, JUSTIFYALL: 0 };
        var just = opts.justification || 'LEFT';
        label.horizontalAlign = (justMap[just] != null) ? justMap[just] : 0;
        label.verticalAlign = 1; // CENTER

        // 粗体/斜体（Fix #6）
        if (opts.fauxBold) label.isBold = true;
        if (opts.fauxItalic) label.isItalic = true;

        // 文本框尺寸（Fix #6）：段落文本用 textBoxBounds，否则用 layer size
        if (opts.textBoxBounds && opts.textBoxBounds.width > 0) {
            transform.setContentSize(opts.textBoxBounds.width, opts.textBoxBounds.height || data.size.height);
        } else {
            transform.setContentSize(data.size.width, data.size.height);
        }

        // 设置文字颜色
        var tc = opts.textColor || { red: 0, green: 0, blue: 0 };
        var r = typeof tc.red === 'number' ? tc.red : 0;
        var g = typeof tc.green === 'number' ? tc.green : 0;
        var b = typeof tc.blue === 'number' ? tc.blue : 0;
        label.color = cc.color(r, g, b, 255);

        // 透明度
        if (typeof opts.opacity === 'number' && opts.opacity < 100) {
            node.getComponent('cc.UIOpacity') || node.addComponent('cc.UIOpacity');
            node.getComponent('cc.UIOpacity').opacity = Math.round(opts.opacity * 2.55);
        }

        // 描边（Label 内置属性）
        if (opts.outline && opts.outline.width > 0) {
            label.enableOutline = true;
            label.outlineWidth = opts.outline.width;
            var oc = opts.outline.color || { red: 0, green: 0, blue: 0 };
            label.outlineColor = cc.color(oc.red || 0, oc.green || 0, oc.blue || 0, 255);
        }

        // 阴影（Label 内置属性）
        if (opts.shadow) {
            label.enableShadow = true;
            var shc = opts.shadow.color || { red: 0, green: 0, blue: 0 };
            var shAlpha = (typeof opts.shadow.opacity === 'number') ? Math.round(opts.shadow.opacity * 2.55) : 255;
            label.shadowColor = cc.color(shc.red || 0, shc.green || 0, shc.blue || 0, shAlpha);
            label.shadowOffset = cc.v2(opts.shadow.offsetX || 2, opts.shadow.offsetY || -2);
            label.shadowBlur = opts.shadow.blur || 2;
        }
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

            // 创建所有子节点（try/catch 保护，失败时清理残留节点）
            try {
                buildChildren(uiRoot, data.children, rootOffset, rootSize, spriteMap);
            } catch (buildErr) {
                uiRoot.destroy();
                throw buildErr;
            }

            var total = countNodes(data.children);
            console.log('[PSD2CCC] 已在 Canvas/' + uiNodeName + ' 下创建 ' + total + ' 个节点');

            return { success: true, count: total };
        },
    },
};
