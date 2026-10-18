# LaTeX fixture projects

These are authored test documents, not user data. Phase 0 creates fixtures but
does not claim compilation, parsing, or preview coverage. Later service tests
must copy projects into a temporary directory before modifying or compiling them.
Do not enable automatic package installation during tests.

| Directory         | Intended coverage                                                   |
| ----------------- | ------------------------------------------------------------------- |
| `minimal article` | Article with spaces in the project path; core LaTeX only            |
| `dissertation`    | Main root, included chapters, bibliography, table, drawn figure     |
| `malformed`       | Deliberate undefined command; expected compile failure              |
| `beamer`          | Two real overlay states; requires Beamer                            |
| `tikz`            | Small directed graph; requires TikZ                                 |
| `tables`          | Simple and complex tables, escaped ampersand, math, multicolumn     |
| `citations`       | Multiple and optional citation arguments, comments, Unicode, labels |

The dissertation uses standard `picture` drawing commands rather than an external
image. Its expected pipeline is pdfLaTeX, BibTeX, pdfLaTeX, pdfLaTeX. The malformed
document must fail with an undefined-control-sequence diagnostic. The citations
fixture intentionally contains unresolved and duplicate labels and a missing
citation key. These cases are input data, not a passing feature claim.
