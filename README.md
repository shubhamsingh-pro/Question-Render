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

## Run locally
Open `index.html` directly, or `python3 -m http.server` in this folder and visit http://localhost:8000.

## Deploy to Render
1. Push this folder to a GitHub repo.
2. Render → **New → Static Site** → pick the repo. Build command: *(empty)*. Publish directory: `.`
   (or **New → Blueprint** and Render will read `render.yaml`).
