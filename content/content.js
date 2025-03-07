/**
 * content.js
 * 文本选中高亮逻辑代码
 */

// 颜色按钮
const colorBtns = [];
// 高亮信息存储结构体
// let highlightInfo = {
//     id: "",
//     color: "",
//     startXPath: "",
//     endXPath: "",
//     textFingerprint: "",
//     contextFingerprint: "",
// };

// 保存当前 range 的重要信息
// let currentRangeInfo = {};
// 当前 range
let range = null;

// chrome.storage.local 操作 API 封装类
class PageHighlightStorage {
    static storage = chrome.storage.local;
    static highlights = [];
    static url = location.href;

    constructor() {
        PageHighlightStorage.storage.get(PageHighlightStorage.url, (result) => {
            if (chrome.runtime.lastError) {
                console.error("获取本地存储数据失败:", chrome.runtime.lastError);
                return;
            }
            PageHighlightStorage.highlights = result[PageHighlightStorage.url] || [];
        });
    }

    static getHighlightByID(highlightID) {
        return this.highlights.find((highlight) => highlight.id == highlightID);
    }

    static getAllHighlights() {
        return this.highlights;
    }

    static addHighlight(highlightInfo) {
        this.highlights.push(highlightInfo);
        this.storage.set({ [this.url]: this.highlights });
    }

    static removeHighlight(highlightID) {
        this.highlights = this.highlights.filter((highlight) => highlight.id != highlightID);
        this.storage.set({ [this.url]: this.highlights });
    }

    static removeAllHighlights() {
        this.highlights = [];
        this.storage.remove(this.url);
    }

    static updateHighlight(highlightID, newHighlightInfo) {
        const index = this.highlights.findIndex((highlight) => highlight.id == highlightID);
        if (index !== -1) {
            this.highlights[index] = newHighlightInfo;
            this.storage.set({ [this.url]: this.highlights });
        }
    }
}

// 保存高亮信息
function saveHighlightInfo(range, highlightID, color) {
    const highlightInfo = {};
    highlightInfo.id = highlightID;
    highlightInfo.color = color;
    highlightInfo.startXPath = getXPath(range.startContainer);
    highlightInfo.endXPath = getXPath(range.endContainer);
    highlightInfo.textFingerprint = generateTextFingerprint(range);
    highlightInfo.contextFingerprint = generateContextFingerprint(range);
    PageHighlightStorage.addHighlight(highlightInfo);
}

// 获取元素的XPath
function getXPath(element) {
    if (!element) return "";
    if (element.nodeType === Node.TEXT_NODE) {
        element = element.parentNode;
    }

    if (element === document.body) return "/html/body";

    // ix 表示元素在同级元素中的索引
    let ix = 0;
    // siblings 表示元素的同级元素列表
    let siblings = element.parentNode.childNodes;

    for (let i = 0; i < siblings.length; i++) {
        let sibling = siblings[i];
        if (sibling === element) {
            let path = getXPath(element.parentNode);
            let tag = element.tagName.toLowerCase();

            // 如果是元素节点，优先使用ID或其他稳定属性
            if (sibling.nodeType === 1) {
                if (element.id) {
                    return `${path}/${tag}[@id='${element.id}']`;
                }
                // 查找其他稳定属性
                const stableAttr = ["data-id", "name", "data-testid"].find((attr) => element.hasAttribute(attr));
                if (stableAttr) {
                    return `${path}/${tag}[@${stableAttr}='${element.getAttribute(stableAttr)}']`;
                }
            }
            // 仅在没有稳定属性时使用位置索引
            return `${path}/${tag}[${ix + 1}]`;
        }
        // 统计相同标签名的兄弟节点数量
        if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
            ix++;
        }
    }
}

// 生成文本指纹
function generateTextFingerprint(range) {
    if (range.startContainer === range.endContainer) {
        return range.startContainer.textContent.slice(range.startOffset, range.endOffset);
    }

    let text = "";

    // 使用TreeWalker遍历文本节点
    const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
            return node.textContent.trim().length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        },
    });

    // 遍历
    while (walker.nextNode()) {
        const node = walker.currentNode;
        if (node.textContent.trim().length === 0) {
            continue;
        }
        if (node === range.startContainer) {
            text += node.textContent.slice(range.startOffset);
        } else if (node === range.endContainer) {
            text += node.textContent.slice(0, range.endOffset);
            break;
        } else {
            text += node.textContent;
        }
    }

    return text;
}

// 生成上下文指纹
function generateContextFingerprint(range) {
    const CONTEXT_LENGTH = 50;
    const normalizeText = (text) =>
        text
            .replace(/[\t\u200b]+/g, " ")
            .replace(/ {2,}/g, " ")
            .replace(/^ +| +$/g, "")
            .replace(/(\n)/g, "↵"); // 保留换行符号

    let beforeText = "";
    let afterText = "";

    let node = range.startContainer;
    let offset = range.startOffset;
    // 获取前文至多 50 个字符
    if (node.nodeType === Node.TEXT_NODE) {
        beforeText = node.textContent.slice(0, offset) + beforeText;
    }
    node = getPreviousTextNode(node);
    while (node && beforeText.length < CONTEXT_LENGTH) {
        if (node.nodeType === Node.TEXT_NODE) {
            beforeText = node.textContent + beforeText;
        }
        node = getPreviousTextNode(node);
        offset = node ? node.textContent.length : 0;
    }

    node = range.endContainer;
    offset = range.endOffset;
    // 获取后文至多 50 个字符
    if (node.nodeType === Node.TEXT_NODE) {
        afterText += node.textContent.slice(offset);
    }
    node = getNextTextNode(node);
    while (node && afterText.length < CONTEXT_LENGTH) {
        if (node.nodeType === Node.TEXT_NODE) {
            afterText += node.textContent;
        }
        node = getNextTextNode(node);
        offset = 0;
    }

    return {
        before: normalizeText(beforeText.slice(-CONTEXT_LENGTH * 2)),
        after: normalizeText(afterText.slice(0, CONTEXT_LENGTH * 2)),
    };
}

// 恢复高亮
function restoreHighlights() {
    // chrome.storage.local.get([highlightInfo.url], (result) => {
    //     console.log("开始恢复高亮，当前URL:", highlightInfo.url, "存储数据:", result);
    //     const highlights = result[highlightInfo.url] || [];
    //     console.log("找到", highlights.length, "个高亮记录");
    //     highlights.forEach((item) => {
    //         console.log("正在处理高亮ID:", item.id);
    //         try {
    //             // 根据info中的XPath和文本指纹生成Range
    //             const matchedRange = createRangeByFingerprint(item.textFingerprint, item.contextFingerprint);
    //             console.log("高亮ID:", item.id, "匹配结果:", matchedRange ? "成功" : "失败");
    //             if (matchedRange) {
    //                 // 创建高亮
    //                 const span = document.createElement("span");
    //                 span.style.backgroundColor = item.color;
    //                 span.dataset.highlightid = item.id;
    //                 applyHighlightToRange(matchedRange, span);
    //             } else {
    //                 console.warn("未找到匹配的文本节点");
    //             }
    //         } catch (error) {
    //             console.error("恢复高亮失败 ID:", item.id, "错误详情:", error);
    //             // 从当前页面的高亮数组中移除无效条目
    //             console.log("开始清理无效高亮:", item.id);
    //             chrome.storage.local.get([highlightInfo.url], (result) => {
    //                 const highlights = result[highlightInfo.url] || [];
    //                 const index = highlights.findIndex((h) => h.id === item.id);
    //                 if (index !== -1) {
    //                     highlights.splice(index, 1);
    //                     chrome.storage.local.set({ [highlightInfo.url]: highlights });
    //                     console.log("已清理无效高亮:", item.id);
    //                 }
    //             });
    //         }
    //     });
    // });

    const highlights = PageHighlightStorage.getAllHighlights();
    if (!highlights || highlights.length === 0) {
        console.log("未找到任何高亮记录");
        return;
    }
    console.log("开始恢复高亮 ", "存储数据:", highlights);
    highlights.forEach((item) => {
        console.log("正在处理高亮ID:", item.id);
        try {
            // 根据info中的XPath和文本指纹生成Range
            const matchedRange = createRangeByFingerprint(item.textFingerprint, item.contextFingerprint);
            console.log("高亮ID:", item.id, "匹配结果:", matchedRange ? "成功" : "失败");
            if (matchedRange) {
                // 创建高亮
                const span = document.createElement("span");
                span.style.backgroundColor = item.color;
                span.dataset.highlightid = item.id;
                applyHighlightToRange(matchedRange, span);
            } else {
                console.warn("未找到匹配的文本节点");
            }
        } catch (error) {
            console.error("恢复高亮失败 ID:", item.id, "错误详情:", error);
            // 从当前页面的高亮数组中移除无效条目
            console.log("开始清理无效高亮:", item.id);
            PageHighlightStorage.removeHighlight(item.id);
            console.log("已清理无效高亮:", item.id);
        }
    });
}

// 根据文本指纹和上下文指纹获取 Range
function createRangeByFingerprint(textFingerprint, contextFingerprint) {
    const treeWalker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
        acceptNode: (node) => {
            // 处理隐藏节点（如display:none的元素）
            if (node.parentElement.offsetParent === null) {
                return NodeFilter.FILTER_SKIP;
            }
            return node.textContent.trim().length > 0 ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
        },
    });

    // Levenshtein距离计算函数，其作用是计算两个字符串之间的差异程度，通过比较两个字符串的每个字符，计算出它们之间的差异程度，然后根据差异程度，计算出两个字符串之间的相似度，相似度越高，说明两个字符串越相似，相似度越低，说明两个字符串越不相似
    function levenshteinDistance(a, b) {
        // 字符权重计算，中文字符权重为1，其他字符权重为0.5，表示中文字符比其他字符更重要
        const getCharWeight = (char) => (isChinese(char) ? 1 : 0.5);

        if (a.length === 0) return b.length;
        if (b.length === 0) return a.length;

        const matrix = [];
        for (let i = 0; i <= b.length; i++) {
            //
            matrix[i] = [i * getCharWeight(b[i - 1] || "")];
        }

        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j * getCharWeight(a[j - 1] || "");
        }

        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                const cost = b[i - 1] === a[j - 1] ? 0 : isChinese(b[i - 1]) && isChinese(a[j - 1]) ? 1 : 0.5;

                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + getCharWeight(b[i - 1]),
                    matrix[i][j - 1] + getCharWeight(a[j - 1]),
                    matrix[i - 1][j - 1] + cost
                );
            }
        }
        return matrix[b.length][a.length];
    }

    // 新增判断中文字符的函数
    function isChinese(char) {
        return /[\u4e00-\u9fa5]/.test(char);
    }

    console.log("开始文本指纹匹配:", textFingerprint);
    console.log("目标上下文:", contextFingerprint);

    let bestMatch = { score: Infinity, range: null };
    let nodesInfo = [];
    let globalOffset = 0;

    // 收集所有文本节点及其全局偏移信息
    while ((node = treeWalker.nextNode())) {
        const text = node.textContent;
        const start = globalOffset;
        const end = start + text.length;
        nodesInfo.push({ node, start, end, text });
        globalOffset = end;
    }

    console.log("文本节点信息收集完成，共", nodesInfo.length, "个节点");
    console.log("文本节点信息:", nodesInfo);

    const fullText = nodesInfo.map((info) => info.text).join("");

    console.log("全文内容:", fullText);

    let pos = -1;
    while ((pos = fullText.indexOf(textFingerprint, pos + 1)) !== -1) {
        const startGlobal = pos;
        const endGlobal = pos + textFingerprint.length;

        // 查找对应的节点和偏移
        const startInfo = findNodeAndOffset(startGlobal, nodesInfo);
        const endInfo = findNodeAndOffset(endGlobal, nodesInfo);

        if (!startInfo || !endInfo) continue;

        // 创建Range
        const range = document.createRange();
        try {
            range.setStart(startInfo.node, startInfo.offset);
            range.setEnd(endInfo.node, endInfo.offset);
        } catch (e) {
            console.error("Error creating range:", e);
            continue;
        }

        // 计算上下文相似度
        const currentContext = generateContextFingerprint(range);
        const beforeDistance = levenshteinDistance(currentContext.before, contextFingerprint.before);
        const afterDistance = levenshteinDistance(currentContext.after, contextFingerprint.after);
        const totalScore = (beforeDistance + afterDistance) / 2;

        if (totalScore < bestMatch.score) {
            bestMatch = { score: totalScore, range: range };
        }

        // 销毁Range
        range.detach();
    }

    // 查找节点和偏移的辅助函数
    function findNodeAndOffset(globalPos, nodesInfo) {
        for (const info of nodesInfo) {
            if (globalPos >= info.start && globalPos <= info.end) {
                const offset = Math.min(globalPos - info.start, info.node.textContent.length);
                return { node: info.node, offset: offset };
            }
        }
        return null;
    }

    function calculateThreshold(before, after) {
        const baseThreshold = 0.8;
        const lengthFactor = Math.min(before.length, after.length) / 100;
        return baseThreshold * (before.length + after.length) * (1 + lengthFactor);
    }

    // 计算阈值，阈值越小，匹配越严格，阈值越大，匹配越宽松
    const THRESHOLD = calculateThreshold(contextFingerprint.before, contextFingerprint.after);

    console.log("最终匹配结果:", {
        bestScore: bestMatch.score,
        threshold: THRESHOLD,
        matched: bestMatch.score <= THRESHOLD,
    });

    if (bestMatch.range) {
        console.log("生成XPath:", {
            start: getXPath(bestMatch.range.startContainer),
            end: getXPath(bestMatch.range.endContainer),
        });
    }

    return bestMatch.score <= THRESHOLD ? bestMatch.range : null;
}

function calculateContextSimilarity(current, target, targetText) {
    const normalize = (str) => str.toLowerCase().replace(/[\s\p{P}]/gu, "");

    const beforeScore = similarity(normalize(current.before), normalize(target.before));

    const afterScore = similarity(normalize(current.after), normalize(target.after));

    const fullMatchBonus = current.before.includes(targetText) || current.after.includes(targetText) ? 0.2 : 0;

    return (beforeScore + afterScore) / 2 + fullMatchBonus;
}

function getPreviousTextNode(node) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    walker.currentNode = node;
    return walker.previousNode();
}

function getNextTextNode(node) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, null, false);
    walker.currentNode = node;
    return walker.nextNode();
}

function applyHighlightToRange(range, span) {
    // 给span绑定点击事件，用于显示工具框
    span.addEventListener("click", (e) => {
        e.stopPropagation();
        createToolbox(range, e.target.dataset.highlightid);
        colorBtns.forEach((btn) => {
            btn.dataset.flag = "switch";
        });
    });

    const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT, {
        acceptNode: function (node) {
            const nodeRange = document.createRange();
            nodeRange.selectNode(node);
            if (node.textContent.trim().length === 0) return NodeFilter.FILTER_REJECT;
            // 如果节点在选区内，接受节点(即高亮)
            return range.intersectsNode(node) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
        },
    });

    // 存储所有需要高亮的文本节点
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) {
        textNodes.push(node);
    }

    if (textNodes.length === 0) {
        try {
            // 如果选区内没有文本节点，则直接包裹选区
            range.surroundContents(span);
        } catch (e) {
            console.warn("无法完全包裹节点:", e);
        }
        return;
    }

    // 为每个文本节点创建高亮span
    textNodes.forEach((textNode) => {
        const nodeRange = document.createRange();
        nodeRange.selectNode(textNode);

        // 如果节点部分在选区内
        if (range.startContainer === textNode) {
            nodeRange.setStart(textNode, range.startOffset);
        }
        if (range.endContainer === textNode) {
            nodeRange.setEnd(textNode, range.endOffset);
        }

        // 创建新的span并包裹文本
        const newSpan = span.cloneNode();

        newSpan.addEventListener("click", (e) => {
            e.stopPropagation();
            createToolbox(range, e.target.dataset.highlightid);
            colorBtns.forEach((btn) => {
                btn.dataset.flag = "switch";
            });
        });

        try {
            nodeRange.surroundContents(newSpan);
        } catch (e) {
            console.warn("无法完全包裹节点:", e);
        }
    });
}

// 根据info中的XPath和文本指纹创建Range
// function createRangeFromInfo(highlightInfo) {
//     try {
//         // 获取开始节点
//         let startContainer = document.evaluate(
//             highlightInfo.startXPath,
//             document,
//             null,
//             XPathResult.FIRST_ORDERED_NODE_TYPE,
//             null
//         ).singleNodeValue;

//         // 获取结束节点
//         let endContainer = document.evaluate(
//             highlightInfo.endXPath,
//             document,
//             null,
//             XPathResult.FIRST_ORDERED_NODE_TYPE,
//             null
//         ).singleNodeValue;

//         if (!startContainer || !endContainer) {
//             console.error("无法找到目标节点");
//             return null;
//         }

//         // 根据文本text获取startOffset和endOffset
//         const text = highlightInfo.text;
//         const startText = startContainer.textContent;
//         const endText = endContainer.textContent;
//         let startOffset = -1;
//         let endOffset = -1;

//         if (startContainer === endContainer) {
//             startOffset = startText.indexOf(text);
//             endOffset = startOffset + text.length;
//         } else {
//             for (let i = 0; i < startText.length; i++) {
//                 if (text.indexOf(startText.slice(i)) !== -1) {
//                     startOffset = i;
//                     break;
//                 }
//             }

//             for (let i = 0; i <= endText.length; i++) {
//                 if (i === endText.length || text.indexOf(endText.slice(0, i + 1)) === -1) {
//                     endOffset = i;
//                     break;
//                 }
//             }
//         }

//         if (startOffset === -1 || endOffset === -1) {
//             console.error("无法找到文本指纹");
//             return null;
//         }

//         // 创建Range
//         const range = document.createRange();

//         // 如果startContainer不是文本节点，获取其第一个文本节点
//         if (startContainer.nodeType !== Node.TEXT_NODE) {
//           const walker = document.createTreeWalker(startContainer, NodeFilter.SHOW_TEXT, null, false);
//           const firstTextNode = walker.nextNode();
//           if (!firstTextNode) {
//             console.error("无法找到文本节点");
//             return null;
//           }
//           startContainer = firstTextNode;
//         }

//         // 如果endContainer不是文本节点，获取其第一个文本节点
//         if (endContainer.nodeType !== Node.TEXT_NODE) {
//           const walker = document.createTreeWalker(endContainer, NodeFilter.SHOW_TEXT, null, false);
//           const firstTextNode = walker.nextNode();
//           if (!firstTextNode) {
//             console.error("无法找到文本节点");
//             return null;
//           }
//           endContainer = firstTextNode;
//         }

//         // 设置Range
//         range.setStart(startContainer, startOffset);
//         range.setEnd(endContainer, endOffset);

//         return range;
//     } catch (error) {
//         console.error("XPath解析失败:", error);
//         return null;
//     }
// }

function createToolbox(range, highlightid = -1) {
    const rect = range.getBoundingClientRect();
    const toolBox = document.createElement("div");
    toolBox.className = "highlight-tooltip";
    toolBox.style.top = `${rect.top}px`;
    toolBox.style.left = `${rect.left + rect.width / 2}px`;

    // 将颜色按钮添加到工具框中
    colorBtns.forEach((colorBtn) => toolBox.appendChild(colorBtn));

    if (highlightid !== -1) {
        const deleteBtn = document.createElement("button");
        deleteBtn.className = "delete-btn";
        deleteBtn.textContent = "删除";
        deleteBtn.addEventListener("click", handleDeleteBtnClick);
        toolBox.appendChild(deleteBtn);

        const copyBtn = document.createElement("button");
        copyBtn.className = "copy-btn";
        copyBtn.textContent = "复制";
        copyBtn.addEventListener("click", handleCopyBtnClick);
        toolBox.appendChild(copyBtn);

        // 设置工具框的data-highlightid属性
        toolBox.dataset.highlightid = highlightid;
    }

    // 将工具框添加到文档中
    document.body.appendChild(toolBox);
}

function initColorBtns() {
    ["yellow", "cyan", "pink", "lightgreen"].forEach((color) => {
        const colorBtn = document.createElement("button");
        colorBtn.className = "color-btn";
        colorBtn.style.backgroundColor = color;
        colorBtn.dataset.flag = "highlight";
        colorBtn.dataset.color = color;
        colorBtn.addEventListener("click", (e) => handleColorBtnClick(e, colorBtn.dataset.flag));
        colorBtns.push(colorBtn);
    });
}

// 点击颜色按钮，在文本上划线高亮，并生成指纹，保存到本地
// flag：for highlight or for switch
function handleColorBtnClick(e, flag) {
    console.log("当前 range:", range);

    // 阻止冒泡
    e.stopPropagation();

    if (flag === "switch") {
        // 切换颜色
        const toolBox = e.target.closest(".highlight-tooltip");
        const highlightID = toolBox.dataset.highlightid;
        document.querySelectorAll(`[data-highlightid="${highlightID}"]`).forEach((span) => {
            span.style.backgroundColor = e.target.style.backgroundColor;
        });

        // 更新本地存储
        const highlight = PageHighlightStorage.getHighlightByID(highlightID);
        if (highlight) {
            highlight.color = e.target.style.backgroundColor;
            PageHighlightStorage.updateHighlight(highlightID, highlight);
        }
        return;
    }

    // 生成高亮id
    const highlightID = Date.now();

    // 获取颜色
    const color = e.target.style.backgroundColor;

    // 创建一个span元素
    const span = document.createElement("span");
    // 设置高亮颜色
    span.style.backgroundColor = color;
    // 设置高亮id
    span.dataset.highlightid = highlightID;

    try {
        // 保存高亮信息
        saveHighlightInfo(range, highlightID, color);

        // 获取选中范围内的所有文本节点
        applyHighlightToRange(range, span);

        // 销毁之前的工具框
        document.querySelector(".highlight-tooltip")?.remove();

        // 清除选区
        window.getSelection().removeAllRanges();
    } catch (error) {
        console.error("高亮处理失败:", error);
    }
}

function handleDeleteBtnClick(e) {
    e.stopPropagation();
    // 获取当前点击的删除按钮
    const deleteBtn = e.target;
    // 获取当前点击的工具框
    const toolBox = deleteBtn.closest(".highlight-tooltip");
    // 获取当前点击的高亮id
    const highlightID = toolBox.dataset.highlightid;
    // 从本地存储中删除对应的高亮信息
    // chrome.storage.local.remove(highlightID, () => {
    //     // 从文档中移除高亮span标签
    //     const highlightSpans = document.querySelectorAll(`span[data-highlightid="${highlightID}"]`);
    //     highlightSpans.forEach((span) => {
    //         // 将 span 替换为其内容
    //         const text = span.textContent;
    //         span.parentNode.replaceChild(document.createTextNode(text), span);
    //     });
    //     // 销毁工具框
    //     toolBox.remove();
    // });
    // 从本地存储中删除对应的高亮信息
    // chrome.storage.local.get([highlightInfo.url], (result) => {
    //     const highlights = result[highlightInfo.url] || [];
    //     const highlightIndex = highlights.findIndex((highlight) => highlight.id == highlightID);
    //     if (highlightIndex !== -1) {
    //         highlights.splice(highlightIndex, 1);
    //         chrome.storage.local.set({ [highlightInfo.url]: highlights });
    //         // 从文档中移除高亮span标签
    //         const highlightSpans = document.querySelectorAll(`span[data-highlightid="${highlightID}"]`);
    //         highlightSpans.forEach((span) => {
    //             // 将 span 替换为其内容
    //             const text = span.textContent;
    //             span.parentNode.replaceChild(document.createTextNode(text), span);
    //         });
    //         // 销毁工具框
    //         toolBox.remove();
    //     } else {
    //         console.error("无法找到对应的高亮信息");
    //     }
    // });
    // 从本地存储中删除对应的高亮信息
    PageHighlightStorage.removeHighlight(highlightID);
    // 从文档中移除高亮span标签
    const highlightSpans = document.querySelectorAll(`span[data-highlightid="${highlightID}"]`);
    highlightSpans.forEach((span) => {
        // 将 span 替换为其内容
        const text = span.textContent;
        span.parentNode.replaceChild(document.createTextNode(text), span);
    });
    // 销毁工具框
    toolBox.remove();
}

function handleCopyBtnClick(e) {
    e.stopPropagation();
    // 获取当前点击的复制按钮
    const copyBtn = e.target;
    // 获取当前点击的工具框
    const toolBox = copyBtn.closest(".highlight-tooltip");
    // 获取当前点击的高亮id
    const highlightID = toolBox.dataset.highlightid;

    // 从本地存储中获取对应的高亮信息
    // chrome.storage.local.get([highlightInfo.url], (result) => {
    //     const highlights = result[highlightInfo.url] || [];
    //     const highlight = highlights.find((item) => item.id === highlightID);

    //     if (highlight) {
    //         // 将高亮文本复制到剪贴板
    //         navigator.clipboard.writeText(highlight.text);

    //         // 显示复制成功提示
    //         // const copySuccessTip = document.createElement("div");
    //         // copySuccessTip.className = "copy-success-tip";
    //         // copySuccessTip.textContent = "复制成功";
    //         // document.body.appendChild(copySuccessTip);
    //     }
    // });

    // 从本地存储中获取对应的高亮信息
    const highlight = PageHighlightStorage.getHighlightByID(highlightID);
    if (highlight) {
        // 将高亮文本复制到剪贴板
        navigator.clipboard.writeText(highlight.textFingerprint);
        // 显示复制成功提示
        // const copySuccessTip = document.createElement("div");
        // copySuccessTip.className = "copy-success-tip";
        // copySuccessTip.textContent = "复制成功";
        // document.body.appendChild(copySuccessTip);
    }
}

async function init() {
    // 将PageHighlightStorage初始化改为Promise
    await new Promise((resolve) => {
        const storage = new PageHighlightStorage();
        // 监听storage初始化完成
        chrome.storage.local.get([PageHighlightStorage.url], () => {
            resolve();
        });
    });

    initColorBtns();
    restoreHighlights();

    // 监听鼠标抬起事件，弹出工具框
    document.addEventListener("mouseup", (e) => {
        // 如果点击的是工具框内的元素，则不处理
        if (e.target.closest(".highlight-tooltip")) return;

        // 销毁之前的工具框
        document.querySelectorAll(".highlight-tooltip").forEach((toolBox) => toolBox.remove());

        // 获取选中的文本
        const selection = window.getSelection();
        if (selection.toString().trim().length === 0) return;

        // 深拷贝 range
        range = selection.getRangeAt(0).cloneRange();

        // let currentRangeInfo = {
        //     startContainer: range.startContainer,
        //     startOffset: range.startOffset,
        //     endContainer: range.endContainer,
        //     endOffset: range.endOffset,
        //     commonAncestorContainer: range.commonAncestorContainer,
        //     collapsed: range.collapsed,
        //     boundingRect: range.getBoundingClientRect(), // 获取范围的边界矩形
        //     textContent: range.toString(), // 获取范围内的文本内容
        //     htmlContent: range.cloneContents() // 获取范围内的HTML内容
        // };

        console.log("当前 range:", range);

        // 如果选中的文data-highlightid本已经被高亮过，则不处理
        if (range.commonAncestorContainer.closest?.("[data-highlightid]")) return;

        // 显示工具框
        createToolbox(range);
    });

    // 监听插件弹出页popup.html的消息
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === "clearAllHighlights") {
            // 清空所有高亮
            const highlightSpans = document.querySelectorAll("span[data-highlightid]");
            highlightSpans.forEach((span) => {
                // 将 span 替换为其内容
                const text = span.textContent;
                span.parentNode.replaceChild(document.createTextNode(text), span);
            });
            // 清空当前页面的高亮数组
            PageHighlightStorage.removeAllHighlights();
        }
    });
}

// 初始化
init();
