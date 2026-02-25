# Gmail Old Emails Purger (Apps Script)

A resilient, self-chaining Google Apps Script that automatically archives old inbox threads and permanently deletes (moves to trash) old emails from specified Gmail categories and custom labels — while protecting important messages via exclusions.

Designed to safely handle very large inboxes (100,000+ messages) by processing in small, time-safe batches and automatically chaining executions when more work remains.

**Important: This script permanently trashes emails after the configured retention period. Use at your own risk.**

## ☢️ Critical Safety Warning – Backup First!

**Before running this script on any Gmail account:**

1. **Export your data**  
   Go to [Google Takeout](https://takeout.google.com) → select **Mail** → create export (MBOX format).  
   Download and store the backup somewhere safe (external drive, encrypted cloud, etc.).  
   This is your only way to recover accidentally deleted emails.

2. **Test with DRY_RUN = true**  
   Keep `DRY_RUN = true` for the first several runs. The script will log what it *would* do without making any changes.

3. **Start small**  
   - Use conservative retention periods (e.g., 30–90 days) initially.  
   - Add important labels/categories to exclusions first.

4. **Monitor closely** the first few days  
   Watch Executions logs and Gmail category/inbox counts. You can always stop by deleting triggers via the Apps Script editor.

There is **no undo** for trashed emails after 30 days (when Gmail auto-deletes Trash).

## Features

- Archives old inbox threads from selected categories (older than 10 days by default)
- Permanently trashes old threads from configured categories and labels
- Excludes important messages via a customizable search filter string
- Uses LockService to prevent overlapping runs
- Detects large result sets via preview phase → auto-chains via delayed triggers
- Time-aware: bails early if approaching 6-minute execution limit
- DRY_RUN mode for safe testing

## Prerequisites

- A Google account with Gmail
- Access to [script.google.com](https://script.google.com) (Apps Script editor)
- Basic understanding of Gmail categories and labels

## Installation & Setup

1. Go to https://script.google.com → **New project**
2. Delete any default code
3. Paste the entire script (code.gs) into the editor
4. **Customize the configuration** (see below)
5. Save the project (give it a name like "Gmail Purger")
6. Click **Run** → authorize the script (Gmail read/write scopes)
7. Set up the daily trigger:
   - In the editor → left sidebar → **Triggers** (clock icon)
   - Click **+ Add Trigger**
   - Choose `setPurgeTrigger` → Time-driven → Day timer → pick a time
   - Or just run `setPurgeTrigger()` manually once

## Configuration

Edit these constants at the top of `code.gs`:

```javascript
const DRY_RUN = true;           // ← Start with true! Change to false only after testing

const PAGE_SIZE = 200;          // Threads per search (100–250 recommended for large accounts)
const BATCH_ACTION_SIZE = 100;  // Max per archive/trash call (do not increase >100)
