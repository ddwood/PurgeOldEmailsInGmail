/*|--------------------------------------------------------------------------
  | PurgeOldEmails (Resilient Production Version - Preview + Early Relay)
  |--------------------------------------------------------------------------*/

// IMPORTANT SAFETY NOTE:
// Start with DRY_RUN = true to test without making any changes!
// Only set to false after you have verified the script behaves correctly.
const DRY_RUN = true;           // Set to true for testing (logs but no changes)

// Controls how many threads are fetched per search call.
// API maximum is 500; 200–300 is safer for large accounts to avoid timeouts.
const PAGE_SIZE = 400;

// Maximum threads that can be archived or trashed in one batch operation.
// Gmail enforces a hard limit of 100 — do not increase this value.
const BATCH_ACTION_SIZE = 100;

// ── STAGE 2 PURGE SETTINGS ────────────────────────────────────────────────
// List Gmail categories (built-in tabs) you want to automatically thin out.
// Beside each category name, specify how many days to keep emails before trashing.
const CATEGORIES_TO_DELETE = {
  'updates':    365,    // Keep for 1 year
  'forums':      90,    // Keep for 3 months
  'social':      14,    // Keep for 2 weeks (very aggressive for junk)
  'promotions':  30     // Keep for 1 month
  // Add more categories if needed, e.g. 'purchases': 90
};

// Purge emails based on custom/user-created labels.
// Beside each label name, specify retention in days.
const LABELS_TO_DELETE = {
  'MyKeepForNowLabel': 120,
  'DeleteAfter3Months': 90
  // Add more custom labels here as needed
};

// ── TRIGGER SETUP ─────────────────────────────────────────────────────────
// Run this function once (manually from the editor) to create the daily trigger.
// It removes any existing triggers first to avoid duplicates.
function setPurgeTrigger() {
  removeAllTriggers();
  ScriptApp.newTrigger('purge')
    .timeBased()
    .everyDays(1)
    .create();
  console.log("Daily master trigger set.");
}

// ── MAIN PURGE FUNCTION ───────────────────────────────────────────────────
function purge() {
  // Clean up any old relay triggers to keep the trigger list tidy
  removePurgeMoreTriggers();

  // Prevent concurrent runs (very important for Gmail operations)
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000); // Wait up to 10 seconds for lock
  } catch (e) {
    console.log("Lock timeout: " + e);
    setPurgeMoreTrigger(); // Schedule retry
    return;
  }

  let workRemaining = false;

  // Exclusion filter: anything matching these will NOT be archived or trashed
  // Customize heavily — test exclusions with Gmail search first!
  const exclusions = [
    '-is:starred',                        // Never touch starred emails
    '-is:important',                      // Never touch Gmail-marked important
    '-in:sent'                            // Never touch sent mail
    // Examples of other useful exclusions:
    // '-category:purchases',             // Keep all purchase receipts
    // '-label:"_Reference - Keys etc"',  // Quote labels with spaces/special chars
    // '-label:TheBoss',
    // '-label:Special',
    // '-label:Humor',
    // '-label:"Software Design"'
  ].join(' ');

  try {
    console.log("Starting preview phase to estimate workload...");

    // ── PREVIEW: Check inbox archive size ──
    const archiveQuery = `{category:updates category:forums category:social category:purchases} in:inbox older_than:10d`;
    let previewThreads = GmailApp.search(archiveQuery, 0, PAGE_SIZE);
    console.log(`Preview - Inbox older_than:10d → ${previewThreads.length} threads`);
    if (previewThreads.length === PAGE_SIZE) workRemaining = true;

    // ── PREVIEW: Check each category ──
    Object.entries(CATEGORIES_TO_DELETE).forEach(([cat, days]) => {
      const query = `category:${cat} older_than:${days}d ${exclusions}`;
      previewThreads = GmailApp.search(query, 0, PAGE_SIZE);
      console.log(`Preview - Category:${cat} older_than:${days}d → ${previewThreads.length} threads`);
      if (previewThreads.length === PAGE_SIZE) workRemaining = true;
    });

    // ── PREVIEW: Check each label ──
    Object.entries(LABELS_TO_DELETE).forEach(([labelName, days]) => {
      const query = `label:"${labelName}" older_than:${days}d ${exclusions}`;
      previewThreads = GmailApp.search(query, 0, PAGE_SIZE);
      console.log(`Preview - Label:${labelName} older_than:${days}d → ${previewThreads.length} threads`);
      if (previewThreads.length === PAGE_SIZE) workRemaining = true;
    });

    // Early hand-off: Schedule continuation BEFORE slow operations start
    // (most important for large backlogs — prevents lost progress on timeout)
    if (workRemaining && !DRY_RUN) {
      console.log("Preview detected at least one full page → scheduling relay early for safety.");
      setPurgeMoreTrigger();  // Primary proactive relay
    }

    console.log("Preview complete. Starting actual processing...");

    // ── STAGE 1: Archive old inbox threads (does NOT delete — just cleans inbox) ──
    let threads = GmailApp.search(archiveQuery, 0, PAGE_SIZE);

    if (threads.length > 0) {
      console.log(`Found ${threads.length} inbox threads older than 10d to archive...`);

      if (!DRY_RUN) {
        for (let i = 0; i < threads.length; i += BATCH_ACTION_SIZE) {
          const batch = threads.slice(i, i + BATCH_ACTION_SIZE);
          GmailApp.moveThreadsToArchive(batch);
          console.log(`Archived batch of ${batch.length} threads`);
        }
      } else {
        console.log(`DRY_RUN: Would archive ${threads.length} threads in batches`);
      }
    }
    if (threads.length === PAGE_SIZE) workRemaining = true;

    // ── STAGE 2: Purge (trash) old category threads ──
    Object.entries(CATEGORIES_TO_DELETE).forEach(([cat, days]) => {
      const query = `category:${cat} older_than:${days}d ${exclusions}`;
      threads = GmailApp.search(query, 0, PAGE_SIZE);

      console.log(`Category:${cat} older_than:${days}d → ${threads.length} threads`);

      if (threads.length > 0) {
        if (threads.length === PAGE_SIZE) workRemaining = true;

        if (!DRY_RUN) {
          for (let i = 0; i < threads.length; i += BATCH_ACTION_SIZE) {
            const batch = threads.slice(i, i + BATCH_ACTION_SIZE);
            GmailApp.moveThreadsToTrash(batch);
          }
        }
      }
    });

    // ── STAGE 2: Purge (trash) old labeled threads ──
    Object.entries(LABELS_TO_DELETE).forEach(([labelName, days]) => {
      const query = `label:"${labelName}" older_than:${days}d ${exclusions}`;
      threads = GmailApp.search(query, 0, PAGE_SIZE);

      console.log(`Label:${labelName} older_than:${days}d → ${threads.length} threads`);

      if (threads.length > 0) {
        if (threads.length === PAGE_SIZE) workRemaining = true;

        if (!DRY_RUN) {
          for (let i = 0; i < threads.length; i += BATCH_ACTION_SIZE) {
            const batch = threads.slice(i, i + BATCH_ACTION_SIZE);
            GmailApp.moveThreadsToTrash(batch);
          }
        }
      }
    });

    // Final hand-off: Catch any workRemaining that became true DURING processing
    // (e.g. time-critical bail inside batch loops, or late full-page result)
    if (workRemaining && !DRY_RUN) {
      console.log("More work remains (detected during processing) — scheduling relay in ~2 min...");
      setPurgeMoreTrigger();  // Fallback safety net
    } else if (!workRemaining) {
      console.log("Cleanup cycle completed — no full pages detected.");
    }

  } catch (err) {
    const errorMsg = err.toString();
    console.log("Error during purge: " + errorMsg);

    // Check if we hit the daily Gmail API limit
    if (errorMsg.indexOf("Service invoked too many times") !== -1 || 
        errorMsg.indexOf("Rate Limit Exceeded") !== -1) {
      
      console.log("CRITICAL: Daily API Quota reached. Stopping autopilot for today.");
      // We do NOT call setPurgeMoreTrigger() here.
      // The script will die and wait for the daily 'setPurgeTrigger' anchor to restart tomorrow.
      
    } else {
      // For all other minor errors (timeouts, etc.), continue the relay
      console.log("Minor error detected. Attempting to continue relay...");
      setPurgeMoreTrigger(); 
    }
    
  } finally {
    if (lock) {
      lock.releaseLock();
    }
  }
}

// ── Relay / continuation entry point ──
// Called by the short-delay trigger when more work is expected
function purgeMore() {
  purge();
}

function setPurgeMoreTrigger() {
  ScriptApp.newTrigger('purgeMore')
    .timeBased()
    .after(1000 * 60 * 2)  // 2 minutes delay
    .create();
}

function removePurgeMoreTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'purgeMore') {
      ScriptApp.deleteTrigger(t);
    }
  });
}

function removeAllTriggers() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
}
