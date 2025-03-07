![在这里插入图片描述](https://i-blog.csdnimg.cn/direct/73be7c16e8894c75a93a2c7c227346ff.png)


## 项目概述

本插件是一个用于在网页上高亮显示选中文本的工具，支持多种颜色选择、高亮复制和删除等功能。插件基于 Edge 扩展测试开发。

目前只大致开发了内容交互脚本和插件弹出页，后台管理页暂未开发。

## 项目结构

```
c:\Users\lc\Documents\前端项目代码\Egde高亮插件
├── content/
│   ├── content.js        // 核心逻辑代码
│   └── highlight.css     // 高亮样式
├── popup/
│   ├── popup.css         // 弹出页样式
│   ├── popup.html        // 弹出页HTML
│   └── popup.js          // 弹出页逻辑
└── manifest.json         // 插件配置文件
```

## 功能概览

### 存储结构

使用 chrome.storage.local 管理高亮的存储信息，其存储结构如下

```
[url]
├── item
│ 	├── id
│ 	├── color
│ 	├── startXPath
│ 	├── endXPath
│ 	├── textFingerprint
│ 	├── contextFingerprint
│ 		├── before
│ 		├── after
```

> startXPath、endXPath 是之前尝试使用 startConatiner、endContainer 的 XPath 以及它们的偏移量来确定 Range 的时候添加的，这个方法是不准确的，因为偏移量会受其它高亮的影响。所以它两可以删除。

![在这里插入图片描述](https://i-blog.csdnimg.cn/direct/b4aec8d522bf4b2d88ee318edc2a0938.png)
### 核心功能

1. 高亮管理
	- 通过 `PageHighlightStorage` 类管理高亮信息
		- 使用 chrome.storage.local 实现数据持久化
		- 支持添加、删除、更新和查询高亮记录
2. 高亮创建
	- 通过 `saveHighlightInfo` 保存高亮信息
		- 使用 `getXPath` 获取元素路径
		- 通过 `generateTextFingerprint` 和 `generateContextFingerprint` 生成文本指纹和上下文指纹
3. 高亮恢复
	- 通过 `restoreHighlights` 恢复已保存的高亮
		- 使用 `createRangeByFingerprint` 根据指纹重新创建Range对象，能处理跨节点的高亮，匹配算法确保高亮位置准确
		- 采用Levenshtein算法进行文本匹配
4. 高亮操作
	- 通过 `createToolbox` 创建操作工具框
		- 支持颜色切换、删除和复制高亮内容
		- 使用 `applyHighlightToRange` 将高亮应用到文本范围
5. 与插件弹出页交互
	- 通过 chrome.tabs.query、chrome.tabs.sendMessage 和 通过 chrome.tabs.onMessage 建立消息通信，实现清除页面全部功能的按钮
6. 错误处理
	- 自动清理无效的高亮记录
	- 处理各种边界情况
	- 提供详细的日志输出

