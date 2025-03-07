document.getElementById("clearAll").addEventListener("click", async () => {
    if (confirm("确定要删除本页所有高亮吗？")) {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

        // 删除页面元素
        await chrome.tabs.sendMessage(tab.id, { action: "clearAllHighlights" });
    }
});
