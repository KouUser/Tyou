'use strict';

/**
 * 前缀检查场景脚本 —— 运行在场景渲染进程中
 * 根据前缀规则自动添加/移除组件
 */

// 互斥组件组：同一个节点上不能同时存在的组件
// 添加某个组件时，需要先移除同组的其他组件
var EXCLUSIVE_GROUPS = [
    ['cc.Sprite', 'cc.Label', 'cc.RichText'],
    ['cc.Toggle', 'cc.Slider', 'cc.ProgressBar', 'cc.EditBox'],
];

/**
 * 根据组件类型名找到对应的 cc.Component 类名
 * config 中的 component 可能是 "Node"/"UITransform"/"Sprite"/"Label" 等
 * 映射为引擎中实际的组件全名
 */
function resolveComponentName(component) {
    var map = {
        'Node': null,                    // Node 本身不需要额外组件
        'UITransform': 'cc.UITransform',
        'Label': 'cc.Label',
        'Sprite': 'cc.Sprite',
        'Layout': 'cc.Layout',
        'ListView': 'cc.ScrollView',    // ListView 通常基于 ScrollView
        'ScrollView': 'cc.ScrollView',
        'Toggle': 'cc.Toggle',
        'Slider': 'cc.Slider',
        'ProgressBar': 'cc.ProgressBar',
        'EditBox': 'cc.EditBox',
        'RichText': 'cc.RichText',
        'Button': 'cc.Button',
    };
    return map[component] || null;
}

/**
 * 获取需要移除的互斥组件列表
 */
function getExclusiveComponents(targetComp) {
    var toRemove = [];
    for (var g = 0; g < EXCLUSIVE_GROUPS.length; g++) {
        var group = EXCLUSIVE_GROUPS[g];
        var inGroup = false;
        for (var i = 0; i < group.length; i++) {
            if (group[i] === targetComp) { inGroup = true; break; }
        }
        if (inGroup) {
            for (var j = 0; j < group.length; j++) {
                if (group[j] !== targetComp) {
                    toRemove.push(group[j]);
                }
            }
        }
    }
    return toRemove;
}

/**
 * 递归收集所有子节点
 */
function collectAllChildren(node) {
    var result = [];
    var children = node.children;
    for (var i = 0; i < children.length; i++) {
        result.push(children[i]);
        var sub = collectAllChildren(children[i]);
        for (var j = 0; j < sub.length; j++) {
            result.push(sub[j]);
        }
    }
    return result;
}

module.exports = {
    methods: {
        /**
         * 检查前缀并修正组件
         * @param {string} rootUuid - 根节点 UUID
         * @param {string} configStr - JSON 字符串，componentConfig 数组
         * @returns {{ fixed: number, removed: number, skipped: number, details: string[] }}
         */
        checkPrefixes: function (rootUuid, configStr) {
            var config = JSON.parse(configStr);
            var scene = cc.director.getScene();
            if (!scene) throw new Error('当前没有打开的场景');

            // 查找根节点
            var root = null;
            var findNode = function (node, uuid) {
                if (node.uuid === uuid || node._id === uuid) return node;
                var ch = node.children;
                for (var i = 0; i < ch.length; i++) {
                    var f = findNode(ch[i], uuid);
                    if (f) return f;
                }
                return null;
            };
            root = findNode(scene, rootUuid);
            if (!root) throw new Error('找不到节点 (UUID: ' + rootUuid + ')');

            // 收集所有子节点
            var allNodes = collectAllChildren(root);
            var fixed = 0, removed = 0, skipped = 0;
            var details = [];

            for (var n = 0; n < allNodes.length; n++) {
                var node = allNodes[n];
                var name = node.name || '';

                // 查找匹配的前缀规则
                var matchedRule = null;
                for (var c = 0; c < config.length; c++) {
                    if (name.indexOf(config[c].prefix) === 0) {
                        // 最长匹配优先
                        if (!matchedRule || config[c].prefix.length > matchedRule.prefix.length) {
                            matchedRule = config[c];
                        }
                    }
                }

                if (!matchedRule) continue; // 没有匹配前缀，跳过

                var targetComp = resolveComponentName(matchedRule.component);
                if (!targetComp) {
                    skipped++;
                    continue; // Node/UITransform 不需要特殊处理
                }

                // 检查是否已有目标组件
                var hasTarget = node.getComponent(targetComp);
                if (hasTarget) {
                    skipped++;
                    continue; // 已经有了，跳过
                }

                // 移除互斥组件
                var exclusives = getExclusiveComponents(targetComp);
                for (var e = 0; e < exclusives.length; e++) {
                    var existing = node.getComponent(exclusives[e]);
                    if (existing) {
                        node.removeComponent(existing);
                        removed++;
                        details.push('  ✖ [' + name + '] 移除 ' + exclusives[e]);
                    }
                }

                // 添加目标组件
                try {
                    node.addComponent(targetComp);
                    fixed++;
                    details.push('  ✔ [' + name + '] 添加 ' + targetComp);
                } catch (err) {
                    details.push('  ⚠ [' + name + '] 添加 ' + targetComp + ' 失败: ' + err.message);
                }
            }

            return {
                fixed: fixed,
                removed: removed,
                skipped: skipped,
                total: allNodes.length,
                details: details,
            };
        },
    },
};
