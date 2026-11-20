# Worklog to Notion（Raycast Extension）

用一個 Raycast 表單，把工作紀錄依開始時間排序插入 Notion「今天」的工作日誌頁面。

## 安裝（本機開發模式）

```bash
npm install
npm run dev   # Raycast 會自動載入這個 extension
```

第一次執行時，Raycast 會要求填寫 Preferences：

| 欄位                         | 必填 | 說明                                                                                               |
| ---------------------------- | ---- | -------------------------------------------------------------------------------------------------- |
| Notion API Key               | ✅   | Internal integration secret，該 integration 必須被加到工作日誌 database（`⋯` → Connections）       |
| Notion Database ID           | ✅   | 工作日誌資料庫的 ID；database URL 裡的 32 碼，或「Copy data source ID」都可以                      |
| Date Property Name           |      | 用來找今天頁面的日期欄位，預設 `Date`                                                              |
| Jira Base URL                | ✅   | Jira Cloud 網址，例如 `https://your-domain.atlassian.net`                                          |
| Jira Email / API Token       |      | 有填 Jira ticket 時才需要，用來抓 summary                                                          |
| Auto Sections                |      | 打開後自動添加「早上／午休／下午／加班」時段，見下方〈自動時段〉                                   |
| 早上／午休／下午／加班 Start |      | 各時段開始時間（`mmii`），預設 0900／1200／1300／1800，必須依序遞增；只在 Auto Sections 打開時使用 |

### 全域快捷鍵

Raycast 不允許 extension 自帶預設的全域快捷鍵，需要手動設定一次，建議使用 `⌘⇧/`（Windows 為 `Ctrl+Shift+/`）：

1. 在 Raycast 搜尋 `Add Worklog` → `⌘K` → **Configure Command**
2. 點 **Hotkey**，按下 `⌘⇧/`

> `⌘⇧/` 原本是 macOS 各 App「說明」選單搜尋的快捷鍵，設定後會被 Raycast 取代。

## 表單欄位

| 欄位        | 規則                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------- |
| Time Start  | `mmii`，預設為目前時間；以 5 分鐘四捨五入（1112 → 1110、1113 → 1115）                                 |
| Time End    | 選填；同上規則，必須大於 Time Start，有值時優先於 Duration                                            |
| Duration    | 分鐘，以 10 分鐘四捨五入，最少 10（10~14 → 10、15~24 → 20）                                           |
| Action      | 實作（預設）、分析、開會、討論、1o1、排查、協助、Extra、雜項、上 Lab／Staging／Prod、驗收、學習、按摩 |
| Jira Ticket | 選填；`VIPOP-xxxxx`／`PMOJBVIP-xxxxx`，自動組成 `<ticket> <summary>`                                  |
| Description | 選填；每行一個 block。縮排的行會掛到上一行底下，`- ` 開頭會變成項目符號                               |

`⌘↵`（Windows 為 `Ctrl+↵`）送出。

## 寫入規則

1. 在 database 找 Date 落在今天（本地時區）的第一個頁面。
2. 根層 block 中，文字以 `mmii - mmii` 開頭的視為紀錄。
   - **Auto Sections 關閉**：新紀錄插在第一個開始時間比它晚的紀錄前面，沒有就 append 到頁面最後。
   - **Auto Sections 打開**：新紀錄插在「開始時間 ≤ 它」的最後一筆紀錄或時段分隔線後面，所以晚一點才補記的上午紀錄仍會落在上午。
3. 產生的結構：

```
1010 - 1015 按摩                  # 沒有 ticket、沒有 description

1010 - 1015 實作                  # 有 ticket
    VIPOP-45828 小赫開發
        description 第一行
            - 縮排的項目

1010 - 1015 開會                  # 沒有 ticket、有 description
    VIP ATS 開會
```

## 自動時段

Auto Sections 打開時，每次 Add Worklog 會先依序檢查「早上 → 午休 → 下午 → 加班」，符合以下兩個條件的時段會被添加為兩個 block（`## 時段名稱` heading 加上 divider）：

1. 頁面上還沒有同名的 heading
2. 目前時間已經到了該時段的開始時間

插入位置：

- 放在開始時間早於該時段的最後一筆紀錄之後；
- 沒有這種紀錄時，放在前一個時段的分隔線之後；
- 前面也沒有時段時，放在頁面第一個 block 之後。

時段會比這次的紀錄先寫入，所以紀錄會落在對的時段底下。

## 開發

```bash
npm test          # vitest
npx eslint .
npx prettier --check .
npm run build     # ray build，含 TypeScript 檢查
```
