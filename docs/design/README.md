# Design exports

The design canvases are the source of truth. Everything in this folder is exported from them.

| Canvas | Link |
| --- | --- |
| Super Admin | https://claude.ai/artifact/TobcWYaaT9XBHE6ezwMdFj |
| Accountant | https://claude.ai/artifact/8PmVsHwPVRWYioRgzABN1m |

- **PDF exports** of each canvas (`super-admin.pdf`, `accountant.pdf`) stay on your own computer. Git ignores `*.pdf` in this folder. Export them from the canvases when you need them.
- **Start-up and setup screens** are in `setup/`, one JPEG per screen (quality 85, at the exported size; 2× exports are 2880 px wide). A new export replaces the old file under the same name, so there is only ever one current copy. `setup/README.md` lists where later decisions override these images.
- **Accountant screens** are in `accountant/`, one JPEG per board of the Accountant canvas (`collect-fee.jpg`, `dashboard.jpg`, `fee-receipt-a5.jpg`, …), at the exported size and under about 400 KB each (quality 85, lower where a screen needs it). They are references, not source: the canvas is the source, and where a decision in `docs/` differs, the decision wins. A new export replaces the old file under the same name.
