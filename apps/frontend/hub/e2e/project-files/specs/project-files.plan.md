# Hub Project Files Test Plan

## Application Overview

The Hub Project Files navigator restores an authenticated Jupyter context,
lists project contents, and coordinates file actions across browser tabs. These
tests exercise the rendered browser wiring with an in-memory backend fixture.

## Test Scenarios

### 1. Project-file browser safety net

**Seed:** `e2e/project-files/seed.spec.ts`

#### 1.1. bootstrap-and-open-project-files

**File:** `e2e/project-files/seed.spec.ts`

**Steps:**

1. Open the test project with a synthetic authenticated session.
   - expect: Session restoration and Jupyter server/token requests complete.
   - expect: The session restoration message disappears.
2. Open Project Files from the navigation rail.
   - expect: The Project files table and seeded rows are visible.

#### 1.2. encoded-navigation-and-row-action-isolation

**File:** `e2e/project-files/encoded-navigation-and-row-action-isolation.spec.ts`

**Steps:**

1. Open a nested folder and a filename containing reserved characters.
   - expect: The browser reaches the exactly-once-encoded canonical route.
2. Download a different file from its row action.
   - expect: The requested logical file is downloaded.
   - expect: The row is neither selected nor opened.

#### 1.3. upload-conflict-and-stale-completion

**File:** `e2e/project-files/upload-conflict-and-stale-completion.spec.ts`

**Steps:**

1. Upload a file whose name already exists.
   - expect: The navigator asks whether to replace the existing file.
2. Confirm the overwrite.
   - expect: The retry succeeds and reports completion.
3. Start another upload and navigate to a different folder before it finishes.
   - expect: The destination folder stays visible.
   - expect: The old directory's completion message is not shown.

#### 1.4. cross-tab-coordination

**File:** `e2e/project-files/cross-tab-coordination.spec.ts`

**Steps:**

1. Open the same project in two tabs and hold the file editor open in the first.
   - expect: Renaming from the second tab is blocked before a PATCH request.
2. Return the first tab to the navigator and retry the rename.
   - expect: The rename succeeds.
   - expect: BroadcastChannel refreshes the first tab's listing without reload.

#### 1.5. navigation-save-barrier

**File:** `e2e/project-files/navigation-save-barrier.spec.ts`

**Steps:**

1. Edit a capability input and immediately request another tab while the save
   response is deferred.
   - expect: The campaign route and edit remain active and tab controls are busy.
   - expect: Navigation occurs only after the save succeeds, and reopening shows
     the persisted value.
2. Force the same navigation save to fail.
   - expect: The route and edit remain unchanged and the existing save alert is
     shown.
   - expect: Retry succeeds, and a later transition preserves the value.
