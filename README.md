# Question Bank Viewer

A static web app that previews Chapter · Topic · Concept · Group · Question bulk-import sheets
(Objective / Descriptive / Subjective tabs) with KaTeX-rendered maths, images, and the full hierarchy.

Everything runs in the browser — uploaded files never leave your computer.

## Use it
- **Upload**: in Google Sheets choose *File → Download → Microsoft Excel (.xlsx)*, then drop the file on the page.
  (.xlsx, .ods and .csv work; you can select several CSVs at once.)
- **Link**: paste a Google Sheets URL. This only works if the sheet is shared as *Anyone with the link – Viewer*.

## What it understands
- `[Katex]…[/Katex]` → rendered maths; bare LaTeX in *Equation*-type answer cells (e.g. `\text{…}`) is rendered too.
- `[img src="…" alt="…"]` → images (Google Drive `/file/d/…/view` links are converted automatically;
  Drive images must be shared as *Anyone with the link*). Click an image to enlarge.
- `$$a$$` placeholders → blanks; with **Answers** on they show the accepted answer.
- `<br>` and line breaks.
- Links questions → group (`group_question_labels`) → concept (`concept_question_labels` / group lists)
  → topic (`topic_concept_labels`) → chapter (`pre_topics` / `post_topics`), across all tabs.
  Labels like `X_C01 Q01` and `X_C01_Q01` are treated as the same.
- A **data checks** panel lists broken links, missing questions, malformed group rows, weightage ≠ marks,
  MCQs with no correct option and LaTeX errors.

## Editing
Tick **✎ Edit** in the toolbar, then click any question, option, answer, marking criterion, explanation or concept
detail to edit its source text (with a live KaTeX preview and buttons for maths, bold, sub/superscript, line breaks
and images). Highlight a word on the page before clicking to jump straight to it in the editor.
**All fields** on a card edits every column of that row (marks, difficulty, `correct_answer_n`, weightages, …).
Edited fields get an amber edge; the bar at the bottom lists unsaved changes, with **Review** / **Undo**.

- **Download edited file** (or **⬇ Download** at the top) saves the workbook with your changes, in the same
  format it was opened in (.xlsx / .ods / .csv). Every tab and every other cell is kept; cell colours and
  formatting are not.
- **Save to Google Sheet** (when the file was opened from a Google link) writes the changed cells straight back.
  It works for native Google Sheets and for **.xlsx files stored in Google Drive** (the file stays .xlsx and keeps its link).
  It needs a one-time setup per Google account: the viewer gives you a small Apps Script to paste into a new project at
  script.google.com and deploy as a *Web app* (Execute as: Me, Who has access: Anyone); paste the `/exec` URL back
  into the viewer. One deployment covers every file that account can edit. A cell that someone else changed in the
  meantime is not overwritten unless you confirm it. **Copy link for colleagues** makes a link that opens the file
  with saving already connected — anyone with that link can save to it.
  If your Google Workspace admin does not allow *Anyone* access for web apps, use *Download* instead.

## Run locally
Open `index.html` directly, or `python3 -m http.server` in this folder and visit http://localhost:8000.

## Deploy to Render
1. Push this folder to a GitHub repo.
2. Render → **New → Static Site** → pick the repo. Build command: *(empty)*. Publish directory: `.`
   (or **New → Blueprint** and Render will read `render.yaml`).
