<!-- IMPLEMENTATION STATUS (updated 2025-12-18) -->
## Implementation status (changelog)

The items below mark what's been implemented in the codebase today and what remains. See the notes for file-level pointers to the new code.

- [x] Centralized quick-action model: implemented as `packages/vscode-extension/src/quick-actions-data.ts` (single source-of-truth for sections, metadata, preview intent parsing).
- [x] Quick Pick integration: `showQuickActions()` in `packages/vscode-extension/src/extension.ts` now uses the centralized model and helper runners.
- [x] Tree View provider: implemented `packages/vscode-extension/src/views/quick-actions-provider.ts` and registered during activation; tree items execute through `i18nsmith.quickActions.executeDefinition`.
- [x] Report watcher -> view refresh: `packages/vscode-extension/src/watcher.ts` emits refresh events and `extension.ts` subscribes to `reportWatcher.onDidRefresh` to rebuild the model.
- [x] Views & welcome contributions: `packages/vscode-extension/package.json` updated with `viewsContainers`, `views`, and `viewsWelcome` entries (runtime-ready / empty-state conditions wired via contexts).
- [x] Tests updated: `packages/vscode-extension/src/extension.test.ts` updated to mock new VS Code APIs; test suite passes locally.
- [x] UI polish & icons: centralized icon mapping + accessibility labels added in `quick-actions-data.ts`, with consistent codicons for both Quick Pick and tree view plus descriptive detail text.
- [x] Move per-instance renames to Code Actions (lightbulb): `codeactions.ts` now surfaces up to 10 rename refactors via `RefactorRewrite`, and suspicious-key children in the tree trigger the same command.
- [x] Rich preview/apply UX (progress + output linking): `extension.ts` wraps quick actions in progress notifications and offers “Show Output” links post-run for long-running tasks.
- [x] Context menu / tree-item granularity: tree provider now renders child nodes per suspicious key (`views/quick-actions-provider.ts`) so users can trigger individual renames without cluttering the main sections.

File pointers / quick map:

- Quick-action model: `packages/vscode-extension/src/quick-actions-data.ts`
- Tree provider: `packages/vscode-extension/src/views/quick-actions-provider.ts`
- Activation + Quick Pick glue: `packages/vscode-extension/src/extension.ts`
- Report watcher: `packages/vscode-extension/src/watcher.ts`
- Manifest contributions: `packages/vscode-extension/package.json`


This analysis highlights a common issue in developer tools: exposing the **mechanism** (CLI commands, raw arguments) rather than the **intent** (what the user wants to achieve). The current list is cognitively expensive, mixing setup tasks with daily workflows and specific error instances.

Here is a redesign proposal that focuses on **Action-Oriented Grouping** and **Progressive Disclosure**.

---

###1. Critique of Current State* **Visual Noise:** CLI commands (`i18nsmith scaffold-adapter...`) clutter the interface. Users usually don't care *how* it runs, only that it *does*.
* **Mixed Contexts:** Global setup commands ("Install runtime") are mixed with granular fixes ("Rename specific key").
* **Redundancy:** Multiple items allow for renaming or syncing without clear differentiation.
* **Lack of Hierarchy:** Important actions (like syncing the whole project) look the same as minor tweaks.

---

###2. Proposed ArchitectureI propose organizing the actions into four distinct logical groups (Sections in the VS Code Sidebar or grouped in the Command Palette):

1. **⚠️ Immediate Attention (The "Fix it" zone)**
* *High-priority items blocking clean code.*


2. **✨ Active Editing (The "Work" zone)**
* *Context-aware actions for the file currently open.*


3. **🔄 Workspace Sync (The "Maintenance" zone)**
* *Project-wide health and synchronization.*


4. **⚙️ Setup & Utility**
* *Configuration and diagnostics.*



---

###3. Redesigned Interface (Mockup)Below is how the actions should be relabeled and organized.

####Section 1: ⚠️ Problems & Fixes*This section only appears when issues exist. It aggregates individual errors into batch actions.*

> **$(alert) Resolve Suspicious Keys (5)**
> *Normalize key patterns (e.g., replace spaces, fix formatting).*
> **$(diff-renamed) Extract Hardcoded Strings (7)**
> *Extract 7 strings to locale files. Preview diff before applying.*
> **$(sync) Fix Locale Drift (2)**
> *Add 1 missing key, remove 1 unused key.*

####Section 2: ✨ Current Editor*Actions specific to the file you are looking at right now.*

> **$(beaker) Magic Transform File**
> *Auto-extract strings and wrap components in ` <I18nProvider>`.*
> **$(search) Analyze Usage**
> *Scan current file for translation coverage.*

####Section 3: 🔄 Project Health*Global actions for the repository.*

> **$(repo-sync) Sync Workspace**
> *Full scan: Align code usage with locale files (clean up unused/missing).*
> **$(export) Handoff to Translators**
> *Export 1 missing translation to CSV.*
> **$(book) Open Primary Locale**
> *Jump to `en.json` (or configured default).*

####Section 4: ⚙️ Setup & Diagnostics*One-time actions and debugging tools.*

> **$(tools) Scaffold Environment**
> *Install runtime & generate provider shell (React/Next.js).*
> **$(pulse) Run Health Check**
> *Deep scan for circular dependencies and key collisions.*

---

###4. Detailed UX ImprovementsHere is a specific breakdown of how to rewrite the labels to be "User-First" rather than "System-First":

| Current Label (Hard to read) | **New Label (User-Centric)** | **UX Improvement** |
| --- | --- | --- |
| `Rename suspicious key "common.app.home" ...` | **$(edit) Rename Key** (Context menu) <br>

<br> *or* <br>

<br> **$(list-flat) Fix all naming issues** | Don't list every single error in the main menu. Group them, or use Code Actions (Lightbulb) for specific instances. |
| `i18nsmith scaffold-adapter --type react...` | **$(desktop-download) Install Runtime Packages** | Hide the CLI command. If the user needs to see the CLI command, show it in the output terminal, not the button. |
| `Apply local fixes 1 missing key(s) to add...` | **$(check) Sync & Fix Locales** | Use "Sync" as the primary verb. It implies adding missing *and* removing unused. |
| `Export missing translations 1 missing key...` | **$(cloud-upload) Export Translation Batch** | Emphasize the result (Exporting) rather than the error (Missing). |
| `Transform current file to use i18nsmith` | **$(wand) Auto-Refactor File** | "Transform" is technical. "Refactor" or "Magic" implies intelligence. |

###5. Recommended Technical ImplementationTo achieve this redesign in VS Code:

1. **Use `views/welcome`:** If no runtime is detected (`No i18n runtime packages`), hide all other actions and show a prominent "Welcome View" button: **"Initialize i18n Project"**. Don't clutter the list with setup commands if the project is already set up.
2. **Tree View vs. Flat List:**
* Instead of listing "Rename suspicious key X" and "Rename suspicious key Y" as separate buttons, use a **Tree View**.
* *Parent:* 📂 Suspicious Keys (2)
* *Child:* 📄 "key with spaces"
* *Child:* 📄 "key.equals.value"




3. **Code Actions (The Lightbulb 💡):** Move specific string extractions and key renames to the editor context (Cmd+.). The side panel should be for **Batch** operations, not single-line fixes.

###Summary of Benefits* **Scannability:** Users can look for icons and bold verbs (Extract, Sync, Setup).
* **Safety:** "Preview" is implied in "Refactor" workflows; explicit CLI args are hidden to reduce anxiety.
* **Context:** Separating "Global" from "Current File" prevents users from accidentally scanning the whole repo when they just wanted to fix one file.

---

##🚀 VS Code Extension Quick Actions (i18nsmith)###1. ⚠️ Problems & Fixes (Contextual Group)*These actions only appear if the extension detects specific issues in the workspace. They represent the highest priority tasks.*

| Action Label | Description | Contextual Note |
| --- | --- | --- |
| **$(diff) Batch Extract Hardcoded Strings** | Extract all 7 found hardcoded strings and apply them to locale files. **(Preview Diff)** | Appears when `> 0` hardcoded strings are found. |
| **$(sync) Apply Locale Fixes & Sync** | Review and apply changes for detected drift: add 1 missing key(s) and remove 1 unused key(s). | Appears when there is drift (missing or unused keys). |
| **$(list-flat) Rename All Suspicious Keys (5)** | Auto-generate normalized names and apply them to 5 keys flagged for poor format (spaces, key-equals-value, etc.). **(Preview Changes)** | Appears when `> 0` suspicious keys are flagged. |
| **$(bug) Rename Specific Key: "suspicious key..."** | *Lightbulb/Code Action only:* Rename this specific key. **(Preview Flow)** | **Highly Recommended:** Move this to a Code Action (Lightbulb) within the editor, not the main menu. |

---

###2. ✨ Active File Actions (Current Editor Context)*Actions focusing specifically on the file currently open in the active editor window.*

| Action Label | Description | Old CLI Reference |
| --- | --- | --- |
| **$(wand) Auto-Refactor/Transform Current File** | Preview safe transformations (extract strings, wrap provider) in the active file. Rerun to continue refactoring. | `i18nsmith transform <file>` |
| **$(search) Analyze Usage in Current File** | Scan the active file for translation coverage and health diagnostics. | `i18nsmith check <file>` |
| **$(repo-pull) Refresh File Diagnostics** | Force a reload of diagnostics (errors, warnings) for the current file from the latest report. | Internal UI Refresh |

---

###3. 🔄 Project Health & Handoff (Workspace Maintenance)*Actions that affect the entire project or require interaction with external teams/systems.*

| Action Label | Description | Old CLI Reference |
| --- | --- | --- |
| **$(repo-sync) Full Workspace Sync** | Run a comprehensive sync: analyze all translation usage and update locale files. | `i18nsmith: Sync workspace` |
| **$(cloud-upload) Export Missing Translations (1 Key)** | Generate a CSV file containing all missing keys and their source for translation handoff. | `i18nsmith export-missing` |
| **$(book) Open Source Locale File** | Quickly open the primary locale file (`en.json`, `main.yaml`, etc.) for direct editing. | Internal File Open |

---

###4. ⚙️ Setup & Diagnostics (Utility)*Actions typically run once during setup or for deep debugging.*

| Action Label | Description | Old CLI Reference |
| --- | --- | --- |
| **$(tools) Scaffold Runtime & Provider** | Install necessary i18n runtime packages and generate the root provider shell (`<I18nProvider>`). | `i18nsmith scaffold-adapter --type...` |
| **$(pulse) Run Full Health Check** | Execute a complete background check for complex issues (key collisions, circular dependencies, etc.). | `i18nsmith check` |
| **$(terminal) Show i18nsmith Output Channel** | Open the dedicated output channel for viewing detailed logging and CLI execution results. | Internal UI Open |

---

###💡 User Experience SummaryThis structure achieves the goals of the re-design:

1. **Prioritization:** Issues are grouped at the top.
2. **Clarity:** Technical commands are replaced with clear, action-oriented verbs (Refactor, Sync, Export, Scaffold).
3. **Context:** The user immediately knows if the action is for the whole project or just the file they are working on.
