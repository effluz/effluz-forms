# Use cases

One file per capability. Each states: actors, trigger, main flow, alternate
flows and errors, rules, audit entries, success criteria. Names match the
module that owns the capability.

`reference-form-preemie-stories.md` is the acceptance fixture: the first
form the builder must reproduce, with the gaps it exposes.

In build order:

| File | Module | Capability |
|---|---|---|
| `sign-in.md` | identity | Staff sign-in, session, sign-out |
| `create-and-edit-form.md` | definitions | Create a form, edit the draft, add and arrange pages and fields, set logic |
| `publish-form.md` | definitions | Validate and publish a draft as a version; lifecycle transitions |
| `manage-form-settings.md` | definitions | Recipients, retention, open and close dates, bot challenge, QR code |
| `fill-and-submit-form.md` | submissions | Public flow page by page, validation, media staging, intake transaction |
| `review-submissions.md` | review | List, filter, view, view and download media, export CSV, delete |
| `curate-submission.md` | review | Status toward publication; correct text answers with original preserved; DeepL Write suggestions |
| `operate-jobs.md` | review | See and retry dead jobs |
